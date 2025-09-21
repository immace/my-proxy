// server.js — прокси для демонстрации "скрытия IP":
//  - /healthz  — проверка живости (без пароля)
//  - /fetch?url=... — безопасный reverse-proxy (с паролем) => работает за Cloudflare/Render
//  - форвард-прокси (HTTP/HTTPS CONNECT) — оставлен, но может блокироваться Cloudflare

const http = require("http");
const https = require("https");
const net = require("net");
const httpProxy = require("http-proxy");
const { URL } = require("url");

// логин/пароль берём из переменных окружения (задай в Render → Environment)
const USER = process.env.PROXY_USER || "student";
const PASS = process.env.PROXY_PASS || "mypassword";

// удобная проверка basic-auth (поддерживает Proxy-Authorization И Authorization)
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
  // 1) healthcheck — без авторизации
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("ok");
  }

  // 2) /fetch?url=... — reverse-proxy (будет работать на Render за Cloudflare)
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
        // пробрасываем код/заголовки/тело как есть
        const headers = { ...up.headers };
        // Разрешим клиентам читать ответ из браузера (CORS)
        headers["access-control-allow-origin"] = "*";
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

  // 3) Форвард-прокси (может быть ограничен Cloudflare/Render)
  if (!authOk(req)) {
    res.writeHead(407, { "Proxy-Authenticate": 'Basic realm="Proxy"' });
    return res.end("Proxy auth required");
  }

  proxy.web(req, res, { target: req.url, changeOrigin: true }, (err) => {
    res.writeHead(502);
    res.end("Bad gateway: " + err.message);
  });
});

// HTTPS CONNECT для форвард-прокси (может не проходить через Cloudflare)
server.on("connect", (req, clientSocket, head) => {
  if (!authOk(req)) {
    clientSocket.write(
      'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Proxy"\r\n\r\n'
    );
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

const PORT = process.env.PORT || 8080; // Render задаёт PORT сам
server.listen(PORT, () => console.log(`Proxy running on ${PORT}`));
