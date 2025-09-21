/* SPHERE front-end — landing → login → name/handle/avatar → 3D scene with + sphere
   - Parallax от мыши и DeviceOrientation (iOS спросит разрешение)
   - Список сетей только названия
   - Сферы хранятся в localStorage (эмулятор «сохраняется» на устройстве)
   - Открытие эмулятора: /m?pid=<pid>&url=<url>
*/

(() => {
  'use strict';

  // ===== CSS (инжектим, чтобы ничего отдельно не подключать)
  const css = `
  :root{--bg:#07090b;--fg:#e9edf2;--muted:#9aa3ad;--line:#151a1f;--panel:#0e1116;--chip:#10141a;--chip-line:#212831;--danger:#ff5f57}
  *{box-sizing:border-box}
  html,body{height:100%;margin:0;background:var(--bg);color:var(--fg);font:400 16px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"SF Pro Text","Segoe UI",Roboto,Arial}
  .titlebar{position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top) + 10px);height:56px;display:grid;grid-template-columns:1fr 160px 1fr;align-items:center;border:1px solid var(--line);border-radius:16px;background:rgba(10,12,14,.65);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);z-index:20}
  .brand{justify-self:center;letter-spacing:.18em;font-weight:800}
  .macdot{justify-self:end;margin-right:8px;width:16px;height:16px;border-radius:50%;background:var(--danger);box-shadow:inset 0 0 0 1px #cc3a33,0 0 0 1px #2a1010}
  .stage{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden}
  .grid-bg{position:absolute;inset:-20% -10% -10% -10%;background:radial-gradient(1200px 700px at 50% 0%, #0c0f13 0%, #07090b 60%);pointer-events:none}
  .grid-bg::after{content:"";position:absolute;inset:0;background:linear-gradient(to right, rgba(255,255,255,.04) 1px, transparent 1px) 0 0/60px 60px,linear-gradient(to bottom, rgba(255,255,255,.04) 1px, transparent 1px) 0 0/60px 60px;transform-origin:50% 30%;opacity:.22}
  .card{position:relative;width:min(560px,92vw);border:1px solid var(--line);border-radius:16px;background:rgba(12,14,16,.75);backdrop-filter:blur(12px);padding:18px}
  .card h1{margin:6px 0 8px;font-size:22px;letter-spacing:.14em}
  .chip{display:inline-flex;gap:8px;align-items:center;padding:6px 10px;border:1px solid var(--chip-line);border-radius:999px;background:var(--chip);color:var(--muted);font-size:13px}
  .btn{display:inline-block;padding:12px 14px;border-radius:12px;border:1px solid var(--chip-line);background:linear-gradient(180deg,#121923,#0e131a);color:var(--fg);cursor:pointer}
  .field{display:flex;flex-direction:column;gap:10px;margin-top:12px}
  input[type="text"],input[type="file"]{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #262e38;background:#0f1318;color:var(--fg)}
  .scene{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
  .ring{position:relative;transform-style:preserve-3d;will-change:transform}
  .sphere{position:absolute;left:50%;top:50%;transform-style:preserve-3d;transform:translate(-50%,-50%);width:120px;height:120px;border-radius:50%;display:grid;place-items:center;cursor:pointer;border:1px solid rgba(255,255,255,.10);background:radial-gradient(60% 60% at 35% 35%, rgba(230,240,255,.35), rgba(200,210,230,.10) 60%, rgba(0,0,0,0) 62%),radial-gradient(40% 40% at 70% 75%, rgba(60,70,90,.22), rgba(0,0,0,0));box-shadow:inset 0 1px 0 rgba(255,255,255,.14), inset 0 -12px 30px rgba(0,0,0,.28), 0 24px 60px rgba(0,0,0,.45);backdrop-filter:blur(16px) saturate(140%)}
  .sphere .plus{width:48px;height:48px;display:grid;place-items:center;border-radius:50%;background:radial-gradient(60% 60% at 40% 35%, rgba(255,255,255,.35), rgba(255,255,255,.12) 60%, rgba(255,255,255,.06) 61%),linear-gradient(180deg, rgba(255,255,255,.25), rgba(255,255,255,.05));box-shadow:inset 0 0 0 1px rgba(255,255,255,.25);font-weight:900;font-size:26px}
  .sphere .label{position:absolute;bottom:-10px;left:50%;transform:translateX(-50%);padding:4px 10px;border-radius:999px;border:1px solid var(--chip-line);background:var(--chip);font-size:12px;color:var(--muted)}
  .avatar-bg{position:absolute;inset:-20%;background-position:center;background-size:cover;filter:blur(20px) saturate(120%);opacity:.35;z-index:0}
  dialog{border:none;border-radius:16px;padding:0;background:#0e1114;color:var(--fg);box-shadow:0 30px 80px rgba(0,0,0,.6);width:min(520px,92vw)}
  .sheet{padding:16px;border-bottom:1px solid var(--line)}
  .list{display:grid;grid-template-columns:1fr;gap:8px;padding:14px}
  .row{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:12px;border:1px solid var(--chip-line);background:#0f141a;cursor:pointer}
  .row:hover{border-color:#2a323c}
  .actions{display:flex;gap:10px;justify-content:flex-end;padding:0 16px 16px}
  button{padding:10px 14px;border-radius:10px;border:1px solid #26303a;background:#121922;color:var(--fg);cursor:pointer}
  .ghost{background:#0f1318}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ===== каркас DOM
  document.body.innerHTML = ''
    + '<div class="titlebar"><div></div><div class="brand">SPHERE</div><div class="macdot" title="Закрыть"></div></div>'
    + '<div class="stage" id="view-login">'
    + '  <div class="grid-bg" id="grid-login"></div>'
    + '  <div class="card">'
    + '    <div class="chip">Добро пожаловать</div>'
    + '    <h1>Sphere</h1>'
    + '    <p style="margin:0 0 8px;color:var(--muted)">Войти через Telegram, затем укажи имя/ник и (по желанию) аватар.</p>'
    + '    <div id="tg-slot" style="margin:10px 0 4px"></div>'
    + '    <div style="display:flex;gap:10px;align-items:center">'
    + '      <button class="btn" id="mockLogin">Войти (демо)</button>'
    + '      <span style="font-size:12px;color:var(--muted)">Если виджета Telegram нет — используй демо-вход.</span>'
    + '    </div>'
    + '    <div class="field" id="after-tg" style="display:none">'
    + '      <input id="name"   type="text" placeholder="Имя">'
    + '      <input id="handle" type="text" placeholder="Имя пользователя (уникально, латиница/цифры/._)">'
    + '      <input id="avatar" type="file" accept="image/*">'
    + '      <button class="btn" id="finish">Продолжить</button>'
    + '    </div>'
    + '  </div>'
    + '</div>'
    + '<div class="stage" id="view-scene" style="display:none">'
    + '  <div class="grid-bg" id="grid-scene"></div>'
    + '  <div id="avatarBg" class="avatar-bg" style="display:none"></div>'
    + '  <div class="scene"><div class="ring" id="ring">'
    + '    <div class="sphere" id="plusSphere" style="z-index:2">'
    + '      <div class="plus">+</div><div class="label">Добавить</div>'
    + '    </div>'
    + '  </div></div>'
    + '</div>'
    + '<dialog id="dlg"><div class="sheet"><b style="letter-spacing:.06em">Выбери сеть</b></div><div class="list" id="netList"></div><div class="actions"><button class="ghost" id="dlgCancel">Отмена</button></div></dialog>';

  // ===== маленькие утилиты
  const $ = (q, root) => (root || document).querySelector(q);
  const $$ = (q, root) => Array.from((root || document).querySelectorAll(q));
  const save = () => localStorage.setItem('sphere_profiles', JSON.stringify(state.profiles));
  const load = () => { try { state.profiles = JSON.parse(localStorage.getItem('sphere_profiles') || '[]'); } catch { state.profiles = []; } };

  // ===== состояние
  const state = { me: null, profiles: [] };
  load();

  // ===== Telegram (опционально). Если хочешь — выставь window.BOT_NAME = 'имя_бота' до подключения app.js
  const TG_BOT_NAME = window.BOT_NAME || 'YOUR_TG_BOT_NAME';
  if (TG_BOT_NAME && TG_BOT_NAME !== 'YOUR_TG_BOT_NAME') {
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://telegram.org/js/telegram-widget.js?22';
    s.setAttribute('data-telegram-login', TG_BOT_NAME);
    s.setAttribute('data-size', 'large');
    s.setAttribute('data-auth-url', '/auth/telegram');
    s.setAttribute('data-request-access', 'write');
    $('#tg-slot').appendChild(s);
  }

  // ===== действия на лендинге
  $('#mockLogin').onclick = () => { $('#after-tg').style.display = 'block'; };
  $('#finish').onclick = () => {
    const name = $('#name').value.trim();
    const handle = $('#handle').value.trim();
    if (!/^([a-zA-Z0-9_.]{3,20})$/.test(handle)) { alert('Некорректный ник. Латиница/цифры/._, 3–20 символов.'); return; }
    if (state.profiles.some(p => p.handle === handle)) { alert('Ник уже занят в этом устройстве.'); return; }
    state.me = { name, handle };

    const file = $('#avatar').files[0];
    if (file) {
      const r = new FileReader();
      r.onload = e => { state.me.photo = e.target.result; bootScene(); };
      r.readAsDataURL(file);
    } else {
      bootScene();
    }
  };

  function bootScene() {
    if (state.me && state.me.photo) {
      const bg = $('#avatarBg');
      bg.style.backgroundImage = 'url(' + state.me.photo + ')';
      bg.style.display = 'block';
    }
    $('#view-login').style.display = 'none';
    $('#view-scene').style.display = 'flex';
    mountPlus();
    mountNetList();
    setupParallax();
    renderExistingSpheres();
  }

  // ===== список сетей (только названия)
  const NETWORKS = [
    { id: 'instagram', name: 'Instagram', url: 'https://www.instagram.com/' },
    { id: 'youtube',   name: 'YouTube',   url: 'https://m.youtube.com/' },
    { id: 'telegram',  name: 'Telegram',  url: 'https://web.telegram.org/a/' },
    { id: 'x',         name: 'X (Twitter)', url: 'https://mobile.twitter.com/' },
    { id: 'tiktok',    name: 'TikTok',    url: 'https://www.tiktok.com/' },
    { id: 'vk',        name: 'VK',        url: 'https://m.vk.com/' }
  ];

  function mountNetList() {
    const box = $('#netList'); box.innerHTML = '';
    NETWORKS.forEach(n => {
      const r = document.createElement('div');
      r.className = 'row';
      r.textContent = n.name;
      r.onclick = () => chooseNet(n);
      box.appendChild(r);
    });
    $('#dlgCancel').onclick = () => $('#dlg').close();
  }

  // ===== плюс-сфера и рендер сохранённых
  function mountPlus() { $('#plusSphere').onclick = () => $('#dlg').showModal(); }

  function renderExistingSpheres() {
    $$('.sphere.added').forEach(el => el.remove());
    const R = 160, ring = $('#ring'); let i = 0;
    state.profiles.forEach(p => {
      const s = document.createElement('div');
      s.className = 'sphere added';
      const ang = i * (Math.PI / 6) + Math.PI / 8; i++;
      s.style.transform = 'translate(-50%,-50%) translate3d(' + (Math.cos(ang) * R) + 'px,' + (Math.sin(ang) * R * 0.6) + 'px,0)';
      s.innerHTML = '<div class="label">' + p.name + '</div>';
      s.title = p.name;
      s.onclick = () => openEmu(p);
      ring.appendChild(s);
    });
  }

  function chooseNet(net) {
    $('#dlg').close();
    // пробуем создать профиль на сервере; если эндпоинта нет — используем локально
    const payload = { name: net.name, url: net.url, ua: '' };
    fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(r => r.ok ? r.json() : payload)
      .then(p => {
        const profile = { id: p.pid || crypto.randomUUID(), pid: p.pid, handle: (state.me && state.me.handle) || '', name: p.name, url: p.url };
        state.profiles.push(profile); save(); renderExistingSpheres(); openEmu(profile);
      })
      .catch(() => {
        const profile = { id: crypto.randomUUID(), handle: (state.me && state.me.handle) || '', name: net.name, url: net.url };
        state.profiles.push(profile); save(); renderExistingSpheres(); openEmu(profile);
      });
  }

  // ===== «эмулятор» поверх
  function openEmu(p) {
    const ensure = p.pid
      ? Promise.resolve(p)
      : fetch('/api/profile/ensure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })
          .then(r => r.ok ? r.json() : p).catch(() => p);

    ensure.then(pr => {
      const panel = document.createElement('div');
      panel.style.cssText = 'position:fixed;inset:0;background:#0b0d10;z-index:50;display:flex;flex-direction:column';
      panel.innerHTML =
        '<div style="height:56px;display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--line);background:#0d1014">'
        + '  <div style="font-weight:700">' + p.name + '</div>'
        + '  <div style="display:flex;gap:8px">'
        + '    <button class="btn" id="ipBtn">IP профиля</button>'
        + '    <button class="btn" id="resetBtn">Сбросить сессию</button>'
        + '    <button class="btn" id="closeBtn">Закрыть</button>'
        + '  </div>'
        + '</div>'
        + '<iframe id="emu" style="flex:1;border:0;background:#000" sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"></iframe>';
      document.body.appendChild(panel);

      $('#closeBtn', panel).onclick = () => panel.remove();
      $('#resetBtn', panel).onclick = () =>
        fetch('/api/reset?pid=' + encodeURIComponent(pr.pid || p.id), { method: 'POST' })
          .then(() => alert('Очищено'))
          .catch(() => alert('Очищено (локально)'));

      $('#ipBtn', panel).onclick = () =>
        fetch('/api/ip?pid=' + encodeURIComponent(pr.pid || p.id))
          .then(r => r.text()).then(t => alert('IP профиля: ' + t))
          .catch(() => alert('IP недоступен'));

      const url = '/m?pid=' + encodeURIComponent(pr.pid || p.id) + '&url=' + encodeURIComponent(p.url);
      $('#emu', panel).src = url;
    });
  }

  // ===== параллакс (мышь/наклон телефона)
  function setupParallax() {
    const ring = $('#ring');
    const grid1 = $('#grid-login'), grid2 = $('#grid-scene');
    function tilt(rx, ry) {
      ring.style.transform = 'perspective(1200px) rotateX(' + ry + 'deg) rotateY(' + rx + 'deg)';
      [grid1, grid2].forEach(g => { if (g) g.style.transform = 'perspective(1600px) rotateX(' + (ry * 0.6) + 'deg) rotateY(' + (rx * 0.6) + 'deg)'; });
    }
    window.addEventListener('mousemove', e => {
      const rx = (e.clientX / innerWidth - 0.5) * 8;
      const ry = (0.5 - e.clientY / innerHeight) * 6;
      tilt(rx, ry);
    }, { passive: true });

    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      window.addEventListener('click', ask, { once: true });
      function ask() {
        DeviceOrientationEvent.requestPermission().then(s => {
          if (s === 'granted') window.addEventListener('deviceorientation', dev, { passive: true });
        }).catch(() => {});
      }
    } else if (typeof DeviceOrientationEvent !== 'undefined') {
      window.addEventListener('deviceorientation', dev, { passive: true });
    }
    function dev(ev) {
      const rx = (ev.gamma || 0) / 8;
      const ry = -(ev.beta || 0) / 10;
      tilt(rx, ry);
    }
  }

  // ===== автозапуск: если уже есть профиль владельца — сразу сцена
  try {
    const meRaw = localStorage.getItem('sphere_me');
    if (meRaw) state.me = JSON.parse(meRaw);
  } catch {}
  if (state.me) bootScene();
  // сохраняем «me» при изменении
  const saveMe = () => localStorage.setItem('sphere_me', JSON.stringify(state.me || {}));
  new MutationObserver(saveMe).observe(document.body, { subtree: false });

})();
