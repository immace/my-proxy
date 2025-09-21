// server.js — Sphere: UI + Telegram-логин + тумблер Proxy + профиль .mobileconfig

const http = require("http");
const https = require("https");
const net = require("net");
const crypto = require("crypto");
const httpProxy = require("http-proxy");
const { URL } = require("url");

// ===== Env =====
const USER = process.env.PROXY_USER || "student";
const PASS = process.env.PROXY_PASS || "mypassword";
const BOT_NAME = process.env.TG_BOT_NAME || "";   // имя бота БЕЗ @
const BOT_TOKEN = process.env.TG_BOT_TOKEN || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "change_me_secret";
// ===============

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
}

function authOk(req) {
  const h = req.headers["proxy-authorization"] || req.headers["authorization"];
  if (!h) return false;
  const parts = h.split(" ");
  if (parts.length !== 2) return false;
  const decoded = Buffer.from(parts[1], "base64").toString();
  return decoded === `${USER}:${PASS}`;
}

// простая «подписанная» сессия
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
  try { return JSON.parse(Buffer.from(b64, "base64url").toString("utf8")); } catch { return null; }
}
function getCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach(p => {
    const i = p.indexOf("="); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1));
  });
  return out;
}
function setCookie(res, name, val, days = 30) {
  const exp = new Date(Date.now() + days * 864e5).toUTCString();
  res.setHeader("Set-Cookie", `${name}=${encodeURIComponent(val)}; Path=/; Expires=${exp}; HttpOnly; SameSite=Lax; Secure`);
}

// верификация Telegram Login
function checkTelegramAuth(data) {
  if (!BOT_TOKEN) return null;
  const { hash, ...rest } = data;
  const dataCheckString = Object.keys(rest).sort().map(k => `${k}=${rest[k]}`).join("\n");
  const secret = crypto.createHash("sha256").update(BOT_TOKEN).digest();
  const hmac = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  if (hmac !== hash) return null;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(rest.auth_date || now)) > 86400) return null;
  return {
    id: String(rest.id),
    username: rest.username || "",
    first_name: rest.first_name || "",
    last_name: rest.last_name || "",
    photo_url: rest.photo_url || ""
  };
}
function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on("data", d => chunks.push(d));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

const proxy = httpProxy.createProxyServer({});
const server = http.createServer(async (req, res) => {
  // health
  if (req.url === "/healthz") { res.writeHead(200, {"Content-Type":"text/plain"}); return res.end("ok"); }

  // UI
  if (req.url.startsWith("/app")) {
    const html = `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Sphere</title>
<style>
  :root{--bg:#0b0d10;--panel:#121418;--line:#1f2329;--text:#e8e8e8;--muted:#a7b0bb}
  html,body{height:100%;margin:0;background:var(--bg);color:var(--text);font:15px/1.4 -apple-system,system-ui,Segoe UI,Roboto}
  .top{position:fixed;left:0;right:0;top:0;height:56px;display:flex;gap:10px;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--line);background:rgba(12,13,14,.9);backdrop-filter:blur(6px);z-index:2}
  .brand{font-weight:800;letter-spacing:.6px}
  .chip{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--line);border-radius:999px;background:var(--panel)}
  .toggle{width:38px;height:22px;border-radius:999px;border:1px solid var(--line);background:#222;position:relative}
  .dot{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#666;transition:.2s}
  .on .dot{left:18px;background:#1ee2a1}
  .content{position:absolute;inset:56px 0 0 0;padding:14px}
  .card{border:1px solid var(--line);background:var(--panel);border-radius:16px;padding:14px}
  .row{display:flex;align-items:center;justify-content:space-between}
  .muted{color:var(--muted)}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:12px}
  .app{aspect-ratio:1/1;border:1px dashed var(--line);border-radius:14px;display:flex;align-items:center;justify-content:center;color:var(--muted)}
  .app.add{border-style:solid;color:#e8e8e8}
  .btn{padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--panel);color:#e8e8e8}
  iframe.browser{width:100%;height:60vh;border:1px solid var(--line);border-radius:12px;background:#000;margin-top:12px}
  .center{display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;height:calc(100% - 56px)}
  input.name{width:100%;padding:10px;border-radius:10px;border:1px solid var(--line);background:#0f1114;color:#e8e8e8}
</style>
</head><body>
<div class="top">
  <div class="brand">SPHERE</div>
  <div class="chip" id="proxyChip">
    <span>Proxy:</span>
    <div class="toggle" id="proxyToggle"><div class="dot"></div></div>
  </div>
</div>

<div class="content" id="appRoot"></div>

<script>
const PROXY_BASE = "/fetch";
const AUTH = "Basic " + btoa("${USER}:${PASS}");
const BOT_NAME = ${JSON.stringify(BOT_NAME)};
const state = { proxy: true, me: null };

async function apiMe(){ const r = await fetch("/api/me",{credentials:"include"}); return r.json(); }
async function loginName(name){
  await fetch("/api/name", {method:"POST", headers:{"Content-Type":"application/json"}, credentials:"include", body:JSON.stringify({name})});
  state.me = await apiMe(); render();
}

function setProxy(on){ state.proxy = !!on; document.getElementById("proxyToggle").classList.toggle("on", state.proxy); }

async function testProxy(){
  try{
    const r = await fetch(PROXY_BASE + "?url=https://api.ipify.org", { headers:{Authorization: AUTH} });
    const ip = await r.text();
    alert("IP через прокси: " + ip);
  }catch(e){ alert("Ошибка: " + e.message); }
}

function openService(url){
  const target = state.proxy ? (PROXY_BASE + "?url=" + encodeURIComponent(url)) : url;
  const browser = document.getElementById("browser");
  if (browser){ browser.src = target; window.scrollTo(0, document.body.scrollHeight); }
  else{
    const ifr = document.createElement("iframe");
    ifr.className = "browser";
    ifr.id = "browser";
    ifr.src = target;
    document.getElementById("appRoot").appendChild(ifr);
  }
}

// UI
if (req.url.startsWith("/app")) {
  const html = `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Sphere</title>
<style>
  :root{
    --safe-top: env(safe-area-inset-top, 0px);
    --bg:#0b0d10; --panel:#121418; --line:#1f2329; --text:#e8e8e8; --muted:#a7b0bb;
    --topH: calc(56px + var(--safe-top));
  }
  html,body{height:100%;margin:0;background:var(--bg);color:var(--text);font:15px/1.4 -apple-system,system-ui,Segoe UI,Roboto;
    -webkit-text-size-adjust:100%;}
  .top{
    position:fixed; left:0; right:0; top:0;
    height:var(--topH);
    display:flex; gap:10px; align-items:flex-end; justify-content:space-between;
    padding: calc(8px + var(--safe-top)) 16px 10px 16px;
    border-bottom:1px solid var(--line);
    background:rgba(12,13,14,.92); backdrop-filter:blur(6px); z-index:2;
  }
  .brand{font-weight:800;letter-spacing:.6px; user-select:none; -webkit-user-select:none;}
  .chip{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--line);border-radius:999px;background:var(--panel)}
  .toggle{width:38px;height:22px;border-radius:999px;border:1px solid var(--line);background:#222;position:relative}
  .dot{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#666;transition:.2s}
  .on .dot{left:18px;background:#1ee2a1}
  .content{
    position:fixed; left:0; right:0; top:var(--topH); bottom:0;
    padding:14px; overflow:auto; -webkit-overflow-scrolling:touch;
  }
  .card{border:1px solid var(--line);background:var(--panel);border-radius:16px;padding:14px}
  .row{display:flex;align-items:center;justify-content:space-between;gap:12px}
  .muted{color:var(--muted)}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(72px,1fr));gap:12px;margin-top:12px}
  .app{aspect-ratio:1/1;border:1px dashed var(--line);border-radius:14px;display:flex;align-items:center;justify-content:center;color:var(--muted)}
  .app.add{border-style:solid;color:#e8e8e8}
  .btn{padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--panel);color:#e8e8e8;
    touch-action:manipulation;-webkit-tap-highlight-color:transparent}
  iframe.browser{width:100%;height:60vh;border:1px solid var(--line);border-radius:12px;background:#000;margin-top:12px}
  .center{display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;min-height:calc(100% - 1px)}
  input.name{width:100%;padding:12px;border-radius:10px;border:1px solid var(--line);background:#0f1114;color:#e8e8e8}
</style>
</head><body>
<div class="top">
  <div class="brand">SPHERE</div>
  <div class="chip" id="proxyChip">
    <span>Proxy:</span>
    <div class="toggle" id="proxyToggle"><div class="dot"></div></div>
  </div>
</div>

<div class="content" id="appRoot"></div>

<script>
const PROXY_BASE = "/fetch";
const AUTH = "Basic " + btoa("${USER}:${PASS}");
const BOT_NAME = ${JSON.stringify(BOT_NAME)};
const state = { proxy: true, me: null };

async function apiMe(){ const r = await fetch("/api/me",{credentials:"include"}); return r.json(); }
async function loginName(name){
  await fetch("/api/name", {method:"POST", headers:{"Content-Type":"application/json"}, credentials:"include", body:JSON.stringify({name})});
  state.me = await apiMe(); rerender();
}
function rerender(){
  if (!state.me || !state.me.id) renderUnauthed();
  else if (!state.me.name) renderNamePrompt();
  else renderAuthed();
}

function setProxy(on){ state.proxy = !!on; document.getElementById("proxyToggle").classList.toggle("on", state.proxy); }

async function testProxy(){
  try{
    const r = await fetch(PROXY_BASE + "?url=https://api.ipify.org", { headers:{Authorization: AUTH} });
    const ip = await r.text();
    alert("IP через прокси: " + ip);
  }catch(e){ alert("Ошибка: " + e.message); }
}

function openService(url){
  const target = state.proxy ? (PROXY_BASE + "?url=" + encodeURIComponent(url)) : url;
  const browser = document.getElementById("browser");
  if (browser){ browser.src = target; window.scrollTo(0, document.body.scrollHeight); }
  else{
    const ifr = document.createElement("iframe");
    ifr.className = "browser";
    ifr.id = "browser";
    ifr.src = target;
    document.getElementById("appRoot").appendChild(ifr);
  }
}

// ========== Screens ==========
function renderUnauthed(){
  const root = document.getElementById("appRoot");
  root.innerHTML = \`
  <div class="center">
    <div style="font-size:17px;font-weight:700">Вход в Sphere</div>
    <div id="tg-root"></div>
    <div id="tg-missing" class="muted" style="display:none">
      TG-бот не настроен (нет TG_BOT_NAME/TG_BOT_TOKEN)
    </div>
    <button class="btn" id="ipBtn">Показать IP через прокси</button>
  </div>\`;
  document.getElementById("ipBtn").addEventListener("click", testProxy);

  if (BOT_NAME) {
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.setAttribute("data-telegram-login", BOT_NAME);
    s.setAttribute("data-size", "large");
    s.setAttribute("data-auth-url", "/auth/telegram");
    s.setAttribute("data-request-access", "write");
    document.getElementById("tg-root").appendChild(s);
  } else {
    document.getElementById("tg-missing").style.display = "block";
  }
}

function renderNamePrompt(){
  const root = document.getElementById("appRoot");
  root.innerHTML = \`
    <div class="card">
      <div style="font-size:16px;font-weight:700;margin-bottom:8px">Как к тебе обращаться?</div>
      <input class="name" id="nameInput" placeholder="Имя" autocomplete="name" />
      <br/>
      <button class="btn" id="saveName">Сохранить</button>
    </div>\`;
  document.getElementById("saveName").addEventListener("click", () => {
    const v = document.getElementById("nameInput").value.trim();
    if (!v) return alert("Введите имя");
    loginName(v);
  });
}

function renderAuthed(){
  const root = document.getElementById("appRoot");
  const name = (state.me && state.me.name) || (state.me && state.me.first_name) || "User";
  root.innerHTML = \`
    <div class="card">
      <div class="row">
        <div>
          <div style="font-weight:700">Привет, \${name}</div>
          <div class="muted">Все запросы из Sphere можно пускать через наш прокси.</div>
        </div>
        <button class="btn" id="checkIp">IP через прокси</button>
      </div>
      <div class="grid" style="margin-top:12px">
        <div class="app add" id="addApp">+</div>
        <div class="app" id="yt">YouTube</div>
        <div class="app" id="xapp">X</div>
        <div class="app" id="search">Search</div>
      </div>
    </div>\`;
  document.getElementById("checkIp").addEventListener("click", testProxy);
  document.getElementById("addApp").addEventListener("click", () => openService('https://m.wikipedia.org/'));
  document.getElementById("yt").addEventListener("click", () => openService('https://m.youtube.com/'));
  document.getElementById("xapp").addEventListener("click", () => openService('https://m.twitter.com/'));
  document.getElementById("search").addEventListener("click", () => openService('https://lite.bing.com/'));
}

async function boot(){
  setProxy(true);
  document.getElementById("proxyToggle").onclick = () => setProxy(!state.proxy);
  state.me = await apiMe();
  rerender();
}
boot();
</script>
</body></html>`;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  return res.end(html);
}

  // профиль для iOS
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
      "Content-Disposition": 'attachment; filename="Sphere.mobileconfig"'
    });
    return res.end(xml);
  }

  // API
  if (req.url.startsWith("/api/me")) {
    const me = verifySession(getCookies(req).sid) || {};
    res.writeHead(200, {"Content-Type":"application/json"}); return res.end(JSON.stringify(me));
  }
  if (req.url.startsWith("/api/name") && req.method === "POST") {
    const me = verifySession(getCookies(req).sid) || {};
    let name = ""; try { name = JSON.parse(await readBody(req)).name || ""; } catch {}
    const sid = signSession({ ...me, name: String(name).slice(0,40) });
    setCookie(res, "sid", sid);
    res.writeHead(200, {"Content-Type":"application/json"}); return res.end(JSON.stringify({ok:true}));
  }
  if (req.url.startsWith("/auth/telegram")) {
    let data = {};
    if (req.method === "POST") {
      (await readBody(req)).split("&").forEach(p => { const [k,v] = p.split("="); if (k) data[decodeURIComponent(k)] = decodeURIComponent(v||""); });
    } else {
      const q = new URL(req.url, "http://local").searchParams; q.forEach((v,k)=> data[k]=v);
    }
    const user = checkTelegramAuth(data);
    if (!user) { res.writeHead(400, {"Content-Type":"text/plain"}); return res.end("Bad Telegram login"); }
    const sid = signSession({ id:user.id, first_name:user.first_name, username:user.username });
    setCookie(res, "sid", sid);
    res.writeHead(302, { "Location": "/app" }); return res.end();
  }

  // /fetch — reverse proxy (GET)
  if (req.url.startsWith("/fetch")) {
    if (req.method === "OPTIONS") { setCORS(res); res.writeHead(204); return res.end(); }
    setCORS(res);
    if (!authOk(req)) { res.writeHead(401, {"WWW-Authenticate":'Basic realm="Proxy"'}); return res.end("Auth required"); }
    try {
      const q = new URL(req.url, "http://local");
      const target = q.searchParams.get("url");
      if (!target) { res.writeHead(400); return res.end("Missing url"); }
      const t = new URL(target);
      if (!/^https?:$/.test(t.protocol)) { res.writeHead(400); return res.end("Only http/https"); }
      const mod = t.protocol === "https:" ? https : http;
      const up = mod.request({
        hostname: t.hostname, port: t.port || (t.protocol==="https:"?443:80),
        path: t.pathname + (t.search||""), method: "GET",
        headers: { "User-Agent": req.headers["user-agent"]||"Sphere", "Accept":"*/*" },
        timeout: 15000
      }, u => {
        const h = { ...u.headers, "access-control-allow-origin":"*" };
        delete h["x-frame-options"]; delete h["content-security-policy"];
        res.writeHead(u.statusCode||200, h); u.pipe(res);
      });
      up.on("error", e => { res.writeHead(502); res.end("Fetch error: "+e.message); });
      up.end();
    } catch(e){ res.writeHead(400); res.end("Bad url: "+e.message); }
    return;
  }

  // форвард-прокси (может блокироваться у провайдера)
  if (!authOk(req)) {
    res.writeHead(407, { "Proxy-Authenticate": 'Basic realm="Proxy"' });
    return res.end("Proxy auth required");
  }
  proxy.web(req, res, { target: req.url, changeOrigin: true }, (err) => {
    res.writeHead(502); res.end("Bad gateway: "+err.message);
  });
});

// HTTPS CONNECT
server.on("connect", (req, clientSocket, head) => {
  if (!authOk(req)) {
    clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Proxy"\r\n\r\n');
    return clientSocket.end();
  }
  const [host, port] = (req.url||"").split(":");
  const serverSocket = net.connect(port||443, host, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head?.length) serverSocket.write(head);
    serverSocket.pipe(clientSocket); clientSocket.pipe(serverSocket);
  });
  serverSocket.on("error", () => { clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n"); clientSocket.end(); });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log("Sphere running on " + PORT));

