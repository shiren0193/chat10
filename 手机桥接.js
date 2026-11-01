/* ============================================================
   手机桥接.js —— 主剧情前端 × 小手机 的同步层（单文件、无依赖）
   ------------------------------------------------------------
   把这一行加到你主前端 </body> 前：

       <script src="手机桥接.js"></script>

   它做四件事：
   1. 右下角加一个「打开小手机」的按钮，点开是浮层里的手机（iframe）
   2. 把主线的最近几轮对话写进 localStorage → 手机里的陆灼全都看得到
   3. 把状态（生气 / 离开 / 想她）写进去 → 手机解锁时会先开口
   4. 手机里来了新消息 → 按钮上亮小红点

   手机端（index.html）已经写好读取逻辑，这个文件只负责「主前端这边」。
   ============================================================ */
(function () {
  'use strict';

  var SRC = (function () {
    var s = document.currentScript;
    if (s && s.src) return s.src.replace(/[^/\\]*$/, '') + '小手机.html';
    return '小手机.html';
  })();

  var K_STORY = 'lz.story.v1';
  var K_STATE = 'lz.bridge.v1';
  var K_PHONE = 'lz.phone.v1';
  var K_ROLE  = 'lz.role.v1';   // 主前端写：她的设定 { name, text, ts }
  var MAX_TURNS = 40;

  /* ---------------- 存取 ---------------- */
  function lsGet(k, def) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; }
    catch (e) { return def; }
  }
  function lsSet(k, o) {
    try { localStorage.setItem(k, JSON.stringify(o)); return true; }
    catch (e) { return false; }
  }

  /* ---------------- 浮层里的手机 ---------------- */
  var wrap = null, frame = null;

  function buildOverlay() {
    if (wrap) return;

    wrap = document.createElement('div');
    wrap.id = 'pbOverlay';
    wrap.innerHTML =
      '<div class="pb-back"></div>' +
      '<div class="pb-stage">' +
        '<button class="pb-x" type="button" aria-label="关闭">✕</button>' +
        '<iframe class="pb-frame" title="小手机" src="' + (document.currentScript && document.currentScript.getAttribute('data-src') || SRC) + '"></iframe>' +
      '</div>';

    var css = document.createElement('style');
    css.textContent = [
      '#pbOverlay{position:fixed;inset:0;z-index:2147483000;display:none;}',
      '#pbOverlay.on{display:block;}',
      '#pbOverlay .pb-back{position:absolute;inset:0;background:rgba(6,10,14,.62);',
      '  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);}',
      '#pbOverlay .pb-stage{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);',
      '  width:min(430px,94vw);height:min(932px,94vh);border-radius:26px;overflow:hidden;',
      '  background:#000;box-shadow:0 30px 90px rgba(0,0,0,.6);}',
      '#pbOverlay .pb-frame{width:100%;height:100%;border:0;display:block;background:#000;}',
      '#pbOverlay .pb-x{position:absolute;right:8px;top:8px;z-index:3;width:30px;height:30px;border:0;',
      '  border-radius:50%;background:rgba(0,0,0,.38);color:#fff;font-size:13px;line-height:30px;',
      '  cursor:pointer;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);',
      '  box-shadow:0 0 0 .5px rgba(255,255,255,.22) inset;}',
      '@media (max-width:520px){',
      '  #pbOverlay .pb-stage{width:100vw;height:100vh;border-radius:0;}',
      '  #pbOverlay .pb-x{right:10px;top:10px;z-index:2;}',
      '}'
    ].join('\n');
    document.head.appendChild(css);
    document.body.appendChild(wrap);

    wrap.querySelector('.pb-back').addEventListener('click', close);
    wrap.querySelector('.pb-x').addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && wrap.classList.contains('on')) close();
    });

    frame = wrap.querySelector('.pb-frame');
  }

  function open() {
    buildOverlay();
    wrap.classList.add('on');
    pushStoryToFrame();
    pushStateToFrame();
    pushRoleToFrame();
    clearUnread();
  }
  function close() {
    if (wrap) wrap.classList.remove('on');
  }

  /* ---------------- 右下角那颗按钮 ---------------- */
  var btn = null, dot = null, unreadCount = 0;

  function buildButton() {
    if (btn) return;
    var css = document.createElement('style');
    css.textContent = [
      '#pbBtn{position:fixed;right:18px;bottom:22px;z-index:2147482999;',
      '  width:52px;height:52px;border:0;border-radius:50%;cursor:pointer;',
      '  background:rgba(28,32,38,.82);color:#fff;font-size:23px;line-height:1;',
      '  -webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);',
      '  box-shadow:0 8px 26px rgba(0,0,0,.34),0 0 0 .5px rgba(255,255,255,.18) inset;',
      '  transition:transform .16s,opacity .2s;}',
      '#pbBtn:active{transform:scale(.92);}',
      '#pbBtn.pb-hide{opacity:0;pointer-events:none;transform:scale(.6);}',
      '#pbBtn .pb-dot{position:absolute;right:-1px;top:-1px;min-width:19px;height:19px;',
      '  padding:0 5px;box-sizing:border-box;border-radius:980px;background:#FF3B30;color:#fff;',
      '  font:600 11px/19px -apple-system,system-ui,sans-serif;text-align:center;',
      '  box-shadow:0 0 0 2px rgba(28,32,38,.9);display:none;}',
      '#pbBtn .pb-dot.on{display:block;}'
    ].join('\n');
    document.head.appendChild(css);

    btn = document.createElement('button');
    btn.id = 'pbBtn';
    btn.type = 'button';
    btn.title = '打开小手机';
    btn.innerHTML = '<span>📱</span><i class="pb-dot"></i>';
    btn.addEventListener('click', open);
    document.body.appendChild(btn);
    dot = btn.querySelector('.pb-dot');
  }

  function paintDot() {
    if (!dot) return;
    if (unreadCount > 0) {
      dot.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
      dot.classList.add('on');
    } else {
      dot.classList.remove('on');
    }
  }

  function clearUnread() {
    unreadCount = 0;
    paintDot();
    var o = lsGet(K_PHONE, null);
    if (o) { o.unread = 0; o.ts = Date.now(); lsSet(K_PHONE, o); }
  }

  /* ---------------- 主前端 → 手机 ---------------- */
  function pushStoryToFrame() {
    if (!frame || !frame.contentWindow) return;
    try {
      frame.contentWindow.postMessage({ source: 'lu-story', type: 'story', data: lsGet(K_STORY, null) }, '*');
    } catch (e) {}
  }
  function pushStateToFrame() {
    if (!frame || !frame.contentWindow) return;
    try {
      frame.contentWindow.postMessage({ source: 'lu-story', type: 'state', data: lsGet(K_STATE, null) }, '*');
    } catch (e) {}
  }

  /* 记一轮主线对话（role: 'user' 是她，'assistant' 是陆灼） */
  function pushTurn(role, content) {
    content = String(content == null ? '' : content).trim();
    if (!content) return;
    var o = lsGet(K_STORY, { turns: [] }) || { turns: [] };
    o.turns = (o.turns || []).concat([{
      role: role === 'assistant' ? 'assistant' : 'user',
      content: content.slice(0, 1200)
    }]).slice(-MAX_TURNS);
    o.ts = Date.now();
    lsSet(K_STORY, o);
    pushStoryToFrame();
  }

  /* 记一整个 messages 数组（OpenAI 格式 [{role, content}]） */
  function pushHistory(messages) {
    if (!messages || !messages.length) return;
    var o = {
      turns: messages
        .filter(function (m) { return m && m.content && (m.role === 'user' || m.role === 'assistant'); })
        .map(function (m) { return { role: m.role, content: String(m.content).slice(0, 1200) }; })
        .slice(-MAX_TURNS),
      ts: Date.now()
    };
    lsSet(K_STORY, o);
    pushStoryToFrame();
  }

  /* 设置状态：mood = angry | away | miss | calm */
  function setState(mood, reason) {
    var o = { mood: mood || 'calm', reason: reason || '', ts: Date.now() };
    lsSet(K_STATE, o);
    pushStateToFrame();
    return o;
  }
  function clearState() { return setState('calm', ''); }

  /* 她的设定（主前端那张字卡的 userRole）→ 手机拼 system 时带上 */
  function setRole(name, text) {
    var o = { name: String(name || ''), text: String(text || '').slice(0, 1600), ts: Date.now() };
    lsSet(K_ROLE, o);
    pushRoleToFrame();
    return o;
  }
  function pushRoleToFrame() {
    if (!frame || !frame.contentWindow) return;
    try { frame.contentWindow.postMessage({ source: 'lu-story', type: 'role', data: lsGet(K_ROLE, null) }, '*'); } catch (e) {}
  }

  /* ---------------- 手机 → 主前端 ---------------- */
  function readUnread() {
    var o = lsGet(K_PHONE, null);
    if (!o) return;
    unreadCount = o.unread || 0;
    paintDot();
    emit('unread', o);
  }

  window.addEventListener('storage', function (e) {
    if (e.key === K_PHONE || e.key === null) readUnread();
  });

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.source !== 'lu-phone') return;
    if (d.type === 'close') { close(); return; }   // 手机说：这段收尾了，回主线
    if (d.type === 'unread' && d.state) {
      unreadCount = d.state.unread || 0;
      paintDot();
      emit('unread', d.state);
    }
  });

  /* ---------------- 小事件总线 ---------------- */
  var subs = {};
  function on(type, fn) { (subs[type] = subs[type] || []).push(fn); return function () { off(type, fn); }; }
  function off(type, fn) { subs[type] = (subs[type] || []).filter(function (f) { return f !== fn; }); }
  function emit(type, data) { (subs[type] || []).forEach(function (f) { try { f(data); } catch (e) {} }); }

  /* ---------------- 启动 ---------------- */
  function boot() {
    var s = document.currentScript || document.querySelector('script[src*="手机桥接"]');
    if (s && s.getAttribute('data-auto-button') === 'false') return;
    buildButton();
    readUnread();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.PhoneBridge = {
    open: open,
    close: close,
    setRole: setRole,
    setState: setState,
    clearState: clearState,
    pushTurn: pushTurn,
    pushHistory: pushHistory,
    on: on,
    off: off,
    clearUnread: clearUnread,
    get unread() { return unreadCount; },
    keys: { story: K_STORY, state: K_STATE, phone: K_PHONE, role: K_ROLE }
  };
})();
