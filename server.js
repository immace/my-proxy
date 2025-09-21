// SPHERE server (Render-ready)
// - Serves /app (public/index.html + public/app.js)
// - /m?url=...  -> reverse proxy for iframe (strips XFO/CSP), goes via UPSTREAM_PROXY
// - /api/profile, /api/profile/ensure, /api/reset, /api/ip  (minimal stubs)
// - /fetch?url=... -> reverse fetch with Basic auth (PROXY_USER/PROXY_PASS)
// - /Sphere.mobileconfig -> iOS webclip profile
// - /healthz

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const ProxyAgent = require("proxy-agent");

const PORT = process.env.PORT || 8080;
const STATIC_DIR = path.join(__dirname, "public");

// --- env ---
const UPSTREAM_PROXY = process.env.UPSTREAM_PROXY || ""; // e.g. http://user:pass@host:port
const upstreamAgent = UPSTREAM_PROXY ? new ProxyAgent(UPSTREAM_PROXY) : undefined;

const PROXY_USER = process.env.PROXY_USER || "student";
const PROXY_PASS = process.env.PROXY_PASS || "mypassword";

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
}
function authOk(req) {
  const h = req.headers["proxy-authorization"] || req.headers["authorization"];
  if (!h) return false;
  const [scheme, token] = h.split(" ");
  if (!/Basic/i.test(scheme) || !token) return false;
  const decoded = Buffer.from(token, "base64").toString();
  return decoded === `${PROXY_USER}:${PROXY_PASS}`;
}
function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
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
      Accept: "*/*",
    },
    agent: upstreamAgent,
    timeout: 20000,
  };

  const up = mod.request(opts, (u) => {
    res.writeHead(u.statusCode || 200, stripIframeBlockers(u.headers));
    u.pipe(res);
  });
  up.on("error", (e) => {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Upstream error: " + e.message);
  });
  up.end();
}

// ----------------- server -----------------
const server = http.createServer(async (req, res) => {
  try {
    // health
    if (req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end("ok");
    }

    // Static: /app and /app.js
    if (req.url === "/" || req.url === "/app") {
      const p = path.join(STATIC_DIR, "index.html");
      const buf = fs.readFileSync(p);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(buf);
    }
    if (req.url.startsWith("/app.js")) {
      const p = path.join(STATIC_DIR, "app.js");
      const buf = fs.readFileSync(p);
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      return res.end(buf);
    }

    // iOS webclip profile (for adding на Домой)
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
        "Content-Type": "application/x-apple-aspen-config",
        "Content-Disposition": 'attachment; filename="Sphere.mobileconfig"',
      });
      return res.end(xml);
    }

    // CORS preflight
    if (req.method === "OPTIONS" && (req.url.startsWith("/m") || req.url.startsWith("/fetch") || req.url.startsWith("/api/"))) {
      setCORS(res);
      res.writeHead(204);
      return res.end();
    }

    // Reverse-proxy for iframe (no auth)
    if (req.url.startsWith("/m")) {
      setCORS(res);
      const u = new URL(req.url, "http://local");
      const target = u.searchParams.get("url");
      if (!target) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        return res.end("Missing url");
      }
      return proxyGET(target, req, res);
    }

    // Minimal API stubs
    if (req.url.startsWith("/api/profile") && req.method === "POST" && !req.url.includes("/ensure")) {
      const raw = await readBody(req);
      let body = {};
      try { body = JSON.parse(raw || "{}"); } catch {}
      const pid = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ pid, name: body.name || "Profile", url: body.url || "" }));
    }
    if (req.url.startsWith("/api/profile/ensure") && req.method === "POST") {
      const raw = await readBody(req);
      let body = {};
      try { body = JSON.parse(raw || "{}"); } catch {}
      const pid = body.pid || Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ pid }));
    }
    if (req.url.startsWith("/api/reset") && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (req.url.startsWith("/api/ip")) {
      setCORS(res);
      // узнаём внешний IP (через твой прокси, если задан)
      const ipReq = https.request(
        { hostname: "api.ipify.org", port: 443, path: "/", method: "GET", agent: upstreamAgent, timeout: 10000 },
        (u) => {
          let data = "";
          u.on("data", (d) => (data += d));
          u.on("end", () => {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end(data || "");
          });
        }
      );
      ipReq.on("error", () => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("unknown");
      });
      ipReq.end();
      return;
    }

    // Auth-required reverse fetch (демо «прокси с логином»)
    if (req.url.startsWith("/fetch")) {
      setCORS(res);
      if (!authOk(req)) {
        res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Proxy"' });
        return res.end("Auth required");
      }
      const u = new URL(req.url, "http://local");
      const target = u.searchParams.get("url");
      if (!target) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        return res.end("Missing url");
      }
      return proxyGET(target, req, res);
    }

    // Not found
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Server error: " + e.message);
  }
});

server.listen(PORT, () => {
  console.log("SPHERE server listening on " + PORT);
});
