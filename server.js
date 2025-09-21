// SPHERE server (Render)
// - /app (+ static /public)
// - /api/config, /auth/telegram, /api/me, /api/name
// - /api/spheres (GET/POST/DELETE) — привязаны к Telegram-аккаунту (память процесса)
// - /m?url=... — реверс-прокси в iframe через платный UPSTREAM_PROXY, снимаем XFO/CSP
// - /Sphere.mobileconfig, /healthz

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const { ProxyAgent } = require("proxy-agent");

// ===== ENV =====
const PORT = process.env.PORT || 8080;
const STATIC_DIR = path.join(__dirname, "public");

// твой платный прокси (можно жёстко, но лучше через ENV)
const UPSTREAM_PROXY =
  process.env.UPSTREAM_PROXY ||
  "http://mhR8veLB:cDCGv5YT@154.81.197.179:64902";

const upstreamAgent = UPSTREAM_PROXY ? new ProxyAgent(UPSTREAM_PROXY) : undefined;

const BOT_NAME   = process.env.TG_BOT_NAME   || "";
const BOT_TOKEN  = process.env.TG_BOT_TOKEN  || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "change_me_secret";

function sign(obj){
  const b64 = Buffer.from(JSON.stringify(obj),"utf8").toString("base64url");
  const mac = crypto.createHmac("sha256", SESSION_SECRET).update(b64).digest("base64url");
  return `${b64}.${mac}`;
}
function verify(token){
  if(!token) return null;
  const [b64, mac] = token.split(".");
  const mac2 = crypto.createHmac("sha256", SESSION_SECRET).update(b64).digest("base64url");
  if(mac !== mac2) return null;
  try { return JSON.parse(Buffer.from(b64,"base64url").toString("utf8")); } catch{ return null; }
}
function getCookies(req){
  const out={}; const raw=req.headers.cookie||"";
  raw.split(";").forEach(p=>{const i=p.indexOf("="); if(i>0) out[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1));});
  return out;
}
function setCookie(res,name,val,days=30){
  const exp=new Date(Date.now()+days*864e5).toUTCString();
  res.setHeader("Set-Cookie",`${name}=${encodeURIComponent(val)}; Path=/; Expires=${exp}; HttpOnly; SameSite=Lax; Secure`);
}
function readBody(req){ return new Promise(r=>{let s=""; req.on("data",d=>s+=d); req.on("end",()=>r(s));}); }
function setCORS(res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","content-type");
}

// Telegram Login check
function checkTelegramAuth(data){
  if (!BOT_TOKEN) return null;
  const { hash, ...rest } = data;
  const str = Object.keys(rest).sort().map(k=>`${k}=${rest[k]}`).join("\n");
  const secret = crypto.createHash("sha256").update(BOT_TOKEN).digest();
  const hmac = crypto.createHmac("sha256", secret).update(str).digest("hex");
  if (hmac !== hash) return null;
  const now = Math.floor(Date.now()/1000);
  if (Math.abs(now - Number(rest.auth_date||now)) > 86400) return null;
  return { id:String(rest.id), username:rest.username||"", first_name:rest.first_name||"", photo_url:rest.photo_url||"" };
}

// Псевдо-БД в памяти процесса
// users[tid] = { id, name, handle, photo, spheres:[{id,name,url}] }
const users = Object.create(null);

// Прокси GET через UPSTREAM_PROXY, снимаем XFO/CSP
function stripHeaders(h){
  const out = { ...h, "access-control-allow-origin":"*" };
  delete out["x-frame-options"];
  delete out["content-security-policy"];
  delete out["content-security-policy-report-only"];
  return out;
}
function proxyGET(targetUrl, req, res){
  const t = new URL(targetUrl);
  const mod = t.protocol==="https:" ? https : http;
  const up = mod.request({
    protocol:t.protocol, hostname:t.hostname, port:t.port||(t.protocol==="https:"?443:80),
    path:t.pathname+(t.search||""), method:"GET",
    headers:{ "User-Agent": req.headers["user-agent"]||"Sphere", "Accept":"*/*" },
    agent: upstreamAgent, timeout:20000
  }, u=>{ res.writeHead(u.statusCode||200, stripHeaders(u.headers)); u.pipe(res); });
  up.on("error",e=>{ res.writeHead(502,{"Content-Type":"text/plain"}); res.end("Upstream error: "+e.message); });
  up.end();
}

const server = http.createServer(async (req,res)=>{
  try{
    if (req.url==="/healthz"){ res.writeHead(200,{"Content-Type":"text/plain"}); return res.end("ok"); }
    if (req.method==="OPTIONS"){ setCORS(res); res.writeHead(204); return res.end(); }

    // static
    if (req.url==="/" || req.url==="/app"){
      const html=fs.readFileSync(path.join(STATIC_DIR,"index.html"));
      res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"}); return res.end(html);
    }
    if (req.url.startsWith("/app.js")){
      const js=fs.readFileSync(path.join(STATIC_DIR,"app.js"));
      res.writeHead(200,{"Content-Type":"text/javascript; charset=utf-8"}); return res.end(js);
    }

    // webclip
    if (req.url==="/Sphere.mobileconfig"){
      const targetUrl="https://"+req.headers.host+"/app";
      const xml=`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
 <key>PayloadContent</key><array>
  <dict><key>IsRemovable</key><true/><key>Label</key><string>Sphere</string>
   <key>PayloadIdentifier</key><string>com.sphere.webclip</string>
   <key>PayloadType</key><string>com.apple.webClip</string>
   <key>PayloadUUID</key><string>9F3C6AE8-9D8E-4E1B-9F11-1234567890AB</string>
   <key>PayloadVersion</key><integer>1</integer><key>Precomposed</key><true/>
   <key>URL</key><string>${targetUrl}</string><key>FullScreen</key><true/></dict>
 </array>
 <key>PayloadDisplayName</key><string>Sphere Profile</string>
 <key>PayloadIdentifier</key><string>com.sphere.profile</string>
 <key>PayloadRemovalDisallowed</key><false/><key>PayloadType</key><string>Configuration</string>
 <key>PayloadUUID</key><string>6B7E9E1C-3C1A-4A4B-B0D2-ABCDEF012345</string><key>PayloadVersion</key><integer>1</integer>
</dict></plist>`;
      res.writeHead(200,{
        "Content-Type":"application/x-apple-aspen-config",
        "Content-Disposition":'attachment; filename="Sphere.mobileconfig"'
      }); return res.end(xml);
    }

    // реверс-прокси
    if (req.url.startsWith("/m")){
      const q=new URL(req.url,"http://local"); const u=q.searchParams.get("url");
      if(!u){ res.writeHead(400,{"Content-Type":"text/plain"}); return res.end("Missing url"); }
      return proxyGET(u, req, res);
    }

    // === API ===
    setCORS(res);

    // конфиг для фронта (имя бота)
    if (req.url==="/api/config"){
      res.writeHead(200,{"Content-Type":"application/json"});
      return res.end(JSON.stringify({ botName: BOT_NAME || "" }));
    }

    // кто я
    if (req.url.startsWith("/api/me")){
      const sid=verify(getCookies(req).sid); const u=sid?users[sid.id]:null;
      res.writeHead(200,{"Content-Type":"application/json"});
      return res.end(JSON.stringify(u?{id:u.id,name:u.name||"",handle:u.handle||"",photo:u.photo||""}:{ }));
    }

    // вход через Telegram
    if (req.url.startsWith("/auth/telegram")){
      let data={};
      if (req.method==="POST"){
        (await readBody(req)).split("&").forEach(p=>{const [k,v]=p.split("="); if(k) data[decodeURIComponent(k)]=decodeURIComponent(v||"");});
      } else {
        const sp=new URL(req.url,"http://local").searchParams; sp.forEach((v,k)=>data[k]=v);
      }
      const tgu = checkTelegramAuth(data);
      if (!tgu){ res.writeHead(400,{"Content-Type":"text/plain"}); return res.end("Bad Telegram login"); }
      if (!users[tgu.id]) users[tgu.id]={ id:tgu.id, name:"", handle:"", photo:"", spheres:[] };
      setCookie(res,"sid", sign({id:tgu.id}));
      res.writeHead(302,{ "Location": "/app" }); return res.end();
    }

    // сохранение профиля (имя/ник/фото)
    if (req.url.startsWith("/api/name") && req.method==="POST"){
      const sid=verify(getCookies(req).sid); if(!sid||!users[sid.id]){ res.writeHead(401); return res.end("unauth"); }
      let body={}; try{ body=JSON.parse(await readBody(req)||"{}"); }catch{}
      const handle=String((body.handle||"").replace(/^@/,"")).trim();
      if (!/^([a-zA-Z0-9_.]{3,20})$/.test(handle)){ res.writeHead(400); return res.end("bad_handle"); }
      for(const uid of Object.keys(users)){
        if(uid!==sid.id && users[uid].handle===handle){ res.writeHead(409); return res.end("handle_taken"); }
      }
      const u=users[sid.id];
      u.name=String(body.name||"").slice(0,40);
      u.handle=handle;
      if (body.photo) u.photo=String(body.photo);
      res.writeHead(200,{"Content-Type":"application/json"}); return res.end(JSON.stringify({ok:true}));
    }

    // сферы
    if (req.url.startsWith("/api/spheres")){
      const sid=verify(getCookies(req).sid); if(!sid||!users[sid.id]){ res.writeHead(401); return res.end("unauth"); }
      const u=users[sid.id];
      if (req.method==="GET"){
        res.writeHead(200,{"Content-Type":"application/json"}); return res.end(JSON.stringify(u.spheres||[]));
      }
      if (req.method==="POST"){
        let body={}; try{ body=JSON.parse(await readBody(req)||"{}"); }catch{}
        const name=String(body.name||"").trim(); const url=String(body.url||"").trim();
        if (!name||!url){ res.writeHead(400); return res.end("bad"); }
        if ((u.spheres||[]).some(s=>s.name.toLowerCase()===name.toLowerCase())){ res.writeHead(409); return res.end("duplicate"); }
        const s={ id:crypto.randomUUID(), name, url }; u.spheres.push(s);
        res.writeHead(200,{"Content-Type":"application/json"}); return res.end(JSON.stringify(s));
      }
      if (req.method==="DELETE"){
        const q=new URL(req.url,"http://local"); const id=q.searchParams.get("id");
        u.spheres=(u.spheres||[]).filter(s=>s.id!==id);
        res.writeHead(200,{"Content-Type":"application/json"}); return res.end(JSON.stringify({ok:true}));
      }
    }

    // ip через прокси (отладка)
    if (req.url.startsWith("/api/ip")){
      if (!upstreamAgent){ res.writeHead(200,{"Content-Type":"text/plain"}); return res.end("proxy_not_configured"); }
      const r=https.request({hostname:"api.ipify.org",port:443,path:"/",method:"GET",agent:upstreamAgent,timeout:10000},
        u=>{let s=""; u.on("data",d=>s+=d); u.on("end",()=>{res.writeHead(200,{"Content-Type":"text/plain"}); res.end(s||"");});});
      r.on("error",()=>{res.writeHead(200,{"Content-Type":"text/plain"}); res.end("unknown");}); r.end(); return;
    }

    res.writeHead(404,{"Content-Type":"text/plain"}); res.end("Not found");
  }catch(e){
    res.writeHead(500,{"Content-Type":"text/plain"}); res.end("Server error: "+e.message);
  }
});

server.listen(PORT, ()=>console.log("SPHERE listening on", PORT, "via", UPSTREAM_PROXY||"NO_PROXY"));
