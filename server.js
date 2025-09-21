const http = require("http");
const https = require("https");
const net = require("net");
const crypto = require("crypto");
const httpProxy = require("http-proxy");
const { URL } = require("url");
const { parse } = require("node-html-parser");

// ===== ENV =====
const USER = process.env.PROXY_USER || "student";
const PASS = process.env.PROXY_PASS || "mypassword";
const SESSION_SECRET = process.env.SESSION_SECRET || "change_me_secret";
const PORT = process.env.PORT || 8080;
// ===============

// ---- utils
function setCORS(res){ res.setHeader("Access-Control-Allow-Origin","*"); res.setHeader("Access-Control-Allow-Methods","GET, POST, OPTIONS"); res.setHeader("Access-Control-Allow-Headers","authorization, content-type"); }
function authOk(req){ const h=req.headers["proxy-authorization"]||req.headers["authorization"]; if(!h) return false; const p=h.split(" "); if(p.length!==2) return false; return Buffer.from(p[1],"base64").toString()===USER+":"+PASS; }
function getCookies(req){ const out={}; (req.headers.cookie||"").split(";").forEach(s=>{const i=s.indexOf("="); if(i>0) out[s.slice(0,i).trim()]=decodeURIComponent(s.slice(i+1));}); return out; }
function setCookie(res,name,val,days=30){ const exp=new Date(Date.now()+days*864e5).toUTCString(); res.setHeader("Set-Cookie",`${name}=${encodeURIComponent(val)}; Path=/; Expires=${exp}; HttpOnly; SameSite=Lax; Secure`); }

// простенькая «соль» на сессию
function newSid(){ return crypto.randomBytes(16).toString("hex"); }

// ---- cookie-jar в памяти: sid -> host -> cookieString
const JAR = new Map();
function jarGet(sid, host){ const j=JAR.get(sid)||{}; return j[host]||""; }
function jarSet(sid, host, setCookieHeaders){
  if(!setCookieHeaders) return;
  const j = JAR.get(sid) || {};
  const prev = j[host] || "";
  const map = {}; // name -> val (без Domain/Path/…)
  prev.split(/; */).forEach(p=>{ const eq=p.indexOf("="); if(eq>0){ map[p.slice(0,eq)] = p.slice(eq+1); } });
  (Array.isArray(setCookieHeaders)?setCookieHeaders:[setCookieHeaders]).forEach(c=>{
    const pair = c.split(";")[0]; const eq = pair.indexOf("=");
    if(eq>0){ const name = pair.slice(0,eq).trim(); const val = pair.slice(eq+1).trim(); map[name]=val; }
  });
  j[host] = Object.entries(map).map(([k,v])=>k+"="+v).join("; ");
  JAR.set(sid, j);
}

// ---- HTML rewriter
function rewriteHtml(html, baseUrl){
  let root;
  try { root = parse(html); } catch { return html; }

  // убираем встроенный CSP, который ломает встраивание
  root.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').forEach(m=>m.remove());

  // тэги-ресурсы → /p
  const resAttrs = [["img","src"],["script","src"],["iframe","src"],["source","src"],["link","href"]];
  resAttrs.forEach(([tag,attr])=>{
    root.querySelectorAll(tag+"["+attr+"]").forEach(n=>{
      const v=n.getAttribute(attr); if(!v) return;
      try{
        const abs = new URL(v, baseUrl).href;
        n.setAttribute(attr, "/p?url="+encodeURIComponent(abs));
      }catch{}
    });
  });

  // ссылки → /m
  root.querySelectorAll("a[href]").forEach(n=>{
    const v=n.getAttribute("href"); if(!v) return;
    try{
      const abs = new URL(v, baseUrl).href;
      n.setAttribute("href", "/m?url="+encodeURIComponent(abs));
      n.setAttribute("target", "_self");
    }catch{}
  });

  // формы — отправляем через /p (без JS это не всегда идеал, но для демо ок)
  root.querySelectorAll("form[action]").forEach(n=>{
    const v=n.getAttribute("action"); if(!v) return;
    try{
      const abs = new URL(v, baseUrl).href;
      n.setAttribute("action", "/p?url="+encodeURIComponent(abs));
    }catch{}
  });

  // лёгкий скрипт: перехватываем pushState/клики на всякий
  const helper = [
    "(function(){",
    "document.addEventListener('click',function(e){",
    "  var a=e.target.closest && e.target.closest('a[href]');",
    "  if(!a) return;",
    "  var href=a.getAttribute('href');",
    "  if(href && href.indexOf('/m?url=')===0){ e.preventDefault(); location.href=href; }",
    "},true);",
    "})();"
  ].join("\n");
  const head = root.querySelector("head") || root;
  head.insertAdjacentHTML("beforeend", "<script>"+helper.replace(/<\/script>/gi,"")+"</script>");

  return root.toString();
}

// ---- upstream request helper
function upstreamRequest(t, opts, cb){
  const mod = t.protocol==="https:" ? https : http;
  const req = mod.request(Object.assign({
    hostname: t.hostname,
    port: t.port || (t.protocol==="https:"?443:80),
    path: t.pathname + (t.search||""),
    method: "GET",
    headers: {
      "Host": t.host,
      "User-Agent": "Mozilla/5.0 (Sphere)",
      "Accept": "*/*",
      "Accept-Encoding": "identity",
      "Connection": "close"
    },
    timeout: 20000
  }, opts), cb);
  return req;
}

const proxy = httpProxy.createProxyServer({});
const server = http.createServer(async (req,res)=>{
  // health
  if(req.url==="/healthz"){ res.writeHead(200,{"Content-Type":"text/plain"}); return res.end("ok"); }

  // выдаём UI
  if(req.url==="/app"){
    // гарантируем sid
    const cookies = getCookies(req);
    if(!cookies.sid){ setCookie(res,"sid",newSid()); }

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
      "  .top{position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top) + 10px);height:56px;display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid var(--line);border-radius:16px;background:rgba(12,13,16,.85);backdrop-filter:blur(10px);z-index:10}",
      "  .brand{font-weight:800;letter-spacing:.6px}",
      "  .chip{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid var(--line);border-radius:999px;background:var(--panel)}",
      "  .toggle{width:40px;height:24px;border-radius:999px;border:1px solid var(--line);background:#222;position:relative}",
      "  .dot{position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#6b7280;transition:.22s}",
      "  .on .dot{left:18px;background:#1ee2a1}",
      "  .wrap{position:absolute;left:0;right:0;top:calc(env(safe-area-inset-top) + 56px + 24px);bottom:0;display:flex;align-items:center;justify-content:center}",
      "  .field{position:relative;width:100%;max-width:460px;height:58vh;min-height:360px}",
      "  .sphere{position:absolute;left:50%;top:35%;transform:translate(-50%,-50%);width:120px;height:120px;border-radius:50%;",
      "          background:radial-gradient(70% 60% at 35% 30%,rgba(230,240,255,.35),rgba(200,210,230,.09) 60%,rgba(180,190,205,.06) 70%,rgba(80,90,110,.05) 80%,rgba(0,0,0,.02) 100%),",
      "                     linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.02));",
      "          box-shadow:inset 0 1px 0 rgba(255,255,255,.12), inset 0 -12px 30px rgba(0,0,0,.28), 0 18px 50px rgba(0,0,0,.45);",
      "          border:1px solid rgba(255,255,255,.10); backdrop-filter:blur(18px) saturate(140%); display:flex;align-items:center;justify-content:center;cursor:grab;user-select:none;}",
      "  .plus{width:48px;height:48px;border-radius:50%;background:radial-gradient(60% 60% at 40% 35%, rgba(255,255,255,.35), rgba(255,255,255,.12) 60%, rgba(255,255,255,.06) 61%), linear-gradient(180deg,rgba(255,255,255,.25),rgba(255,255,255,.05)); display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 0 1px rgba(255,255,255,.25)}",
      "  .plus span{font-size:26px;font-weight:900;color:#ecf2ff;text-shadow:0 1px 0 rgba(0,0,0,.25)}",
      "  .dock{position:absolute;left:0;right:0;bottom:8px;display:flex;justify-content:center;gap:14px}",
      "  .app{width:84px;height:84px;border-radius:50%;position:relative;display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);backdrop-filter:blur(14px) saturate(140%)}",
      "  .icon{width:60px;height:60px;border-radius:22%/22%;background-size:cover}",
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
      "  <div class=\"top\"><div class=\"brand\">SPHERE</div><div class=\"chip\"><span>Proxy:</span><div class=\"toggle on\" id=\"proxyToggle\"><div class=\"dot\"></div></div></div></div>",
      "  <div class=\"wrap\"><div class=\"field\" id=\"field\">",
      "    <div class=\"sphere\" id=\"big\"><div class=\"plus\"><span>+</span></div></div>",
      "    <div class=\"dock\" id=\"dock\"></div>",
      "  </div></div>",
      "  <div class=\"sheet\" id=\"sheet\"><div class=\"box\">",
      "    <h3>Добавить приложение</h3>",
      "    <div class=\"opt\" data-id=\"instagram\"><div class=\"icon icon-insta\"></div><div style=\"flex:1\">Instagram</div><button class=\"btn\">Добавить</button></div>",
      "    <div class=\"opt\" data-id=\"telegram\"><div class=\"icon icon-tg\"></div><div style=\"flex:1\">Telegram Web</div><button class=\"btn\">Добавить</button></div>",
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

  // фронтенд-логика
  if(req.url==="/app.js"){
    const js = [
      "(function(){",
      "  var PROXY='/p?url='; var MHTML='/m?url=';",
      "  var state={apps: JSON.parse(localStorage.getItem('sphereApps')||'[]')};",
      "  var CATALOG={",
      "    instagram:{id:'instagram',name:'Instagram',url:'https://www.instagram.com/',allow:false,deeplink:'instagram://app',icon:'insta'},",
      "    telegram:{id:'telegram',name:'Telegram',url:'https://web.telegram.org/',allow:true,deeplink:'tg://',icon:'tg'}",
      "  };",
      "  function save(){ localStorage.setItem('sphereApps',JSON.stringify(state.apps)); }",
      "  function el(id){return document.getElementById(id)}",
      "  function openSheet(){ el('sheet').classList.add('open'); }",
      "  function closeSheet(){ el('sheet').classList.remove('open'); }",
      "  function addApp(id){ var a=CATALOG[id]; if(!a) return; if(!state.apps.find(x=>x.id===id)){ state.apps.push(a); save(); renderDock(); } closeSheet(); }",
      "  function proxyUrl(u){ return PROXY+encodeURIComponent(u); }",
      "  function mUrl(u){ return MHTML+encodeURIComponent(u); }",
      "  function openApp(a){ var p=el('panel'), fr=el('panelFrame'), msg=el('panelMsg'); el('panelTitle').textContent=a.name; p.classList.add('open'); msg.style.display='none'; fr.style.display='block'; if(a.allow){ fr.src=mUrl(a.url); } else { fr.style.display='none'; msg.style.display='flex'; msg.textContent='Сервис блокирует встраивание. Нажми «Открыть через прокси» (новая вкладка) или «Открыть в приложении».'; } el('openExternal').onclick=function(){ window.open(proxyUrl(a.url),'_blank'); }; el('openDeeplink').style.display=a.deeplink?'inline-flex':'none'; el('openDeeplink').onclick=function(){ if(a.deeplink) location.href=a.deeplink; }; }",
      "  function closePanel(){ el('panel').classList.remove('open'); el('panelFrame').src='about:blank'; }",
      "  function renderDock(){ var d=el('dock'); d.innerHTML=''; state.apps.forEach(function(a){ var wrap=document.createElement('div'); wrap.className='app'; var ic=document.createElement('div'); ic.className='icon '+(a.icon==='insta'?'icon-insta':'icon-tg'); wrap.appendChild(ic); wrap.onclick=function(){ openApp(a); }; d.appendChild(wrap); }); }",
      "  function bind(){ el('closeSheet').onclick=closeSheet; Array.prototype.forEach.call(document.querySelectorAll('.opt'),function(n){ n.querySelector('.btn').onclick=function(){ addApp(n.getAttribute('data-id')); }; }); el('sheet').addEventListener('click',function(e){ if(e.target.id==='sheet') closeSheet(); }); el('big').onclick=function(){ openSheet(); }; el('closePanel').onclick=closePanel; }",
      "  // простая инерция для шара",
      "  (function(){ var f=el('field'), s=el('big'); var vx=0,vy=0,drag=false,px=0,py=0; function bounds(){ var r=s.offsetWidth/2, w=f.clientWidth, h=f.clientHeight; var x=s.offsetLeft+r, y=s.offsetTop+r; if(x<r){ s.style.left=(0)+'px'; vx*=-.6;} if(x>w-r){ s.style.left=(w-2*r)+'px'; vx*=-.6;} if(y<r){ s.style.top=(0)+'px'; vy*=-.6;} if(y>h-r){ s.style.top=(h-2*r)+'px'; vy*=-.6;} } function step(){ if(!drag){ var x=s.offsetLeft, y=s.offsetTop; x+=vx; y+=vy; vx*=.98; vy*=.98; s.style.left=x+'px'; s.style.top=y+'px'; bounds(); } requestAnimationFrame(step);} step(); function onDown(e){ drag=true; px=e.touches?e.touches[0].clientX:e.clientX; py=e.touches?e.touches[0].clientY:e.clientY; } function onMove(e){ if(!drag) return; var x=e.touches?e.touches[0].clientX:e.clientX, y=e.touches?e.touches[0].clientY:e.clientY; vx=x-px; vy=y-py; s.style.left=(s.offsetLeft+vx)+'px'; s.style.top=(s.offsetTop+vy)+'px'; px=x; py=y; } function onUp(){ drag=false; } s.addEventListener('mousedown',onDown); s.addEventListener('touchstart',onDown); window.addEventListener('mousemove',onMove,{passive:false}); window.addEventListener('touchmove',onMove,{passive:false}); window.addEventListener('mouseup',onUp); window.addEventListener('touchend',onUp); })();",
      "  function boot(){ bind(); renderDock(); }",
      "  boot();",
      "})();"
    ].join("\n");
    res.writeHead(200,{"Content-Type":"text/javascript; charset=utf-8"}); return res.end(js);
  }

  // ---------- HTML-режим (переписывание) ----------
  if(req.url.startsWith("/m?")){
    const sid = getCookies(req).sid || "";
    const q = new URL(req.url, "http://local"); const target = q.searchParams.get("url");
    if(!target){ res.writeHead(400); return res.end("Missing url"); }
    let t; try{ t=new URL(target); }catch{ res.writeHead(400); return res.end("Bad url"); }

    const up = upstreamRequest(t, {
      headers: Object.assign({}, req.headers, {
        "Host": t.host,
        "Accept-Encoding": "identity",
        "Cookie": jarGet(sid, t.host)
      })
    }, u=>{
      const ct = u.headers["content-type"]||"";
      const chunks=[];
      u.on("data",d=>chunks.push(d));
      u.on("end",()=>{
        jarSet(sid, t.host, u.headers["set-cookie"]);
        let body = Buffer.concat(chunks);
        res.removeHeader("Content-Security-Policy");
        res.removeHeader("X-Frame-Options");
        if(ct.includes("text/html")){
          let txt = body.toString("utf8");
          try{ txt = rewriteHtml(txt, t.href); }catch{}
          res.writeHead(u.statusCode||200, {"content-type":"text/html; charset=utf-8","access-control-allow-origin":"*"});
          return res.end(txt);
        } else {
          res.writeHead(u.statusCode||200, Object.assign({},u.headers,{"access-control-allow-origin":"*"}));
          return res.end(body);
        }
      });
    });
    up.on("error",e=>{ res.writeHead(502); res.end("Upstream error: "+e.message); });
    up.end();
    return;
  }

  // ---------- универсальный прокси (ресурсы, XHR и т.д.) ----------
  if(req.url.startsWith("/p?")){
    if(req.method==="OPTIONS"){ setCORS(res); res.writeHead(204); return res.end(); }
    setCORS(res);
    const sid = getCookies(req).sid || "";
    const q = new URL(req.url, "http://local"); const target = q.searchParams.get("url");
    if(!target){ res.writeHead(400); return res.end("Missing url"); }
    let t; try{ t=new URL(target); }catch{ res.writeHead(400); return res.end("Bad url"); }

    const up = upstreamRequest(t, {
      method: req.method,
      headers: Object.assign({}, req.headers, {
        "Host": t.host,
        "Accept-Encoding": "identity",
        "Cookie": jarGet(sid, t.host)
      })
    }, u=>{
      jarSet(sid, t.host, u.headers["set-cookie"]);
      const h = Object.assign({},u.headers,{"access-control-allow-origin":"*"});
      delete h["content-security-policy"]; delete h["x-frame-options"]; delete h["content-security-policy-report-only"];
      delete h["set-cookie"]; // не отдаём браузеру куки чужого домена — держим в серверной jar
      res.writeHead(u.statusCode||200, h);
      u.pipe(res);
    });
    up.on("error",e=>{ res.writeHead(502); res.end("Fetch error: "+e.message); });

    // проброс тела POST/PUT
    if(req.method!=="GET"&&req.method!=="HEAD"){
      req.pipe(up);
    } else up.end();
    return;
  }

  // классический форвард-прокси (для совместимости; может блокироваться PaaS)
  if(!authOk(req)){ res.writeHead(407,{"Proxy-Authenticate":"Basic realm=\"Proxy\""}); return res.end("Proxy auth required"); }
  proxy.web(req,res,{target:req.url,changeOrigin:true},(err)=>{ res.writeHead(502); res.end("Bad gateway: "+err.message); });
});

// CONNECT для HTTPS
server.on("connect",(req,clientSocket,head)=>{
  if(!authOk(req)){ clientSocket.write("HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"Proxy\"\r\n\r\n"); return clientSocket.end(); }
  const hp=(req.url||"").split(":"); const serverSocket=net.connect(hp[1]||443,hp[0],()=>{ clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n"); if(head&&head.length) serverSocket.write(head); serverSocket.pipe(clientSocket); clientSocket.pipe(serverSocket); });
  serverSocket.on("error",()=>{ clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n"); clientSocket.end(); });
});

server.listen(PORT,()=>console.log("Sphere running on "+PORT));
