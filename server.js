const http = require("http");
const https = require("https");
const net = require("net");
const crypto = require("crypto");
const httpProxy = require("http-proxy");
const { URL } = require("url");
const { parse } = require("node-html-parser");
const { HttpProxyAgent } = require("http-proxy-agent");
const { HttpsProxyAgent } = require("https-proxy-agent");

// ==== ВСЕГДА ВКЛЮЧЕННЫЙ ПРОКСИ (твои данные) ====
const DEFAULT_UPSTREAM = "http://mhR8veLB:cDCGv5YT@154.81.197.179:64902";

// ==== ENV ====
const PORT = process.env.PORT || 8080;
// =============

// helpers
function setCORS(res){ res.setHeader("Access-Control-Allow-Origin","*"); res.setHeader("Access-Control-Allow-Methods","GET, POST, OPTIONS"); res.setHeader("Access-Control-Allow-Headers","authorization, content-type"); }
function getCookies(req){ const o={}; (req.headers.cookie||"").split(";").forEach(s=>{const i=s.indexOf("="); if(i>0)o[s.slice(0,i).trim()]=decodeURIComponent(s.slice(i+1));}); return o; }
function setCookie(res,name,val,days=365){ const exp=new Date(Date.now()+days*864e5).toUTCString(); res.setHeader("Set-Cookie",`${name}=${encodeURIComponent(val)}; Path=/; Expires=${exp}; HttpOnly; SameSite=Lax; Secure`); }
function newSid(){ return crypto.randomBytes(16).toString("hex"); }
function readBody(req){ return new Promise(r=>{ const c=[]; req.on("data",d=>c.push(d)); req.on("end",()=>r(Buffer.concat(c).toString("utf8"))); }); }

// sessions + profiles (в RAM)
const SESS = new Map(); // sid -> { profiles: { pid: {name,url,ua,upstream,jar:{host->cookie}} } }
function ensureSess(sid){ if(!SESS.has(sid)) SESS.set(sid,{profiles:{}}); return SESS.get(sid); }
function makePid(){ return crypto.randomBytes(6).toString("hex"); }
function getOrCreateSid(req,res){ let sid=(getCookies(req).sid)||""; if(!sid){ sid=newSid(); setCookie(res,"sid",sid); } return sid; }

// cookie-jar
function jarGet(sid,pid,host){ const pr=(ensureSess(sid).profiles[pid]||{}); return pr.jar && pr.jar[host] || ""; }
function jarSet(sid,pid,host,sets){
  if(!sets) return;
  const pr=ensureSess(sid).profiles[pid]; if(!pr) return;
  const map={}; (pr.jar[host]||"").split(/; */).forEach(p=>{ const i=p.indexOf("="); if(i>0) map[p.slice(0,i)]=p.slice(i+1); });
  (Array.isArray(sets)?sets:[sets]).forEach(c=>{
    const pair=(c||"").split(";")[0]; const i=pair.indexOf("="); if(i>0) map[pair.slice(0,i).trim()]=pair.slice(i+1).trim();
  });
  pr.jar[host]=Object.entries(map).map(([k,v])=>k+"="+v).join("; ");
}

// HTML переписывание (ссылки->/m, ресурсы->/p)
function rewriteHtml(html, baseHref, pid){
  let root; try{ root=parse(html); }catch{ return html; }
  root.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').forEach(n=>n.remove());
  [["img","src"],["script","src"],["iframe","src"],["source","src"],["link","href"]]
    .forEach(([tag,attr])=>{
      root.querySelectorAll(tag+"["+attr+"]").forEach(n=>{
        const v=n.getAttribute(attr); if(!v) return;
        try{ const abs=new URL(v,baseHref).href; n.setAttribute(attr,"/p?pid="+encodeURIComponent(pid)+"&url="+encodeURIComponent(abs)); }catch{}
      });
    });
  root.querySelectorAll("a[href]").forEach(n=>{
    const v=n.getAttribute("href"); if(!v) return;
    try{ const abs=new URL(v,baseHref).href; n.setAttribute("href","/m?pid="+encodeURIComponent(pid)+"&url="+encodeURIComponent(abs)); n.setAttribute("target","_self"); }catch{}
  });
  const helper=[
    "(function(){",
    "document.addEventListener('click',function(e){",
    " var a=e.target.closest && e.target.closest('a[href]'); if(!a) return;",
    " var h=a.getAttribute('href'); if(h && h.indexOf('/m?pid=')===0){ e.preventDefault(); location.href=h; }",
    "},true);",
    "})();"
  ].join("\n");
  const head=root.querySelector("head")||root;
  head.insertAdjacentHTML("beforeend","<script>"+helper.replace(/<\/script>/gi,"")+"</script>");
  return root.toString();
}

// апстрим через ЛЮБОЙ прокси (у нас всегда DEFAULT_UPSTREAM)
function upstream(t, opts, pr, cb){
  const isHttps = t.protocol==="https:";
  const mod = isHttps ? https : http;
  const agent = pr.upstream || DEFAULT_UPSTREAM
    ? (isHttps ? new HttpsProxyAgent(pr.upstream || DEFAULT_UPSTREAM)
               : new HttpProxyAgent(pr.upstream || DEFAULT_UPSTREAM))
    : undefined;
  const base={
    hostname: t.hostname,
    port: t.port || (isHttps?443:80),
    path: t.pathname+(t.search||""),
    method: opts.method || "GET",
    headers: Object.assign({
      "Host": t.host,
      "User-Agent": pr.ua || "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Accept": "*/*",
      "Accept-Encoding": "identity",
      "Connection": "close",
      "Cookie": opts.cookie || ""
    }, opts.headers||{}),
    timeout: 25000,
    agent
  };
  return mod.request(base, cb);
}

const proxy = httpProxy.createProxyServer({});
const server = http.createServer(async (req,res)=>{
  if(req.url==="/healthz"){ res.writeHead(200,{"Content-Type":"text/plain"}); return res.end("ok"); }

  const sid = getOrCreateSid(req,res);

  // ---------- UI ----------
  if(req.url==="/app"){
    const html = [
      "<!doctype html>","<html lang=\"ru\">","<head>",
      "<meta charset=\"utf-8\"/>",
      "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">",
      "<meta name=\"apple-mobile-web-app-capable\" content=\"yes\">",
      "<meta name=\"apple-mobile-web-app-status-bar-style\" content=\"black-translucent\">",
      "<title>Sphere</title>",
      "<style>",
      " :root{--bg:#0a0c10;--panel:#111319;--line:#1f2329;--text:#e8ecf1;--muted:#9aa6b2}",
      " html,body{height:100%;margin:0;background:#0a0c10;color:var(--text);font:15px/1.4 -apple-system,system-ui,Segoe UI,Roboto}",
      " body{padding-top:env(safe-area-inset-top)}",
      " .top{position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top)+10px);height:56px;display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid var(--line);border-radius:16px;background:rgba(12,13,16,.85);backdrop-filter:blur(10px);z-index:10}",
      " .brand{font-weight:800;letter-spacing:.6px}",
      " .wrap{position:absolute;left:0;right:0;top:calc(env(safe-area-inset-top)+80px);bottom:0;display:flex;align-items:center;justify-content:center}",
      " .field{position:relative;width:100%;max-width:460px;height:60vh;min-height:360px}",
      " .sphere{position:absolute;left:50%;top:35%;transform:translate(-50%,-50%);width:120px;height:120px;border-radius:50%;background:radial-gradient(70% 60% at 35% 30%,rgba(230,240,255,.35),rgba(200,210,230,.09) 60%,rgba(180,190,205,.06) 70%,rgba(80,90,110,.05) 80%,rgba(0,0,0,.02) 100%),linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.02));box-shadow:inset 0 1px 0 rgba(255,255,255,.12), inset 0 -12px 30px rgba(0,0,0,.28), 0 18px 50px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.10);backdrop-filter:blur(18px) saturate(140%);display:flex;align-items:center;justify-content:center;cursor:grab;user-select:none}",
      " .plus{width:48px;height:48px;border-radius:50%;background:radial-gradient(60% 60% at 40% 35%,rgba(255,255,255,.35),rgba(255,255,255,.12) 60%,rgba(255,255,255,.06) 61%),linear-gradient(180deg,rgba(255,255,255,.25),rgba(255,255,255,.05));display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 0 1px rgba(255,255,255,.25)}",
      " .plus span{font-size:26px;font-weight:900;color:#ecf2ff;text-shadow:0 1px 0 rgba(0,0,0,.25)}",
      " .dock{position:absolute;left:0;right:0;bottom:8px;display:flex;justify-content:center;gap:14px;flex-wrap:wrap}",
      " .app{width:84px;height:84px;border-radius:50%;position:relative;display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);backdrop-filter:blur(14px) saturate(140%)}",
      " .app .lbl{position:absolute;bottom:-18px;font-size:12px;color:var(--muted)}",
      " .icon{width:60px;height:60px;border-radius:22%/22%;background-size:cover}",
      " .icon-insta{background-image:url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 48 48\"><defs><linearGradient id=\"g\" x1=\"0\" y1=\"1\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"%23f58529\"/><stop offset=\"0.5\" stop-color=\"%23dd2a7b\"/><stop offset=\"1\" stop-color=\"%235159f6\"/></linearGradient></defs><rect width=\"48\" height=\"48\" rx=\"11\" fill=\"url(%23g)\"/><circle cx=\"24\" cy=\"24\" r=\"9\" fill=\"white\"/><circle cx=\"24\" cy=\"24\" r=\"6\" fill=\"%23f58529\"/><circle cx=\"34\" cy=\"14\" r=\"3\" fill=\"white\"/></svg>')}",
      " .icon-tg{background-image:url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 48 48\"><rect width=\"48\" height=\"48\" rx=\"11\" fill=\"%2329a9eb\"/><path fill=\"white\" d=\"M38 12 9 23l9 3 2 8 5-6 8 6 5-22z\"/></svg>')}",
      " .sheet{position:fixed;left:0;right:0;bottom:0;top:0;background:rgba(0,0,0,.45);display:none;align-items:flex-end;z-index:30}",
      " .sheet.open{display:flex}",
      " .box{width:100%;background:var(--panel);border-top-left-radius:18px;border-top-right-radius:18px;border-top:1px solid var(--line);padding:14px}",
      " .row{display:flex;gap:8px}",
      " .fieldset{display:flex;flex-direction:column;gap:6px;flex:1}",
      " .in{padding:10px;border:1px solid var(--line);background:#0e1116;color:var(--text);border-radius:10px}",
      " .btn{padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--text)}",
      " .panel{position:fixed;left:0;right:0;bottom:0;top:calc(env(safe-area-inset-top) + 80px);background:#0b0d10;border-top:1px solid var(--line);z-index:25;display:none;flex-direction:column}",
      " .panel.open{display:flex}",
      " .panel-bar{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--line)}",
      " .panel-title{font-weight:700}",
      " .panel-actions{display:flex;gap:8px}",
      " .panel-frame{flex:1;border:0;background:#000}",
      " .panel-msg{flex:1;display:flex;align-items:center;justify-content:center;color:var(--muted);padding:22px;text-align:center}",
      "</style>","</head>","<body>",
      " <div class=\"top\"><div class=\"brand\">SPHERE</div></div>",
      " <div class=\"wrap\"><div class=\"field\" id=\"field\">",
      "   <div class=\"sphere\" id=\"big\"><div class=\"plus\"><span>+</span></div></div>",
      "   <div class=\"dock\" id=\"dock\"></div>",
      " </div></div>",
      " <div class=\"sheet\" id=\"sheet\"><div class=\"box\">",
      "   <div style=\"font-weight:700;margin-bottom:8px\">Добавить приложение</div>",
      "   <div class=\"row\"><div class=\"fieldset\"><label>Название</label><input class=\"in\" id=\"appName\" placeholder=\"Instagram\"/></div></div>",
      "   <div class=\"row\" style=\"margin-top:8px\"><div class=\"fieldset\"><label>URL (главная)</label><input class=\"in\" id=\"appUrl\" placeholder=\"https://www.instagram.com/\"/></div></div>",
      "   <div class=\"row\" style=\"margin-top:8px\"><div class=\"fieldset\"><label>User-Agent (опц.)</label><input class=\"in\" id=\"appUA\" placeholder=\"iPhone Safari UA\"/></div></div>",
      "   <div class=\"row\" style=\"margin-top:10px\"><button class=\"btn\" id=\"addApp\">Добавить</button><button class=\"btn\" id=\"closeSheet\" style=\"flex:1\">Отмена</button></div>",
      " </div></div>",
      " <div class=\"panel\" id=\"panel\">",
      "   <div class=\"panel-bar\"><div class=\"panel-title\" id=\"panelTitle\"></div><div class=\"panel-actions\"><button class=\"btn\" id=\"btnIP\">IP профиля</button><button class=\"btn\" id=\"btnReset\">Сбросить сессию</button><button class=\"btn\" id=\"closePanel\">Закрыть</button></div></div>",
      "   <iframe id=\"panelFrame\" class=\"panel-frame\"></iframe>",
      "   <div id=\"panelMsg\" class=\"panel-msg\" style=\"display:none\"></div>",
      " </div>",
      " <script src=\"/app.js\"></script>",
      "</body></html>"
    ].join("\n");
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"}); return res.end(html);
  }

  // ---------- клиентский JS ----------
  if(req.url==="/app.js"){
    const js = [
      "(function(){",
      "  var state={profiles: JSON.parse(localStorage.getItem('sphere_profiles')||'[]')};",
      "  function save(){ localStorage.setItem('sphere_profiles',JSON.stringify(state.profiles)); }",
      "  function el(id){return document.getElementById(id)}",
      "  function renderDock(){ var d=el('dock'); d.innerHTML=''; state.profiles.forEach(function(p){ var w=document.createElement('div'); w.className='app'; var ic=document.createElement('div'); ic.className='icon '+(p.icon||'icon-insta'); w.appendChild(ic); var lbl=document.createElement('div'); lbl.className='lbl'; lbl.textContent=p.name; w.appendChild(lbl); w.onclick=function(){ openProfile(p); }; d.appendChild(w); }); }",
      "  function openSheet(){ el('sheet').classList.add('open'); }",
      "  function closeSheet(){ el('sheet').classList.remove('open'); }",
      "  function addApp(){ var name=el('appName').value||'Instagram'; var url=el('appUrl').value||'https://www.instagram.com/'; var ua=el('appUA').value||''; ",
      "    fetch('/api/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,url:url,ua:ua})})",
      "      .then(r=>r.json()).then(function(p){ state.profiles.push(p); save(); renderDock(); closeSheet(); }); }",
      "  function ensureProfile(p){ return fetch('/api/profile/ensure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)}).then(r=>r.json()); }",
      "  function openProfile(p){ ensureProfile(p).then(function(pr){ var pan=el('panel'), fr=el('panelFrame'), msg=el('panelMsg'); el('panelTitle').textContent=pr.name; pan.classList.add('open'); fr.style.display='block'; msg.style.display='none'; fr.src='/m?pid='+encodeURIComponent(pr.pid)+'&url='+encodeURIComponent(pr.url); el('btnIP').onclick=function(){ fetch('/api/ip?pid='+encodeURIComponent(pr.pid)).then(r=>r.text()).then(t=>alert('IP профиля: '+t)); }; el('btnReset').onclick=function(){ fetch('/api/reset?pid='+encodeURIComponent(pr.pid),{method:'POST'}).then(()=>alert('Сессия очищена')); }; }); }",
      "  function closePanel(){ el('panel').classList.remove('open'); el('panelFrame').src='about:blank'; }",
      "  (function(){ var f=el('field'), s=el('big'); var vx=0,vy=0,drag=false,px=0,py=0; function bounds(){ var r=s.offsetWidth/2,w=f.clientWidth,h=f.clientHeight; var x=s.offsetLeft+r,y=s.offsetTop+r; if(x<r){s.style.left='0px';vx*=-.6;} if(x>w-r){s.style.left=(w-2*r)+'px';vx*=-.6;} if(y<r){s.style.top='0px';vy*=-.6;} if(y>h-r){s.style.top=(h-2*r)+'px';vy*=-.6;} } function step(){ if(!drag){ var x=s.offsetLeft,y=s.offsetTop; x+=vx;y+=vy;vx*=.98;vy*=.98;s.style.left=x+'px';s.style.top=y+'px';bounds(); } requestAnimationFrame(step);} step(); function down(e){drag=true;px=e.touches?e.touches[0].clientX:e.clientX;py=e.touches?e.touches[0].clientY:e.clientY;} function move(e){ if(!drag)return; var x=e.touches?e.touches[0].clientX:e.clientX,y=e.touches?e.touches[0].clientY:e.clientY; vx=x-px;vy=y-py;s.style.left=(s.offsetLeft+vx)+'px';s.style.top=(s.offsetTop+vy)+'px';px=x;py=y;} function up(){drag=false;} s.addEventListener('mousedown',down); s.addEventListener('touchstart',down); window.addEventListener('mousemove',move,{passive:false}); window.addEventListener('touchmove',move,{passive:false}); window.addEventListener('mouseup',up); window.addEventListener('touchend',up); s.addEventListener('click',function(){ if(!drag) openSheet(); }); })();",
      "  el('addApp').onclick=addApp; el('closeSheet').onclick=closeSheet; el('closePanel').onclick=closePanel; renderDock();",
      "})();"
    ].join("\n");
    res.writeHead(200,{"Content-Type":"text/javascript; charset=utf-8"}); return res.end(js);
  }

  // ---------- API: создать профиль ----------
  if(req.url.startsWith("/api/profile") && req.method==="POST"){
    const b=JSON.parse(await readBody(req)||"{}");
    const pid=makePid();
    const pr={ pid, name:String(b.name||"App"), url:String(b.url||"https://example.com/"),
               ua:String(b.ua||""), upstream: DEFAULT_UPSTREAM, jar:{} };
    ensureSess(sid).profiles[pid]=pr;
    res.writeHead(200,{"Content-Type":"application/json"}); return res.end(JSON.stringify(pr));
  }

  // ---------- API: ensure (восстановить если пропал после рестарта) ----------
  if(req.url.startsWith("/api/profile/ensure") && req.method==="POST"){
    const b=JSON.parse(await readBody(req)||"{}");
    let pr = (ensureSess(sid).profiles[b.pid||""]);
    if(!pr){
      const pid = b.pid || makePid();
      pr = { pid, name:String(b.name||"App"), url:String(b.url||"https://example.com/"),
             ua:String(b.ua||""), upstream: DEFAULT_UPSTREAM, jar:{} };
      ensureSess(sid).profiles[pid]=pr;
    }
    res.writeHead(200,{"Content-Type":"application/json"}); return res.end(JSON.stringify(pr));
  }

  // ---------- IP профиля ----------
  if(req.url.startsWith("/api/ip")){
    const u=new URL(req.url,"http://local"); const pid=u.searchParams.get("pid");
    const pr=(ensureSess(sid).profiles[pid]); if(!pr){ res.writeHead(404); return res.end("no profile"); }
    const t=new URL("https://api.ipify.org");
    const r=upstream(t,{headers:{}},pr,u2=>{ const ch=[]; u2.on("data",d=>ch.push(d)); u2.on("end",()=>{ res.writeHead(200,{"Content-Type":"text/plain"}); res.end(Buffer.concat(ch).toString("utf8")); });});
    r.on("error",e=>{ res.writeHead(502); res.end("err: "+e.message); }); r.end(); return;
  }

  // ---------- reset cookies ----------
  if(req.url.startsWith("/api/reset") && req.method==="POST"){
    const u=new URL(req.url,"http://local"); const pid=u.searchParams.get("pid");
    const pr=(ensureSess(sid).profiles[pid]); if(!pr){ res.writeHead(404); return res.end("no profile"); }
    pr.jar={}; res.writeHead(204); return res.end();
  }

  // ---------- HTML режим (переписывание) ----------
  if(req.url.startsWith("/m?")){
    const u=new URL(req.url,"http://local"); const pid=u.searchParams.get("pid"); const target=u.searchParams.get("url");
    const pr=(ensureSess(sid).profiles[pid]); if(!pr){ res.writeHead(404); return res.end("no profile"); }
    let t; try{ t=new URL(target); }catch{ res.writeHead(400); return res.end("bad url"); }
    const up=upstream(t,{cookie:jarGet(sid,pid,t.host)},pr,u2=>{
      const ct=u2.headers["content-type"]||""; const chunks=[];
      u2.on("data",d=>chunks.push(d)); u2.on("end",()=>{
        jarSet(sid,pid,t.host,u2.headers["set-cookie"]);
        if(ct.includes("text/html")){
          let text=Buffer.concat(chunks).toString("utf8"); try{ text=rewriteHtml(text,t.href,pid); }catch{}
          res.writeHead(u2.statusCode||200,{"content-type":"text/html; charset=utf-8","access-control-allow-origin":"*"}); return res.end(text);
        } else {
          res.writeHead(u2.statusCode||200,Object.assign({},u2.headers,{"access-control-allow-origin":"*"})); return res.end(Buffer.concat(chunks));
        }
      });
    });
    up.on("error",e=>{ res.writeHead(502); res.end("Upstream error: "+e.message); }); up.end(); return;
  }

  // ---------- ресурсы/XHR ----------
  if(req.url.startsWith("/p?")){
    if(req.method==="OPTIONS"){ setCORS(res); res.writeHead(204); return res.end(); }
    setCORS(res);
    const u=new URL(req.url,"http://local"); const pid=u.searchParams.get("pid"); const target=u.searchParams.get("url");
    const pr=(ensureSess(sid).profiles[pid]); if(!pr){ res.writeHead(404); return res.end("no profile"); }
    let t; try{ t=new URL(target); }catch{ res.writeHead(400); return res.end("bad url"); }
    const up=upstream(t,{method:req.method,cookie:jarGet(sid,pid,t.host)},pr,u2=>{
      jarSet(sid,pid,t.host,u2.headers["set-cookie"]);
      const h=Object.assign({},u2.headers,{"access-control-allow-origin":"*"});
      delete h["x-frame-options"]; delete h["content-security-policy"]; delete h["content-security-policy-report-only"]; delete h["set-cookie"];
      res.writeHead(u2.statusCode||200,h); u2.pipe(res);
    });
    up.on("error",e=>{ res.writeHead(502); res.end("Fetch error: "+e.message); });
    if(req.method!=="GET"&&req.method!=="HEAD"){ req.pipe(up); } else up.end();
    return;
  }

  // fallback: ничего лишнего
  res.writeHead(404,{"Content-Type":"text/plain"}); res.end("not found");
});

server.listen(PORT,()=>console.log("Sphere running on "+PORT));
