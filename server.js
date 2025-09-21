// server.js — Sphere без бэктиков: UI + Telegram-логин + тумблер Proxy + .mobileconfig
const http = require("http");
const https = require("https");
const net = require("net");
const crypto = require("crypto");
const httpProxy = require("http-proxy");
const { URL } = require("url");

// ---- ENV ----
const USER = process.env.PROXY_USER || "student";
const PASS = process.env.PROXY_PASS || "mypassword";
const BOT_NAME = process.env.TG_BOT_NAME || "";     // имя бота БЕЗ @
const BOT_TOKEN = process.env.TG_BOT_TOKEN || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "change_me_secret";
// --------------

function setCORS(res){ res.setHeader("Access-Control-Allow-Origin","*"); res.setHeader("Access-Control-Allow-Methods","GET, POST, OPTIONS"); res.setHeader("Access-Control-Allow-Headers","authorization, content-type"); }
function authOk(req){ const h=req.headers["proxy-authorization"]||req.headers["authorization"]; if(!h) return false; const p=h.split(" "); if(p.length!==2) return false; const d=Buffer.from(p[1],"base64").toString(); return d===USER+":"+PASS; }
function signSession(o){ const b64=Buffer.from(JSON.stringify(o),"utf8").toString("base64url"); const mac=crypto.createHmac("sha256",SESSION_SECRET).update(b64).digest("base64url"); return b64+"."+mac; }
function verifySession(t){ if(!t) return null; const a=t.split("."); const mac2=crypto.createHmac("sha256",SESSION_SECRET).update(a[0]).digest("base64url"); if(a[1]!==mac2) return null; try{return JSON.parse(Buffer.from(a[0],"base64url").toString("utf8"));}catch{return null;} }
function getCookies(req){ const out={}; (req.headers.cookie||"").split(";").forEach(s=>{const i=s.indexOf("="); if(i>0) out[s.slice(0,i).trim()]=decodeURIComponent(s.slice(i+1));}); return out; }
function setCookie(res,name,val,days=30){ const exp=new Date(Date.now()+days*864e5).toUTCString(); res.setHeader("Set-Cookie",`${name}=${encodeURIComponent(val)}; Path=/; Expires=${exp}; HttpOnly; SameSite=Lax; Secure`); }
function checkTelegramAuth(data){
  if(!BOT_TOKEN) return null;
  const hash=data.hash; const rest={...data}; delete rest.hash;
  const str=Object.keys(rest).sort().map(k=>k+"="+rest[k]).join("\n");
  const secret=crypto.createHash("sha256").update(BOT_TOKEN).digest();
  const h=crypto.createHmac("sha256",secret).update(str).digest("hex");
  if(h!==hash) return null;
  const now=Math.floor(Date.now()/1000);
  if(Math.abs(now-Number(rest.auth_date||now))>86400) return null;
  return { id:String(rest.id), username:rest.username||"", first_name:rest.first_name||"", last_name:rest.last_name||"", photo_url:rest.photo_url||"" };
}
function readBody(req){ return new Promise(r=>{ const ch=[]; req.on("data",d=>ch.push(d)); req.on("end",()=>r(Buffer.concat(ch).toString("utf8"))); }); }

const proxy = httpProxy.createProxyServer({});
const server = http.createServer(async (req,res)=>{
  if(req.url==="/healthz"){ res.writeHead(200,{"Content-Type":"text/plain"}); return res.end("ok"); }

  // ---------- UI ----------
  if(req.url==="/app"){
    const html = [
      "<!doctype html>",
      "<html lang=\"ru\">",
      "<head>",
      "<meta charset=\"utf-8\"/>",
      "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">",
      "<meta name=\"apple-mobile-web-app-capable\" content=\"yes\">",
      "<meta name=\"apple-mobile-web-app-status-bar-style\" content=\"black-translucent\">",
      "<title>Sphere</title>",
      "<style>",
      "  :root{--bg:#0b0d10;--panel:#121418;--line:#1f2329;--text:#e8e8e8;--muted:#a7b0bb}",
      "  html,body{height:100%;margin:0;background:var(--bg);color:var(--text);font:15px/1.4 -apple-system,system-ui,Segoe UI,Roboto}",
      "  .top{position:fixed;left:0;right:0;top:0;height:56px;display:flex;gap:10px;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--line);background:rgba(12,13,14,.9);backdrop-filter:blur(6px);z-index:2}",
      "  .brand{font-weight:800;letter-spacing:.6px}",
      "  .chip{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--line);border-radius:999px;background:var(--panel)}",
      "  .toggle{width:38px;height:22px;border-radius:999px;border:1px solid var(--line);background:#222;position:relative}",
      "  .dot{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#666;transition:.2s}",
      "  .on .dot{left:18px;background:#1ee2a1}",
      "  .content{position:absolute;inset:56px 0 0 0;padding:14px}",
      "  .card{border:1px solid var(--line);background:var(--panel);border-radius:16px;padding:14px}",
      "  .row{display:flex;align-items:center;justify-content:space-between}",
      "  .muted{color:var(--muted)}",
      "  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:12px}",
      "  .app{aspect-ratio:1/1;border:1px dashed var(--line);border-radius:14px;display:flex;align-items:center;justify-content:center;color:var(--muted)}",
      "  .app.add{border-style:solid;color:#e8e8e8}",
      "  .btn{padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--panel);color:#e8e8e8}",
      "  iframe.browser{width:100%;height:60vh;border:1px solid var(--line);border-radius:12px;background:#000;margin-top:12px}",
      "  .center{display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;height:calc(100% - 56px)}",
      "  input.name{width:100%;padding:10px;border-radius:10px;border:1px solid var(--line);background:#0f1114;color:#e8e8e8}",
      "</style>",
      "</head>",
      "<body>",
      "  <div class=\"top\">",
      "    <div class=\"brand\">SPHERE</div>",
      "    <div class=\"chip\" id=\"proxyChip\"><span>Proxy:</span><div class=\"toggle\" id=\"proxyToggle\"><div class=\"dot\"></div></div></div>",
      "  </div>",
      "  <div class=\"content\" id=\"appRoot\"></div>",
      "  <script src=\"/app.js\"></script>",
      "</body>",
      "</html>"
    ].join("\n");
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"}); return res.end(html);
  }

  if(req.url==="/app.js"){
    const js = [
      "(function(){",
      "  var PROXY_BASE = '/fetch';",
      "  var AUTH = 'Basic ' + btoa(" + JSON.stringify(USER) + " + ':' + " + JSON.stringify(PASS) + ");",
      "  var BOT_NAME = " + JSON.stringify(BOT_NAME) + ";",
      "  var state = { proxy: true, me: null };",
      "  function el(id){ return document.getElementById(id); }",
      "  function setProxy(on){ state.proxy=!!on; el('proxyToggle').classList.toggle('on', state.proxy); }",
      "  async function apiMe(){ var r=await fetch('/api/me',{credentials:'include'}); return r.json(); }",
      "  async function loginName(name){ await fetch('/api/name',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({name:name})}); state.me=await apiMe(); render(); }",
      "  async function testProxy(){ try{ var r=await fetch(PROXY_BASE+'?url='+encodeURIComponent('https://api.ipify.org'),{headers:{Authorization:AUTH}}); var ip=await r.text(); alert('IP через прокси: '+ip);}catch(e){ alert('Ошибка: '+e.message);} }",
      "  function openService(url){ var target=state.proxy?(PROXY_BASE+'?url='+encodeURIComponent(url)):url; var b=el('browser'); if(b){ b.src=target; window.scrollTo(0,document.body.scrollHeight);} else{ var ifr=document.createElement('iframe'); ifr.className='browser'; ifr.id='browser'; ifr.src=target; el('appRoot').appendChild(ifr);} }",
      "  function renderUnauthed(){",
      "    var root=el('appRoot');",
      "    root.innerHTML = '' +",
      "      '<div class=\"center\">' +",
      "      '  <div style=\"font-size:17px;font-weight:700\">Вход в Sphere</div>' +",
      "      '  <div id=\"tg-root\"></div>' +",
      "      '  <div id=\"tg-missing\" class=\"muted\" style=\"display:none\">TG-бот не настроен (нет TG_BOT_NAME/TG_BOT_TOKEN)</div>' +",
      "      '  <button class=\"btn\" onclick=\"testProxy()\">Показать IP через прокси</button>' +",
      "      '</div>';",
      "    if (BOT_NAME){",
      "      var s=document.createElement('script'); s.async=true; s.src='https://telegram.org/js/telegram-widget.js?22';",
      "      s.setAttribute('data-telegram-login', BOT_NAME);",
      "      s.setAttribute('data-size','large');",
      "      s.setAttribute('data-auth-url','/auth/telegram');",
      "      s.setAttribute('data-request-access','write');",
      "      el('tg-root').appendChild(s);",
      "    } else { el('tg-missing').style.display='block'; }",
      "  }",
      "  function renderNamePrompt(){",
      "    var root=el('appRoot');",
      "    root.innerHTML = '' +",
      "      '<div class=\"card\">' +",
      "      ' <div style=\"font-size:16px;font-weight:700;margin-bottom:8px\">Как к тебе обращаться?</div>' +",
      "      ' <input class=\"name\" id=\"nameInput\" placeholder=\"Имя\"/><br/>' +",
      "      ' <button class=\"btn\" onclick=\"loginName(document.getElementById(\\'nameInput\\').value)\">Сохранить</button>' +",
      "      '</div>';",
      "  }",
      "  function renderAuthed(){",
      "    var root=el('appRoot');",
      "    var name=(state.me&&state.me.name)||(state.me&&state.me.first_name)||'User';",
      "    root.innerHTML = '' +",
      "      '<div class=\"card\">' +",
      "      '  <div class=\"row\">' +",
      "      '    <div><div style=\"font-weight:700\">Привет, ' + name + '</div><div class=\"muted\">Все запросы из Sphere можно пускать через наш прокси.</div></div>' +",
      "      '    <button class=\"btn\" onclick=\"testProxy()\">IP через прокси</button>' +",
      "      '  </div>' +",
      "      '  <div class=\"grid\" style=\"margin-top:12px\">' +",
      "      '    <div class=\"app add\" onclick=\"openService(\\'https://m.wikipedia.org/\\')\">+</div>' +",
      "      '    <div class=\"app\" onclick=\"openService(\\'https://m.youtube.com/\\')\">YouTube</div>' +",
      "      '    <div class=\"app\" onclick=\"openService(\\'https://m.twitter.com/\\')\">X</div>' +",
      "      '    <div class=\"app\" onclick=\"openService(\\'https://lite.bing.com/\\')\">Search</div>' +",
      "      '  </div>' +",
      "      '</div>';",
      "  }",
      "  async function boot(){ setProxy(true); document.getElementById('proxyToggle').onclick=function(){ setProxy(!state.proxy); }; state.me=await apiMe(); if(!state.me||!state.me.id) renderUnauthed(); else if(!state.me.name) renderNamePrompt(); else renderAuthed(); }",
      "  window.testProxy=testProxy; window.openService=openService; window.loginName=loginName;",
      "  boot();",
      "})();"
    ].join("\n");
    res.writeHead(200,{"Content-Type":"text/javascript; charset=utf-8"}); return res.end(js);
  }

  // ---------- iOS profile ----------
  if(req.url==="/Sphere.mobileconfig"){
    const targetUrl="https://"+req.headers.host+"/app";
    const xml = [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
      "<plist version=\"1.0\"><dict>",
      "  <key>PayloadContent</key><array>",
      "    <dict>",
      "      <key>IsRemovable</key><true/>",
      "      <key>Label</key><string>Sphere</string>",
      "      <key>PayloadIdentifier</key><string>com.sphere.webclip</string>",
      "      <key>PayloadType</key><string>com.apple.webClip</string>",
      "      <key>PayloadUUID</key><string>9F3C6AE8-9D8E-4E1B-9F11-1234567890AB</string>",
      "      <key>PayloadVersion</key><integer>1</integer>",
      "      <key>Precomposed</key><true/>",
      "      <key>URL</key><string>"+targetUrl+"</string>",
      "      <key>FullScreen</key><true/>",
      "    </dict>",
      "  </array>",
      "  <key>PayloadDisplayName</key><string>Sphere Profile</string>",
      "  <key>PayloadIdentifier</key><string>com.sphere.profile</string>",
      "  <key>PayloadRemovalDisallowed</key><false/>",
      "  <key>PayloadType</key><string>Configuration</string>",
      "  <key>PayloadUUID</key><string>6B7E9E1C-3C1A-4A4B-B0D2-ABCDEF012345</string>",
      "  <key>PayloadVersion</key><integer>1</integer>",
      "</dict></plist>"
    ].join("\n");
    res.writeHead(200,{"Content-Type":"application/x-apple-aspen-config","Content-Disposition":"attachment; filename=\"Sphere.mobileconfig\""}); 
    return res.end(xml);
  }

  // ---------- API ----------
  if(req.url.startsWith("/api/me")){
    const me=verifySession(getCookies(req).sid)||{};
    res.writeHead(200,{"Content-Type":"application/json"}); return res.end(JSON.stringify(me));
  }
  if(req.url.startsWith("/api/name") && req.method==="POST"){
    const me=verifySession(getCookies(req).sid)||{}; let name=""; try{name=JSON.parse(await readBody(req)).name||"";}catch{}
    const sid=signSession(Object.assign({},me,{name:String(name).slice(0,40)})); setCookie(res,"sid",sid);
    res.writeHead(200,{"Content-Type":"application/json"}); return res.end(JSON.stringify({ok:true}));
  }
  if(req.url.startsWith("/auth/telegram")){
    let data={};
    if(req.method==="POST"){ (await readBody(req)).split("&").forEach(p=>{const kv=p.split("="); if(kv[0]) data[decodeURIComponent(kv[0])]=decodeURIComponent(kv[1]||"");}); }
    else { const q=new URL(req.url,"http://local").searchParams; q.forEach((v,k)=>data[k]=v); }
    const user=checkTelegramAuth(data);
    if(!user){ res.writeHead(400,{"Content-Type":"text/plain"}); return res.end("Bad Telegram login"); }
    const sid=signSession({id:user.id,first_name:user.first_name,username:user.username}); setCookie(res,"sid",sid);
    res.writeHead(302,{Location:"/app"}); return res.end();
  }

  // ---------- /fetch (reverse proxy) ----------
  if(req.url.startsWith("/fetch")){
    if(req.method==="OPTIONS"){ setCORS(res); res.writeHead(204); return res.end(); }
    setCORS(res);
    if(!authOk(req)){ res.writeHead(401,{"WWW-Authenticate":"Basic realm=\"Proxy\""}); return res.end("Auth required"); }
    try{
      const q=new URL(req.url,"http://local"); const target=q.searchParams.get("url"); if(!target){ res.writeHead(400); return res.end("Missing url"); }
      const t=new URL(target); if(!/^https?:$/.test(t.protocol)){ res.writeHead(400); return res.end("Only http/https"); }
      const mod=t.protocol==="https:"?https:http;
      const up=mod.request({hostname:t.hostname,port:t.port||(t.protocol==="https:"?443:80),path:t.pathname+(t.search||""),method:"GET",headers:{"User-Agent":req.headers["user-agent"]||"Sphere","Accept":"*/*"},timeout:15000},u=>{
        const h=Object.assign({},u.headers,{"access-control-allow-origin":"*"}); delete h["x-frame-options"]; delete h["content-security-policy"]; res.writeHead(u.statusCode||200,h); u.pipe(res);
      });
      up.on("error",e=>{ res.writeHead(502); res.end("Fetch error: "+e.message); }); up.end();
    }catch(e){ res.writeHead(400); res.end("Bad url: "+e.message); }
    return;
  }

  // ---------- forward proxy ----------
  if(!authOk(req)){ res.writeHead(407,{"Proxy-Authenticate":"Basic realm=\"Proxy\""}); return res.end("Proxy auth required"); }
  proxy.web(req,res,{target:req.url,changeOrigin:true},(err)=>{ res.writeHead(502); res.end("Bad gateway: "+err.message); });
});

// CONNECT
server.on("connect",(req,clientSocket,head)=>{
  if(!authOk(req)){ clientSocket.write("HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"Proxy\"\r\n\r\n"); return clientSocket.end(); }
  const hp=(req.url||"").split(":"); const serverSocket=net.connect(hp[1]||443,hp[0],()=>{ clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n"); if(head&&head.length) serverSocket.write(head); serverSocket.pipe(clientSocket); clientSocket.pipe(serverSocket); });
  serverSocket.on("error",()=>{ clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n"); clientSocket.end(); });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT,()=>console.log("Sphere running on "+PORT));
