// server.js — прокси + страница Sphere + установка ярлыка на iOS через .mobileconfig

const http = require("http");
const https = require("https");
const net = require("net");
const httpProxy = require("http-proxy");
const { URL } = require("url");

// креды для /fetch и форвард-прокси
const USER = process.env.PROXY_USER || "student";
const PASS = process.env.PROXY_PASS || "mypassword";

function authOk(req) {
  const h = req.headers["proxy-authorization"] || req.headers["authorization"];
  if (!h) return false;
  const parts = h.split(" ");
  if (parts.length !== 2) return false;
  const decoded = Buffer.from(parts[1], "base64").toString();
  return decoded === `${USER}:${PASS}`;
}

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
}

const proxy = httpProxy.createProxyServer({});
const server = http.createServer((req, res) => {
  // 0) healthcheck без авторизации
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("ok");
  }

  // 1) СТРАНИЦА ПРИЛОЖЕНИЯ (откроется из ярлыка Sphere)
  if (req.url === "/app") {
    const html = `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Sphere</title>
<style>
  html,body{height:100%;margin:0;background:#0a0b0c;color:#e8e8e8;font-family:-apple-system,system-ui,Segoe UI,Roboto}
  .top{position:fixed;inset:0 auto auto 0;right:0;height:52px;display:flex;gap:8px;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #1b1e22;background:rgba(12,13,14,0.85);backdrop-filter:blur(6px);z-index:2}
  .btn{padding:8px 12px;border:1px solid #2a2e33;border-radius:10px;color:#cfd3d8;background:#121416}
  .frame{position:absolute;left:0;right:0;top:52px;bottom:0;border:0;width:100%;height:calc(100% - 52px);background:#000}
</style>
</head><body>
<div class="top">
  <div style="font-weight:700;letter-spacing:.5px">SPHERE</div>
  <button class="btn" id="btn-ip">Показать IP через прокси</button>
</div>

<!-- Если есть собственный интерфейс, подставь сюда свой HTML/URL -->
<iframe class="frame" src="about:blank" title="Sphere UI"></iframe>

<script>
const PROXY_BASE = "/fetch";
const AUTH = "Basic " + btoa("${USER}:${PASS}");

document.getElementById("btn-ip").onclick = async () => {
  try{
    const r = await fetch(PROXY_BASE + "?url=https://api.ipify.org", { headers:{Authorization: AUTH} });
    const ip = await r.text();
    alert("IP через прокси: " + ip);
  }catch(e){ alert("Ошибка: " + e.message); }
};
</script>
</body></html>`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(html);
  }

  // 2) ПРОФИЛЬ ДЛЯ iOS (WebClip, без MDM): ярлык "Sphere" на Домой
if (req.url === "/Sphere.mobileconfig") {
  const targetUrl = "https://" + req.headers.host + "/app"; // куда откроется ярлык
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>PayloadContent</key>
    <array>
      <dict>
        <key>IsRemovable</key><true/>
        <key>Label</key><string>Sphere</string>
        <key>PayloadIdentifier</key><string>com.sphere.webclip</string>
        <key>PayloadType</key><string>com.apple.webClip</string>
        <key>PayloadUUID</key><string>9F3C6AE8-9D8E-4E1B-9F11-1234567890AB</string>
        <key>PayloadVersion</key><integer>1</integer>
        <key>Precomposed</key><true/>
        <key>URL</key><string>${targetUrl}</string>
      </dict>
    </array>
    <key>PayloadDisplayName</key><string>Sphere Profile</string>
    <key>PayloadIdentifier</key><string>com.sphere.profile</string>
    <key>PayloadRemovalDisallowed</key><false/>
    <key>PayloadType</key><string>Configuration</string>
    <key>PayloadUUID</key><string>6B7E9E1C-3C1A-4A4B-B0D2-ABCDEF012345</string>
    <key>PayloadVersion</key><integer>1</integer>
  </dict>
</plist>`;
  res.writeHead(200, {
    "Content-Type": "application/x-apple-aspen-config",
    "Content-Disposition": 'attachment; filename="Sphere.mobileconfig"'
  });
  return res.end(xml);
}

  // 3) /fetch?url=... — reverse-proxy (для демонстрации "скрытия IP")
  if (req.url.startsWith("/fetch")) {
    if (req.method === "OPTIONS") { setCORS(res); res.writeHead(204); return res.end(); }
    setCORS(res);
    if (!authOk(req)) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Proxy"' });
      return res.end("Auth required");
    }
    try {
      const q = new URL(req.url, "http://local");
      const target = q.searchParams.get("url");
      if (!target) { res.writeHead(400); return res.end("Missing url param"); }
      const t = new URL(target);
      if (t.protocol !== "http:" && t.protocol !== "https:") {
        res.writeHead(400); return res.end("Only http/https allowed");
      }
      const mod = t.protocol === "https:" ? https : http;
      const upstream = mod.request({
        hostname: t.hostname,
        port: t.port || (t.protocol === "https:" ? 443 : 80),
        path: t.pathname + (t.search || ""),
        method: "GET",
        headers: { "User-Agent": req.headers["user-agent"] || "curl", "Accept": "*/*" },
        timeout: 15000
      }, up => {
        const headers = { ...up.headers, "access-control-allow-origin": "*" };
        res.writeHead(up.statusCode || 502, headers);
        up.pipe(res);
      });
      upstream.on("error", e => { res.writeHead(502); res.end("Fetch error: " + e.message); });
      upstream.end();
    } catch (e) {
      res.writeHead(400); return res.end("Bad url: " + e.message);
    }
    return;
  }

  // 4) Форвард-прокси (может блокироваться Cloudflare)
  if (!authOk(req)) {
    res.writeHead(407, { "Proxy-Authenticate": 'Basic realm="Proxy"' });
    return res.end("Proxy auth required");
  }
  proxy.web(req, res, { target: req.url, changeOrigin: true }, (err) => {
    res.writeHead(502);
    res.end("Bad gateway: " + err.message);
  });
});

server.on("connect", (req, clientSocket, head) => {
  if (!authOk(req)) {
    clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Proxy"\r\n\r\n');
    return clientSocket.end();
  }
  const [host, port] = (req.url || "").split(":");
  const serverSocket = net.connect(port || 443, host, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head?.length) serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });
  serverSocket.on("error", () => {
    clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    clientSocket.end();
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Proxy running on ${PORT}`));


