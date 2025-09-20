// server.js
const http = require("http");
const net = require("net");
const httpProxy = require("http-proxy");

const USER = "student";
const PASS = "mypassword"; // поменяй пароль

function checkAuth(header) {
  if (!header) return false;
  const parts = header.split(" ");
  if (parts.length !== 2) return false;
  const decoded = Buffer.from(parts[1], "base64").toString();
  return decoded === `${USER}:${PASS}`;
}

const proxy = httpProxy.createProxyServer({});
const server = http.createServer((req, res) => {
  const pa = req.headers["proxy-authorization"];
  if (!checkAuth(pa)) {
    res.writeHead(407, { "Proxy-Authenticate": 'Basic realm="Proxy"' });
    return res.end("Proxy auth required");
  }
  proxy.web(req, res, { target: req.url, changeOrigin: true }, (err) => {
    res.writeHead(502);
    res.end("Bad gateway: " + err.message);
  });
});

server.on("connect", (req, clientSocket, head) => {
  const auth = req.headers["proxy-authorization"];
  if (!checkAuth(auth)) {
    clientSocket.write(
      "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"Proxy\"\r\n\r\n"
    );
    return clientSocket.end();
  }

  const [host, port] = req.url.split(":");
  const serverSocket = net.connect(port || 443, host, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head && head.length) serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  serverSocket.on("error", () => {
    clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    clientSocket.end();
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
