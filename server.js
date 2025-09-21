// SPHERE server (Render)
// - /app            — UI (вставляет имя TG-бота из ENV)
// - /auth/telegram  — логин через Telegram (cookie sid)
// - /api/me, /api/name  — профиль пользователя
// - /api/profile, /api/profile/ensure — заглушки профилей
// - /m?url=...      — реверс-прокси для iframe (через твой UPSTREAM_PROXY)
// - /api/ip         — проверка внешнего IP через тот же прокси
// - /Sphere.mobileconfig, /healthz

const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { createAgent } = require("proxy-agent"); // <— ВАЖНО: правильный импорт

const PORT = process.env.PORT || 8080;
const STATIC_DIR = path.join(__dirname, "public");

const UPSTREAM_PROXY = process.env.UPSTREAM_PROXY || ""; // http://user:pass@host:port
const upstreamAgent = UPSTREAM_PROXY ? createAgent(UPSTREAM_PROXY) : undefined;

const TG_BOT_NAME  = process.env.TG_BOT_NAME  || "";
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "change_me_secret";

// ====== простая подписанная cookie-сессия ======
function sign(payload) {
  const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = crypto.createHmac("sha256", SESSION_SECRET).update(b64).digest("base64url");
  return `${b64}.${mac}`;
}
function verify(token) {
  if (!token) return null;
  const [b64, mac] = token.split(".");
  const mac2 = crypto.createHmac("sha256", SESSION_SECRET).update(b64).digest("base64url");
  if (mac !== mac2) return null;
  try { return JSON.parse(Buffer.from(b64, "base64url").toString("utf8")); } catch { return null; }
}
function getCookies(req) {
  const out = {}; (req.headers.cookie||"").split(";").forEach(p=>{const i=p.indexOf("="); if(i>0) out[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1));});
  return out;
}
function setCookie(res, name, val, days=180){
  const exp = new Date(Date.now()+days*864e5).toUTCString();
  res.setHeader("Set-Cookie", `${name}=${encodeURIComponent(val)}; Path=/; Expires=${exp}; HttpOnly; SameSite=Lax; Secure`);
}

function setCORS(res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","content-type,authorization");
}
function readBody(req){return new Promise(r=>{let raw="";req.on("data",d=>raw+=d);req.on("end",()=>r(raw));});}
function stripFrame(h){
  const y = {...h, "access-control-allow-origin":"*"};
  delete y["x-frame-options"]; delete y["content-security-policy"]; delete y["content-security-policy-report-only"];
  return y;
}
function proxyGET(targetUrl, req, res){
  const t = new URL(targetUrl);
  const mod = t.protocol==="https:" ? https : http;
  const up = mod.request({
    protocol: t.protocol, hostname: t.hostname, port: t.port || (t.protocol==="https:"?443:80),
    path: t.pathname + (t.search||""), method:"GET",
    headers: {"User-Agent": req.headers["user-agent"]||"Sphere", "Accept":"*/*"},
    agent: upstreamAgent, timeout: 25000
  }, u => { res.writeHead(u.statusCode||200, stripFrame(u.headers)); u.pipe(res); });
  up.on("error", e => { res.writeHead(502, {"Content-Type":"text/plain"}); res.end("Upstream error: "+e.message); });
  up.end();
}

// ====== in-memory users (демо; на проде — БД)
const USERS = new Map(); // key: tg_id, val: {id, first_name, username, name, handle, photo}
function meFromReq(req){ const sid = getCookies(req).sid; const s = verify(sid); if(!s) return null; return USERS.get(s.id)||s; }

// Telegram login check
function checkTelegramAuth(data){
  if(!TG_BOT_TOKEN) return null;
  const { hash, ...rest } = data;
  const str = Object.keys(rest).sort().map(k=>`${k}=${rest[k]}`).join("\n");
  const secret = crypto.createHash("sha256").update(TG_BOT_TOKEN).digest();
  const hmac = crypto.createHmac("sha256", secret).update(str).digest("hex");
  if(hmac!==hash) return null;
  return { id:String(rest.id), first_name: rest.first_name||"", username: rest.username||"" };
}

// ---------------- server ----------------
const server = http.createServer(async (req,res)=>{
  try{
    if(req.url==="/healthz"){ res.writeHead(200,{"Content-Type":"text/plain"}); return res.end("ok"); }

    // /app — генерим обёртку и передаём имя бота внутрь
    if(req.url==="/" || req.url==="/app"){
      const html = `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>SPHERE</title>
</head><body>
<script>window.BOT_NAME=${JSON.stringify(TG_BOT_NAME)}</script>
<script src="/app.js" defer></script>
</body></html>`;
      res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"}); return res.end(html);
    }
    if(req.url.startsWith("/app.js")){
      const buf = fs.readFileSync(path.join(STATIC_DIR,"app.js"));
      res.writeHead(200,{"Content-Type":"text/javascript; charset=utf-8"}); return res.end(buf);
    }

    // Telegram auth callback
    if(req.url.startsWith("/auth/telegram")){
      let data={};
      if(req.method==="POST"){
        (await readBody(req)).split("&").forEach(p=>{const[k,v]=p.split("="); if(k) data[decodeURIComponent(k)]=decodeURIComponent(v||"");});
      }else{
        const q=new URL(req.url,"http://x").searchParams; q.forEach((v,k)=>data[k]=v);
      }
      const u = checkTelegramAuth(data);
      if(!u){ res.writeHead(400,{"Content-Type":"text/plain"}); return res.end("Bad Telegram login"); }
      // создать/обновить юзера
      if(!USERS.has(u.id)) USERS.set(u.id, { ...u });
      const sid = sign({ id:u.id });
      setCookie(res,"sid",sid);
      res.writeHead(302,{Location:"/app"}); return res.end();
    }

    // API me / set name+handle
    if(req.url.startsWith("/api/me")){
      const me = meFromReq(req) || {};
      res.writeHead(200,{"Content-Type":"application/json"}); return res.end(JSON.stringify(me));
    }
    if(req.url.startsWith("/api/name") && req.method==="POST"){
      const me = meFromReq(req); if(!me){ res.writeHead(401); return res.end("unauth"); }
      let body={}; try{body=JSON.parse(await readBody(req)||"{}");}catch{}
      const user = USERS.get(me.id) || me;
      if(body.name)   user.name   = String(body.name).slice(0,40);
      if(body.handle){
        if(!/^([a-zA-Z0-9_.]{3,20})$/.test(body.handle)) { res.writeHead(400); return res.end("bad handle"); }
        user.handle = body.handle;
      }
      USERS.set(me.id,user);
      res.writeHead(200,{"Content-Type":"application/json"}); return res.end(JSON.stringify({ok:true}));
    }

    // профили (заглушки)
    if(req.url.startsWith("/api/profile") && req.method==="POST" && !req.url.includes("/ensure")){
      const raw=await readBody(req); let b={}; try{b=JSON.parse(raw||"{}");}catch{}
      const pid = Date.now().toString(36)+Math.random().toString(36).slice(2,7);
      res.writeHead(200,{"Content-Type":"application/json"}); return res.end(JSON.stringify({pid,name:b.name||"Profile",url:b.url||""}));
    }
    if(req.url.startsWith("/api/profile/ensure") && req.method==="POST"){
      const raw=await readBody(req); let b={}; try{b=JSON.parse(raw||"{}");}catch{}
      const pid=b.pid || Date.now().toString(36)+Math.random().toString(36).slice(2,7);
      res.writeHead(200,{"Content-Type":"application/json"}); return res.end(JSON.stringify({pid}));
    }

    // внешний IP по тому же прокси
    if(req.url.startsWith("/api/ip")){
      const rq = https.request({hostname:"api.ipify.org",port:443,path:"/",method:"GET",agent:upstreamAgent,timeout:12000},
        u=>{let s="";u.on("data",d=>s+=d);u.on("end",()=>{res.writeHead(200,{"Content-Type":"text/plain"});res.end(s||"");});});
      rq.on("error",()=>{res.writeHead(200,{"Content-Type":"text/plain"});res.end("unknown");});
      rq.end(); return;
    }

    // главный реверс для iframe
    if(req.url.startsWith("/m")){
      setCORS(res);
      const u = new URL(req.url,"http://x");
      const target = u.searchParams.get("url");
      if(!target){ res.writeHead(400,{"Content-Type":"text/plain"}); return res.end("Missing url"); }
      return proxyGET(target, req, res);
    }

    // профиль для ярлыка iOS
    if(req.url==="/Sphere.mobileconfig"){
      const targetUrl = "https://"+req.headers.host+"/app";
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>PayloadContent</key><array><dict>
<key>IsRemovable</key><true/>
<key>Label</key><string>Sphere</string>
<key>PayloadIdentifier</key><string>com.sphere.webclip</string>
<key>PayloadType</key><string>com.apple.webClip</string>
<key>PayloadUUID</key><string>9F3C6AE8-9D8E-4E1B-9F11-1234567890AB</key>
<key>PayloadVersion</key><integer>1</integer>
<key>URL</key><string>${targetUrl}</string>
<key>FullScreen</key><true/>
</dict></array>
<key>PayloadDisplayName</key><string>Sphere Profile</string>
<key>PayloadIdentifier</key><string>com.sphere.profile</string>
<key>PayloadRemovalDisallowed</key><false/>
<key>PayloadType</key><string>Configuration</string>
<key>PayloadUUID</key><string>6B7E9E1C-3C1A-4A4B-B0D2-ABCDEF012345</key>
<key>PayloadVersion</key><integer>1</integer>
</dict></plist>`;
      res.writeHead(200,{"Content-Type":"application/x-apple-aspen-config","Content-Disposition":'attachment; filename="Sphere.mobileconfig"'}); 
      return res.end(xml);
    }

    res.writeHead(404,{"Content-Type":"text/plain"}); res.end("Not found");
  }catch(e){
    res.writeHead(500,{"Content-Type":"text/plain"}); res.end("Server error: "+e.message);
  }
});
server.listen(PORT, ()=>console.log("SPHERE listening on "+PORT));
