/* SPHERE front-end — ВХОД + Telegram → имя/@ник/аватар → сцена со сферами (без дублей) */

(() => {
  'use strict';

  // ==== CSS (сферная тема)
  const css = `
  :root{--bg:#07090b;--fg:#e9edf2;--muted:#9aa3ad;--line:#151a1f;--panel:#0e1116;--chip:#10141a;--chip-line:#212831;--danger:#ff5f57}
  *{box-sizing:border-box} html,body{height:100%;margin:0;background:var(--bg);color:var(--fg);font:400 16px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"SF Pro Text","Segoe UI",Roboto}
  .titlebar{position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top) + 10px);height:56px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;border:1px solid var(--line);border-radius:16px;background:rgba(10,12,14,.65);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);z-index:20}
  .brand{justify-self:center;letter-spacing:.18em;font-weight:800}
  .stage{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden}
  .grid-bg{position:absolute;inset:-20% -10% -10% -10%;background:radial-gradient(1200px 700px at 50% 0%, #0c0f13 0%, #07090b 60%);pointer-events:none}
  .grid-bg::after{content:"";position:absolute;inset:0;background:linear-gradient(to right, rgba(255,255,255,.04) 1px, transparent 1px) 0 0/60px 60px,linear-gradient(to bottom, rgba(255,255,255,.04) 1px, transparent 1px) 0 0/60px 60px;opacity:.22}
  .card{position:relative;width:min(560px,92vw);border:1px solid var(--line);border-radius:16px;background:rgba(12,14,16,.75);backdrop-filter:blur(12px);padding:18px}
  h1{margin:6px 0 10px;font-size:22px;letter-spacing:.16em}
  .btn{display:inline-block;padding:12px 14px;border-radius:12px;border:1px solid var(--chip-line);background:linear-gradient(180deg,#121923,#0e131a);color:var(--fg);cursor:pointer}
  .btn.primary{border-color:#233042;background:linear-gradient(180deg,#18212d,#131a22)}
  .field{display:flex;flex-direction:column;gap:10px;margin-top:12px}
  input[type="text"],input[type="file"]{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #262e38;background:#0f1318;color:var(--fg)}
  .hint{font-size:12px;color:#9aa3ad}
  .scene{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
  .ring{position:relative;transform-style:preserve-3d;will-change:transform}
  .sphere{position:absolute;left:50%;top:50%;transform-style:preserve-3d;transform:translate(-50%,-50%);width:120px;height:120px;border-radius:50%;display:grid;place-items:center;cursor:pointer;border:1px solid rgba(255,255,255,.10);background:radial-gradient(60% 60% at 35% 35%, rgba(230,240,255,.35), rgba(200,210,230,.10) 60%, rgba(0,0,0,0) 62%),radial-gradient(40% 40% at 70% 75%, rgba(60,70,90,.22), rgba(0,0,0,0));box-shadow:inset 0 1px 0 rgba(255,255,255,.14), inset 0 -12px 30px rgba(0,0,0,.28), 0 24px 60px rgba(0,0,0,.45);backdrop-filter:blur(16px) saturate(140%)}
  .sphere .plus{width:48px;height:48px;display:grid;place-items:center;border-radius:50%;background:radial-gradient(60% 60% at 40% 35%, rgba(255,255,255,.35), rgba(255,255,255,.12) 60%, rgba(255,255,255,.06) 61%),linear-gradient(180deg, rgba(255,255,255,.25), rgba(255,255,255,.05));box-shadow:inset 0 0 0 1px rgba(255,255,255,.25);font-weight:900;font-size:26px}
  .sphere .label{position:absolute;bottom:-10px;left:50%;transform:translateX(-50%);padding:4px 10px;border-radius:999px;border:1px solid var(--chip-line);background:#0f141a;font-size:12px;color:#aeb6bf}
  .avatar-bg{position:absolute;inset:-20%;background-position:center;background-size:cover;filter:blur(20px) saturate(120%);opacity:.35;z-index:0}
  dialog{border:none;border-radius:16px;padding:0;background:#0e1114;color:var(--fg);box-shadow:0 30px 80px rgba(0,0,0,.6);width:min(520px,92vw)}
  .sheet{padding:16px;border-bottom:1px solid var(--line)}
  .list{display:grid;grid-template-columns:1fr;gap:8px;padding:14px}
  .row{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:12px;border:1px solid var(--chip-line);background:#0f141a;cursor:pointer}
  .row:hover{border-color:#2a323c}
  `;
  const style=document.createElement("style"); style.textContent=css; document.head.appendChild(style);

  // ==== DOM
  document.body.innerHTML =
    '<div class="titlebar"><div></div><div class="brand">SPHERE</div><div style="width:16px"></div></div>' +
    '<div class="stage" id="view-login">' +
    '  <div class="grid-bg" id="grid-login"></div>' +
    '  <div class="card" id="loginCard">' +
    '    <h1>ВХОД</h1>' +
    '    <button class="btn primary" id="tgStart">Регистрация через Telegram</button>' +
    '    <p class="hint" style="margin-top:10px">После регистрации будет предложено указать имя и @ник, а также аватар (по желанию).</p>' +
    '  </div>' +
    '</div>' +

    '<div class="stage" id="view-scene" style="display:none">' +
    '  <div class="grid-bg" id="grid-scene"></div>' +
    '  <div id="avatarBg" class="avatar-bg" style="display:none"></div>' +
    '  <div class="scene"><div class="ring" id="ring">' +
    '    <div class="sphere" id="plusSphere" style="z-index:2"><div class="plus">+</div><div class="label">Добавить</div></div>' +
    '  </div></div>' +
    '</div>' +

    '<dialog id="pickerDlg"><div class="sheet"><b>Выбери сеть</b></div><div class="list" id="netList"></div></dialog>' +

    '<dialog id="nameDlg"><div class="sheet"><b>Завершение регистрации</b></div>' +
    '  <div style="padding:14px;display:grid;gap:10px">' +
    '    <input id="name" type="text" placeholder="Имя">' +
    '    <input id="handle" type="text" placeholder="@ник (латиница/цифры/._ 3–20)">' +
    '    <input id="avatar" type="file" accept="image/*">' +
    '    <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" id="saveProfile">Сохранить</button></div>' +
    '    <div class="hint" id="err" style="color:#ff8c8c;display:none"></div>' +
    '  </div>' +
    '</dialog>';

  const $=(q,r)=> (r||document).querySelector(q);
  const $$=(q,r)=> Array.from((r||document).querySelectorAll(q));

  const NETWORKS=[
    { name:"Instagram", url:"https://www.instagram.com/" },
    { name:"Telegram",  url:"https://web.telegram.org/a/" },
    { name:"VK",        url:"https://m.vk.com/" },
    { name:"Wikipedia", url:"https://m.wikipedia.org/" },
    { name:"Bing",      url:"https://lite.bing.com/" },
    { name:"YouTube",   url:"https://m.youtube.com/" }
  ];

  const api={
    config:()=>fetch("/api/config").then(r=>r.json()),
    me:()=>fetch("/api/me",{credentials:"include"}).then(r=>r.json()),
    saveName:(p)=>fetch("/api/name",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify(p)}),
    spheres:{
      list:()=>fetch("/api/spheres",{credentials:"include"}).then(r=>r.json()),
      add:(s)=>fetch("/api/spheres",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify(s)}),
      del:(id)=>fetch("/api/spheres?id="+encodeURIComponent(id),{method:"DELETE",credentials:"include"})
    }
  };

  let me=null, spheres=[];

  // ===== Login flow
  $("#tgStart").onclick = async ()=>{
    const cfg = await api.config();
    if (!cfg.botName){ alert("TG-бот не настроен на сервере."); return; }
    // Показать мини-диалог с виджетом
    const wrap = document.createElement("div");
    wrap.style.cssText="margin-top:12px";
    wrap.innerHTML = '<div class="hint" style="margin-bottom:6px">Нажми кнопку Telegram внизу:</div><div id="tg-slot"></div>';
    $("#loginCard").appendChild(wrap);

    const s=document.createElement("script");
    s.async=true;
    s.src="https://telegram.org/js/telegram-widget.js?22";
    s.setAttribute("data-telegram-login", cfg.botName);
    s.setAttribute("data-size","large");
    s.setAttribute("data-auth-url","/auth/telegram");
    s.setAttribute("data-request-access","write");
    s.setAttribute("data-radius","8");
    $("#tg-slot").appendChild(s);
    // кнопку больше не показываем, чтобы не дублировать
    $("#tgStart").disabled = true;
  };

  async function boot(){
    me = await api.me();
    if (!me.id){
      $("#view-login").style.display="flex";
      $("#view-scene").style.display="none";
      return;
    }
    if (!me.handle){ // завершение регистрации
      $("#nameDlg").showModal();
      $("#saveProfile").onclick = async ()=>{
        const name=$("#name").value.trim();
        const handle=$("#handle").value.trim().replace(/^@/,"");
        const f=$("#avatar").files[0];
        let photo="";
        const doSend = async ()=>{
          const resp = await api.saveName({name,handle,photo});
          if (!resp.ok && resp.status){ // если пришёл Response
            const t = await resp.text().catch(()=> "");
            showErr(t==="handle_taken" ? "Ник уже занят" : "Некорректный ник");
            return;
          }
          $("#nameDlg").close(); boot();
        };
        if (f){ const r=new FileReader(); r.onload=e=>{ photo=e.target.result; doSend(); }; r.readAsDataURL(f); }
        else { doSend(); }
      };
      return;
    }
    // сцена
    if (me.photo){ $("#avatarBg").style.backgroundImage=`url(${me.photo})`; $("#avatarBg").style.display="block"; }
    $("#view-login").style.display="none";
    $("#view-scene").style.display="flex";
    setupParallax();
    $("#plusSphere").onclick=()=>showPicker();
    spheres = await api.spheres.list();
    renderSpheres();
  }
  function showErr(msg){ const e=$("#err"); e.textContent=msg; e.style.display="block"; }

  function renderSpheres(){
    $$(".sphere.added").forEach(n=>n.remove());
    const R=160, ring=$("#ring"); let i=0;
    spheres.forEach(s=>{
      const el=document.createElement("div");
      el.className="sphere added";
      const ang=i*(Math.PI/6)+Math.PI/8; i++;
      el.style.transform=`translate(-50%,-50%) translate3d(${Math.cos(ang)*R}px, ${Math.sin(ang)*R*0.6}px, 0)`;
      el.innerHTML=`<div class="label">${s.name}</div>`;
      el.onclick=()=>openEmu(s);
      ring.appendChild(el);
    });
  }

  function showPicker(){
    const box=$("#netList"); box.innerHTML="";
    NETWORKS.forEach(n=>{
      if (spheres.some(s=>s.name.toLowerCase()===n.name.toLowerCase())) return; // без дублей
      const r=document.createElement("div"); r.className="row"; r.textContent=n.name;
      r.onclick=async ()=>{
        const resp=await api.spheres.add(n);
        if (resp.status===409) return; // дубликат
        spheres = await api.spheres.list();
        $("#pickerDlg").close();
        renderSpheres();
        const added=spheres.find(s=>s.name===n.name); if (added) openEmu(added);
      };
      box.appendChild(r);
    });
    $("#pickerDlg").showModal();
  }

  function openEmu(s){
    const panel=document.createElement("div");
    panel.style.cssText="position:fixed;inset:0;background:#0b0d10;z-index:50;display:flex;flex-direction:column";
    panel.innerHTML =
      '<div class="titlebar" style="position:relative;top:0;margin:10px 12px 0;grid-template-columns:1fr auto 1fr;background:rgba(13,16,20,.85)">' +
      `  <div style="padding-left:8px;font-weight:700">${s.name}</div>` +
      '  <div class="brand">SPHERE</div>' +
      '  <div style="justify-self:end;margin-right:8px;width:16px;height:16px;border-radius:50%;background:var(--danger);box-shadow:inset 0 0 0 1px #cc3a33,0 0 0 1px #2a1010;cursor:pointer" id="closeBtn"></div>' +
      '</div>' +
      '<div style="height:10px"></div>' +
      '<iframe id="emu" style="flex:1;border:0;background:#000" sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"></iframe>';
    document.body.appendChild(panel);
    $("#closeBtn",panel).onclick=()=>panel.remove();
    $("#emu",panel).src="/m?url="+encodeURIComponent(s.url);
  }

  function setupParallax(){
    const ring=$("#ring"), g1=$("#grid-login"), g2=$("#grid-scene");
    function tilt(rx,ry){
      ring.style.transform=`perspective(1200px) rotateX(${ry}deg) rotateY(${rx}deg)`;
      [g1,g2].forEach(g=>{ if(g) g.style.transform=`perspective(1600px) rotateX(${ry*0.6}deg) rotateY(${rx*0.6}deg)`; });
    }
    window.addEventListener("mousemove",e=>{ const rx=(e.clientX/innerWidth-0.5)*8; const ry=(0.5-e.clientY/innerHeight)*6; tilt(rx,ry); },{passive:true});
    if (typeof DeviceOrientationEvent!=="undefined" && DeviceOrientationEvent.requestPermission){
      window.addEventListener("click",()=>{ DeviceOrientationEvent.requestPermission().then(s=>{ if(s==="granted") window.addEventListener("deviceorientation",dev,{passive:true}); }).catch(()=>{}); },{once:true});
    } else if (typeof DeviceOrientationEvent!=="undefined"){
      window.addEventListener("deviceorientation",dev,{passive:true});
    }
    function dev(ev){ const rx=(ev.gamma||0)/8; const ry=-(ev.beta||0)/10; tilt(rx,ry); }
  }

  boot();
})();
