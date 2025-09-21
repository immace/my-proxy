// server.js — Sphere GLASS: 3D стеклянная сфера + добавление сервисов + панель-эмулятор
const http = require("http");
const https = require("https");
const net = require("net");
const crypto = require("crypto");
const httpProxy = require("http-proxy");
const { URL } = require("url");

// === ENV ===
const USER = process.env.PROXY_USER || "student";
const PASS = process.env.PROXY_PASS || "mypassword";
const SESSION_SECRET = process.env.SESSION_SECRET || "change_me_secret";
// ===========

function setCORS(res){ res.setHeader("Access-Control-Allow-Origin","*"); res.setHeader("Access-Control-Allow-Methods","GET, POST, OPTIONS"); res.setHeader("Access-Control-Allow-Headers","authorization, content-type"); }
function authOk(req){ const h=req.headers["proxy-authorization"]||req.headers["authorization"]; if(!h) return false; const p=h.split(" "); if(p.length!==2) return false; const d=Buffer.from(p[1],"base64").toString(); return d===USER+":"+PASS; }
function signSession(o){ const b64=Buffer.from(JSON.stringify(o),"utf8").toString("base64url"); const mac=crypto.createHmac("sha256",SESSION_SECRET).update(b64).digest("base64url"); return b64+"."+mac; }
function verifySession(t){ if(!t) return null; const a=t.split("."); const mac2=crypto.createHmac("sha256",SESSION_SECRET).update(a[0]).digest("base64url"); if(a[1]!==mac2) return null; try{return JSON.parse(Buffer.from(a[0],"base64url").toString("utf8"));}catch{return null;} }
function getCookies(req){ const out={}; (req.headers.cookie||"").split(";").forEach(s=>{const i=s.indexOf("="); if(i>0) out[s.slice(0,i).trim()]=decodeURIComponent(s.slice(i+1));}); return out; }
function setCookie(res,name,val,days=30){ const exp=new Date(Date.now()+days*864e5).toUTCString(); res.setHeader("Set-Cookie",`${name}=${encodeURIComponent(val)}; Path=/; Expires=${exp}; HttpOnly; SameSite=Lax; Secure`); }
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
      "  :root{--bg:#0a0c10;--panel:#111319;--line:#1f2329;--text:#e8ecf1;--muted:#9aa6b2}",
      "  html,body{height:100%;margin:0;background:linear-gradient(180deg,#0a0c10 0%,#0a0c10 55%,#0b1016 100%);color:var(--text);font:15px/1.4 -apple-system,system-ui,Segoe UI,Roboto}",
      "  body{padding-top:env(safe-area-inset-top)}",
      "  /* фон с мягкими светящимися пятнами */",
      "  .backplane{position:fixed;inset:0;pointer-events:none;filter:saturate(110%) blur(20px);opacity:.65}",
      "  .blob{position:absolute;border-radius:50%;filter:blur(30px)}",
      "  .b1{width:420px;height:420px;left:-100px;top:-80px;background:radial-gradient(50% 50% at 50% 50%,rgba(86,161,255,.40),rgba(86,161,255,0) 70%)}",
      "  .b2{width:360px;height:360px;right:-120px;top:10vh;background:radial-gradient(50% 50% at 50% 50%,rgba(255,96,168,.35),rgba(255,96,168,0) 70%)}",
      "  .b3{width:420px;height:420px;left:30vw;bottom:-120px;background:radial-gradient(50% 50% at 50% 50%,rgba(96,255,210,.30),rgba(96,255,210,0) 70%)}",
      "  /* header */",
      "  .top{position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top) + 10px);height:56px;display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid var(--line);border-radius:16px;background:rgba(12,13,16,.85);backdrop-filter:blur(10px);z-index:10}",
      "  .brand{font-weight:800;letter-spacing:.6px}",
      "  .chip{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid var(--line);border-radius:999px;background:var(--panel)}",
      "  .toggle{width:40px;height:24px;border-radius:999px;border:1px solid var(--line);background:#222;position:relative}",
      "  .dot{position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#6b7280;transition:.22s}",
      "  .on .dot{left:18px;background:#1ee2a1}",
      "  .wrap{position:absolute;left:0;right:0;top:calc(env(safe-area-inset-top) + 56px + 24px);bottom:0;display:flex;align-items:center;justify-content:center}",
      "  /* стеклянная сфера + физика */",
      "  .field{position:relative;width:100%;max-width:460px;height:58vh;min-height:360px}",
      "  .sphere{position:absolute;left:50%;top:35%;transform:translate(-50%,-50%);width:120px;height:120px;border-radius:50%;",
      "          background:radial-gradient(70% 60% at 35% 30%,rgba(230,240,255,.35),rgba(200,210,230,.09) 60%,rgba(180,190,205,.06) 70%,rgba(80,90,110,.05) 80%,rgba(0,0,0,.02) 100%),",
      "                     linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.02));",
      "          box-shadow:inset 0 1px 0 rgba(255,255,255,.12), inset 0 -12px 30px rgba(0,0,0,.28), 0 18px 50px rgba(0,0,0,.45);",
      "          border:1px solid rgba(255,255,255,.10);",
      "          backdrop-filter:blur(18px) saturate(140%);",
      "          display:flex;align-items:center;justify-content:center;cursor:grab;user-select:none;}",
      "  .sphere:active{cursor:grabbing}",
      "  .plus{width:48px;height:48px;border-radius:50%;",
      "        background:radial-gradient(60% 60% at 40% 35%, rgba(255,255,255,.35), rgba(255,255,255,.12) 60%, rgba(255,255,255,.06) 61%),",
      "                   linear-gradient(180deg,rgba(255,255,255,.25),rgba(255,255,255,.05));",
      "        display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 0 1px rgba(255,255,255,.25);",
      "        filter:url(#liquid) saturate(125%)}",
      "  .plus span{font-size:26px;font-weight:900;color:#ecf2ff;text-shadow:0 1px 0 rgba(0,0,0,.25)}",
      "  .dock{position:absolute;left:0;right:0;bottom:8px;display:flex;justify-content:center;gap:14px}",
      "  .app{width:84px;height:84px;border-radius:50%;position:relative;display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);backdrop-filter:blur(14px) saturate(140%)}",
      "  .icon{width:60px;height:60px;border-radius:22%/22%;background-size:cover;filter:url(#liquid)}",
      "  .icon-insta{background-image:url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 48 48\"><defs><linearGradient id=\"g\" x1=\"0\" y1=\"1\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"%23f58529\"/><stop offset=\"0.5\" stop-color=\"%23dd2a7b\"/><stop offset=\"1\" stop-color=\"%235159f6\"/></linearGradient></defs><rect width=\"48\" height=\"48\" rx=\"11\" fill=\"url(%23g)\"/><circle cx=\"24\" cy=\"24\" r=\"9\" fill=\"white\"/><circle cx=\"24\" cy=\"24\" r=\"6\" fill=\"%23f58529\"/><circle cx=\"34\" cy=\"14\" r=\"3\" fill=\"white\"/></svg>')}",
      "  .icon-tg{background-image:url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 48 48\"><rect width=\"48\" height=\"48\" rx=\"11\" fill=\"%2329a9eb\"/><path fill=\"white\" d=\"M38 12 9 23l9 3 2 8 5-6 8 6 5-22z\"/></svg>')}",
      "  .sheet{position:fixed;left:0;right:0;bottom:0;top:0;background:rgba(0,0,0,.5);display:none;align-items:flex-end;z-index:20}",
      "  .sheet.open{display:flex}",
      "  .sheet .box{width:100%;background:var(--panel);border-top-left-radius:18px;border-top-right-radius:18px;border-top:1px solid var(--line);padding:14px}",
      "  .box h3{margin:4px 0 10px 0}",
      "  .opt{display:flex;gap:10px;align-items:center;padding:10px;border:1px solid var(--line);border-radius:12px;margin-bottom:10px}",
      "  .btn{padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--text)}",
      "  .panel{position:fixed;left:0;right:0;bottom:0;top:calc(env(safe-area-inset-top) + 56px + 24px);background:#0b0d10;border-top:1px solid var(--line);z-index:25;display:none;flex-direction:column}",
      "  .panel.open{display:flex}",
      "  .panel-bar{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--line)}",
      "  .panel-title{font-weight:700}",
      "  .panel-actions{display:flex;gap:8px}",
      "  .panel-msg{flex:1;display:flex;align-items:center;justify-content:center;color:var(--muted);text-align:center;padding:22px}",
      "  .panel-frame{flex:1;border:0;background:#000}",
      "</style>",
      "</head>",
      "<body>",
      "  <div class=\"backplane\"><div class=\"blob b1\"></div><div class=\"blob b2\"></div><div class=\"blob b3\"></div></div>",
      "  <svg width=\"0\" height=\"0\" style=\"position:absolute\"><filter id=\"liquid\"><feTurbulence type=\"fractalNoise\" baseFrequency=\"0.9\" numOctaves=\"1\" seed=\"3\" result=\"t\"/><feDisplacementMap in=\"SourceGraphic\" in2=\"t\" scale=\"3\" xChannelSelector=\"R\" yChannelSelector=\"G\"/></filter></svg>",
      "  <div class=\"top\"><div class=\"brand\">SPHERE</div><div class=\"chip\"><span>Proxy:</span><div class=\"toggle\" id=\"proxyToggle\"><div class=\"dot\"></div></div></div></div>",
      "  <div class=\"wrap\"><div class=\"field\" id=\"field\">",
      "    <div class=\"sphere\" id=\"big\">",
      "      <div class=\"plus\"><span>+</span></div>",
      "    </div>",
      "    <div class=\"dock\" id=\"dock\"></div>",
      "  </div></div>",
      "  <div class=\"sheet\" id=\"sheet\"><div class=\"box\">",
      "    <h3>Добавить приложение</h3>",
      "    <div class=\"opt\" data-id=\"instagram\"><div class=\"icon icon-insta\"></div><div style=\"flex:1\">Instagram</div><button class=\"btn\">Добавить</button></div>",
      "    <div class=\"opt\" data-id=\"telegram\"><div class=\"icon icon-tg\"></div><div style=\"flex:1\">Telegram (Web)</div><button class=\"btn\">Добавить</button></div>",
      "    <button class=\"btn\" id=\"closeSheet\" style=\"width:100%;margin-top:6px\">Отмена</button>",
      "  </div></div>",
      "  <div class=\"panel\" id=\"panel\">",
      "    <div class=\"panel-bar\"><div class=\"panel-title\" id=\"panelTitle\"></div><div class=\"panel-actions\"><button class=\"btn\" id=\"openExternal\">Открыть через прокси</button><button class=\"btn\" id=\"openDeeplink\" style=\"display:none\">Открыть в приложении</button><button class=\"btn\" id=\"closePanel\">Закрыть</button></div></div>",
      "    <iframe id=\"panelFrame\" class=\"panel-frame\"></iframe>",
      "    <div id=\"panelMsg\" class=\"panel-msg\" style=\"display:none\"></div>",
      "  </div>",
      "  <script src=\"/app.js\"></script>",
      "</body></html>"
    ].join("\n");
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"}); return res.end(html);
  }

  if(req.url==="/app.js"){
    const js = [
      "(function(){",
      "  var AUTH='Basic '+btoa("+JSON.stringify(USER)+"+':'+"+JSON.stringify(PASS)+");",
      "  var PROXY='/fetch';",
      "  var state={proxy:true, apps: JSON.parse(localStorage.getItem('sphereApps')||'[]')};",
      "  var CATALOG={",
      "    instagram:{id:'instagram',name:'Instagram',url:'https://www.instagram.com/',allow:false,deeplink:'instagram://app',icon:'insta'},",
      "    telegram:{id:'telegram',name:'Telegram',url:'https://web.telegram.org/',allow:true,deeplink:'tg://',icon:'tg'}",
      "  };",
      "  function save(){ localStorage.setItem('sphereApps',JSON.stringify(state.apps)); }",
      "  function el(id){return document.getElementById(id)}",
      "  function setProxy(on){ state.proxy=!!on; el('proxyToggle').classList.toggle('on',state.proxy); }",
      "  function addApp(id){ var a=CATALOG[id]; if(!a) return; if(!state.apps.find(x=>x.id===id)){ state.apps.push(a); save(); renderDock(); } closeSheet(); }",
      "  function proxyUrl(u){ return PROXY+'?url='+encodeURIComponent(u); }",
      "  function openApp(a){ var p=el('panel'), fr=el('panelFrame'), msg=el('panelMsg'), title=el('panelTitle'); p.classList.add('open'); title.textContent=a.name; msg.style.display='none'; fr.style.display='block'; var target=state.proxy?proxyUrl(a.url):a.url; if(a.allow){ fr.src=target; } else { fr.style.display='none'; msg.style.display='flex'; msg.textContent='Сервис запрещает встраивание. Используй кнопки ниже.'; } el('openExternal').onclick=function(){ window.open(proxyUrl(a.url),'_blank'); }; var dl=a.deeplink||''; el('openDeeplink').style.display=dl?'inline-flex':'none'; el('openDeeplink').onclick=function(){ if(dl) location.href=dl; }; }",
      "  function closePanel(){ el('panel').classList.remove('open'); el('panelFrame').src='about:blank'; }",
      "  function renderDock(){ var d=el('dock'); d.innerHTML=''; state.apps.forEach(function(a){ var wrap=document.createElement('div'); wrap.className='app'; var ic=document.createElement('div'); ic.className='icon '+(a.icon==='insta'?'icon-insta':'icon-tg'); wrap.appendChild(ic); wrap.onclick=function(){ openApp(a); }; d.appendChild(wrap); }); }",
      "  function openSheet(){ el('sheet').classList.add('open'); }",
      "  function closeSheet(){ el('sheet').classList.remove('open'); }",
      "  function bindSheet(){ el('closeSheet').onclick=closeSheet; Array.prototype.forEach.call(document.querySelectorAll('.opt'),function(n){ n.querySelector('.btn').onclick=function(){ addApp(n.getAttribute('data-id')); }; }); el('sheet').addEventListener('click',function(e){ if(e.target.id==='sheet') closeSheet(); }); }",
      "  // Большая сфера — инерционное перетаскивание",
      "  function physics(){ var f=el('field'), s=el('big'); var vx=0,vy=0,drag=false,px=0,py=0; function bounds(){ var r=s.offsetWidth/2, w=f.clientWidth, h=f.clientHeight; var x=s.offsetLeft+r, y=s.offsetTop+r; if(x<r){ s.style.left=(0)+'px'; vx*=-.6;} if(x>w-r){ s.style.left=(w-2*r)+'px'; vx*=-.6;} if(y<r){ s.style.top=(0)+'px'; vy*=-.6;} if(y>h-r){ s.style.top=(h-2*r)+'px'; vy*=-.6;} } function step(){ if(!drag){ var x=s.offsetLeft, y=s.offsetTop; x+=vx; y+=vy; vx*=.98; vy*=.98; s.style.left=x+'px'; s.style.top=y+'px'; bounds(); } requestAnimationFrame(step);} step(); function onDown(e){ drag=true; px=e.touches?e.touches[0].clientX:e.clientX; py=e.touches?e.touches[0].clientY:e.clientY; } function onMove(e){ if(!drag) return; var x=e.touches?e.touches[0].clientX:e.clientX, y=e.touches?e.touches[0].clientY:e.clientY; vx=x-px; vy=y-py; s.style.left=(s.offsetLeft+vx)+'px'; s.style.top=(s.offsetTop+vy)+'px'; px=x; py=y; } function onUp(){ drag=false; } s.addEventListener('mousedown',onDown); s.addEventListener('touchstart',onDown); window.addEventListener('mousemove',onMove,{passive:false}); window.addEventListener('touchmove',onMove,{passive:false}); window.addEventListener('mouseup',onUp); window.addEventListener('touchend',onUp); s.onclick=function(){ if(!drag) openSheet(); }; }",
      "  function boot(){ setProxy(true); el('proxyToggle').onclick=function(){ setProxy(!state.proxy); }; bindSheet(); renderDock(); physics(); el('closePanel').onclick=closePanel; }",
      "  window.openApp=openApp;",
      "  boot();",
      "})();"
    ].join("\n");
    res.writeHead(200,{"Content-Type":"text/javascript; charset=utf-8"}); return res.end(js);
  }

  // ---------- iOS profile (ярлык) ----------
  if(req.url==="/Sphere.mobileconfig"){
    const targetUrl="https://"+req.headers.host+"/app";
    const xml = [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
      "<plist version=\"1.0\"><dict><key>PayloadContent</key><array><dict>",
      "<key>IsRemovable</key><true/><key>Label</key><string>Sphere</string>",
      "<key>PayloadIdentifier</key><string>com.sphere.webclip</string>",
      "<key>PayloadType</key><string>com.apple.webClip</string>",
      "<key>PayloadUUID</key><string>9F3C6AE8-9D8E-4E1B-9F11-1234567890AB</string>",
      "<key>PayloadVersion</key><integer>1</integer><key>Precomposed</key><true/>",
      "<key>URL</key><string>"+targetUrl+"</string><key>FullScreen</key><true/>",
      "</dict></array><key>PayloadDisplayName</key><string>Sphere Profile</string>",
      "<key>PayloadIdentifier</key><string>com.sphere.profile</string>",
      "<key>PayloadRemovalDisallowed</key><false/>",
      "<key>PayloadType</key><string>Configuration</string>",
      "<key>PayloadUUID</key><string>6B7E9E1C-3C1A-4A4B-B0D2-ABCDEF012345</string>",
      "<key>PayloadVersion</key><integer>1</integer></dict></plist>"
    ].join("\n");
    res.writeHead(200,{"Content-Type":"application/x-apple-aspen-config","Content-Disposition":"attachment; filename=\"Sphere.mobileconfig\""}); 
    return res.end(xml);
  }

  // ---------- API (минимум, без БД) ----------
  if(req.url.startsWith("/api/me")){
    const me=verifySession(getCookies(req).sid)||{};
    res.writeHead(200,{"Content-Type":"application/json"}); return res.end(JSON.stringify(me));
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
      const up=mod.request({
        hostname:t.hostname, port:t.port||(t.protocol==="https:"?443:80),
        path:t.pathname+(t.search||""), method:"GET",
        headers:{ "Host": t.host, "User-Agent":"Mozilla/5.0 (Sphere)","Accept":"*/*","Accept-Encoding":"identity","Connection":"close" },
        timeout:20000
      },u=>{
        const h=Object.assign({},u.headers,{"access-control-allow-origin":"*"});
        delete h["x-frame-options"]; delete h["content-security-policy"]; delete h["content-security-policy-report-only"];
        res.writeHead(u.statusCode||200,h); u.pipe(res);
      });
      up.on("error",e=>{ res.writeHead(502); res.end("Fetch error: "+e.message); }); up.end();
    }catch(e){ res.writeHead(400); res.end("Bad url: "+e.message); }
    return;
  }

  // ---------- forward proxy (на всякий случай) ----------
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
