// SPHERE server (Render-ready) — real TG login + reverse proxy via upstream proxy only
// Routes:
//   /app, /app.js, /env.js            — UI
//   /m?url=...&pid=...                — reverse proxy for iframe (strips XFO/CSP) through UPSTREAM_PROXY
//   /auth/telegram, /api/me           — auth via Telegram Login Widget (cookie "sid")
//   /api/profile, /api/profile/ensure — stubs to issue pid (for local save)
//   /api/reset, /api/ip               — reset stub; IP via upstream proxy only
//   /Sphere.mobileconfig, /healthz

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const createProxyAgent = require("proxy-agent");

const PORT = process.env.PORT || 8080;
const STATIC_DIR = path.join(__dirname, "public");

// ===== ENV
const TG_BOT_NAME  = process.env.TG_BOT_NAME  || ""; // имя бота БЕЗ @
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "change_me_secret";

// ВАЖНО: только твой платный прокси (логин:пароль@host:port)
const UPSTREAM_PROXY = process.env.UPSTREAM_PROXY || "";
let upstreamAgent;
try {
  upstreamAgent = UPSTREAM_PROXY ? createProxyAgent(UPSTREAM_PROXY) : undefined;
  if (!upstreamAgent) console.warn("UPSTREAM_PROXY not set – /api/ip будет отвечать proxy_not_configured");
  else console.log("Using upstream proxy:", UPSTREAM_PROXY);
} catch (e) {
  console.error("Bad UPSTREAM_PROXY:", e.message);
  upstreamAgent = undefined;
}

// ===== helpers
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
}
function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", d => raw += d);
    req.on("end", () => resolve(raw));
  });
}
function stripIframeBlockers(h) {
  const out = { ...h, "access-control-allow-origin": "*" };
  delete out["x-frame-options"];
  delete out["content-security-policy"];
  delete out["content-security-policy-report-only"];
  return out;
}
function proxyGET(targetUrl, req, res) {
  const t = new URL(targetUrl);
  const isTLS = t.protocol === "https:";
  const mod = isTLS ? https : http;

  const opts = {
    protocol: t.protocol,
    hostname: t.hostname,
    port: t.port || (isTLS ? 443 : 80),
    path: t.pathname + (t.search || ""),
    method: "GET",
    headers: {
      "User-Agent": req.headers["user-agent"] || "Sphere",
      "Accept": "*/*",
    },
    agent: upstreamAgent,           // <-- всегда через апстрим-прокси (если задан)
    timeout: 20000,
  };

  const up = mod.request(opts, (u) => {
    res.writeHead(u.statusCode || 200, stripIframeBlockers(u.headers));
    u.pipe(res);
  });
  up.on("error", (e) => {
    res.writeHead(502, {"Content-Type":"text/plain"});
    res.end("Upstream error: " + e.message);
  });
  up.end();
}

// ===== simple signed session (cookie sid)
function signSession(obj) {
  const b64 = Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
  const mac = crypto.createHmac("sha256", SESSION_SECRET).update(b64).digest("base64url");
  return `${b64}.${mac}`;
}
function verifySession(token) {
  if (!token) return null;
  const [b64, mac] = token.split(".");
  const mac2 = crypto.createHmac("sha256", SESSION_SECRET).update(b64).digest("base64url");
  if (mac !== mac2) return null;
  try { return JSON.parse(Buffer.from(b64, "base64url").toString("utf8")); }
  catch { return null; }
}
function getCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach(p => {
    const i = p.indexOf("="); if (i>0) out[p.slice(0,i).trim()] = decodeURIComponent(p.slice(i+1));
  });
  return out;
}
function setCookie(res, name, val, days=180) {
  const exp = new Date(Date.now()+days*864e5).toUTCString();
  res.setHeader("Set-Cookie", `${name}=${encodeURIComponent(val)}; Path=/; Expires=${exp}; HttpOnly; SameSite=Lax; Secure`);
}

// Telegram Login verify (https://core.telegram.org/widgets/login)
function verifyTelegram(data) {
  if (!TG_BOT_TOKEN) return null;
  const { hash, ...rest } = data;
  const dataCheckString = Object.keys(rest).sort().map(k => `${k}=${rest[k]}`).join("\n");
  const secret = crypto.createHash("sha256").update(TG_BOT_TOKEN).digest();
  const hmac = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  if (hmac !== hash) return null;
  const now = Math.floor(Date.now()/1000);
  if (Math.abs(now - Number(rest.auth_date || now)) > 86400) return null;
  return {
    id: String(rest.id),
    username: rest.username || "",
    first_name: rest.first_name || "",
    last_name: rest.last_name || "",
    photo_url: rest.photo_url || ""
  };
}

// =================== SERVER ===================
const server = http.createServer(async (req, res) => {
  try {
    // health
    if (req.url === "/healthz") {
      res.writeHead(200, {"Content-Type":"text/plain"}); return res.end("ok");
    }

    // static UI
    if (req.url === "/" || req.url === "/app") {
      const html = fs.readFileSync(path.join(STATIC_DIR, "index.html"));
      res.writeHead(200, {"Content-Type":"text/html; charset=utf-8"});
      return res.end(html);
    }
    if (req.url.startsWith("/app.js")) {
      const js = fs.readFileSync(path.join(STATIC_DIR, "app.js"));
      res.writeHead(200, {"Content-Type":"text/javascript; charset=utf-8"});
      return res.end(js);
    }

    // tiny env script to pass bot name into front-end
    if (req.url === "/env.js") {
      res.writeHead(200, {"Content-Type":"text/javascript; charset=utf-8"});
      return res.end(`window.BOT_NAME=${JSON.stringify(TG_BOT_NAME)};`);
    }

    // iOS webclip
    if (req.url === "/Sphere.mobileconfig") {
      const targetUrl = "https://" + req.headers.host + "/app";
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>PayloadContent</key><array>
    <dict>
      <key>IsRemovable</key><true/>
      <key>Label</key><string>Sphere</string>
      <key>PayloadIdentifier</key><string>com.sphere.webclip</string>
      <key>PayloadType</key><string>com.apple.webClip</string>
      <key>PayloadUUID</key><string>9F3C6AE8-9D8E-4E1B-9F11-1234567890AB</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>Precomposed</key><true/>
      <key>URL</key><string>${targetUrl}</string>
      <key>FullScreen</key><true/>
    </dict>
  </array>
  <key>PayloadDisplayName</key><string>Sphere Profile</string>
  <key>PayloadIdentifier</key><string>com.sphere.profile</string>
  <key>PayloadRemovalDisallowed</key><false/>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>6B7E9E1C-3C1A-4A4B-B0D2-ABCDEF012345</string>
  <key>PayloadVersion</key><integer>1</integer>
</dict></plist>`;
      res.writeHead(200, {
        "Content-Type":"application/x-apple-aspen-config",
        "Content-Disposition":'attachment; filename="Sphere.mobileconfig"'
      });
      return res.end(xml);
    }

    // CORS preflight
    if (req.method === "OPTIONS" && (/^\/(m|api)\b/.test(req.url))) {
      setCORS(res); res.writeHead(204); return res.end();
    }

    // reverse proxy for iframe
    if (req.url.startsWith("/m")) {
      setCORS(res);
      const u = new URL(req.url, "http://local");
      const target = u.searchParams.get("url");
      if (!target) { res.writeHead(400, {"Content-Type":"text/plain"}); return res.end("Missing url"); }
      return proxyGET(target, req, res);
    }

    // ===== auth
    if (req.url.startsWith("/auth/telegram")) {
      let data = {};
      if (req.method === "POST") {
        (await readBody(req)).split("&").forEach(p => {
          const [k,v] = p.split("="); if (k) data[decodeURIComponent(k)] = decodeURIComponent(v||"");
        });
      } else {
        const q = new URL(req.url, "http://local").searchParams;
        q.forEach((v,k)=> data[k]=v);
      }
      const user = verifyTelegram(data);
      if (!user) { res.writeHead(400, {"Content-Type":"text/plain"}); return res.end("Bad Telegram login"); }
      const sid = signSession({ id:user.id, first_name:user.first_name, username:user.username, photo_url:user.photo_url });
      setCookie(res, "sid", sid);
      res.writeHead(302, { "Location": "/app" }); return res.end();
    }

    if (req.url.startsWith("/api/me")) {
      const me = verifySession(getCookies(req).sid) || {};
      res.writeHead(200, {"Content-Type":"application/json"}); return res.end(JSON.stringify(me));
    }

    // minimal stubs
    if (req.url.startsWith("/api/profile") && req.method === "POST" && !req.url.includes("/ensure")) {
      const raw = await readBody(req); let body={}; try{body=JSON.parse(raw||"{}");}catch{}
      const pid = Date.now().toString(36) + Math.random().toString(36).slice(2,7);
      res.writeHead(200, {"Content-Type":"application/json"});
      return res.end(JSON.stringify({ pid, name: body.name||"Profile", url: body.url||"" }));
    }
    if (req.url.startsWith("/api/profile/ensure") && req.method === "POST") {
      const raw = await readBody(req); let body={}; try{body=JSON.parse(raw||"{}");}catch{}
      const pid = body.pid || Date.now().toString(36) + Math.random().toString(36).slice(2,7);
      res.writeHead(200, {"Content-Type":"application/json"}); return res.end(JSON.stringify({ pid }));
    }
    if (req.url.startsWith("/api/reset") && req.method === "POST") {
      res.writeHead(200, {"Content-Type":"application/json"}); return res.end(JSON.stringify({ ok:true }));
    }
    if (req.url.startsWith("/api/ip")) {
      setCORS(res);
      if (!upstreamAgent) { res.writeHead(200, {"Content-Type":"text/plain"}); return res.end("proxy_not_configured"); }
      const ipReq = https.request(
        { hostname:"api.ipify.org", port:443, path:"/", method:"GET", agent: upstreamAgent, timeout:10000 },
        (u) => { let d=""; u.on("data",c=>d+=c); u.on("end",()=>{ res.writeHead(200,{"Content-Type":"text/plain"}); res.end(d||""); }); }
      );
      ipReq.on("error", () => { res.writeHead(200, {"Content-Type":"text/plain"}); res.end("unknown"); });
      ipReq.end();
      return;
    }

    // 404
    res.writeHead(404, {"Content-Type":"text/plain"}); res.end("Not found");
  } catch(e) {
    res.writeHead(500, {"Content-Type":"text/plain"}); res.end("Server error: " + e.message);
  }
});

server.listen(PORT, () => console.log("SPHERE server on " + PORT));
