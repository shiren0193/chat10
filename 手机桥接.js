/* ============================================================
   手机桥接.js —— 主剧情前端 × 小手机 的同步层（单文件、无依赖）
   ------------------------------------------------------------
   把这一行加到你主前端 </body> 前：

       <script src="手机桥接.js"></script>

   它做四件事：
   1. 顶栏加一个「打开小手机」的按钮（📱），不再压在发送键上
   2. 按「会话」同步主线最近几轮 → 每个会话有自己的剧情 / 状态 / 未读
   3. 把当前会话的角色档案（名字 / 头像 / 她的名字）同步给小手机
   4. 手机里来了新消息 → 当前会话的按钮亮小红点

   数据全部按会话 id 分开存，切换会话不会再串角色。
   ============================================================ */
(function () {
  'use strict';

  var SRC = (function () {
    var s = document.currentScript;
    if (s && s.src) return s.src.replace(/[^/\\]*$/, '') + '小手机.html';
    return '小手机.html';
  })();

  /* ---------------- 按会话分开的 key ----------------
     旧版本用的是 lz.story.v1 / lz.phone.v1 这种全局 key，
     多个会话共用一份，切窗口就会串。现在统一带 chat id。 */
  var K_ACTIVE = 'lz.active.v1';
  var MAX_TURNS = 40;

  function keyOf(kind, chatId) {
    return 'lz.' + kind + '.' + (chatId || 'default') + '.v1';
  }
  function keysFor(chatId) {
    return {
      story: keyOf('story', chatId),
      state: keyOf('state', chatId),
      phone: keyOf('phone', chatId),
      role: keyOf('role', chatId),
      incoming: keyOf('incoming', chatId),
      returned: keyOf('returned', chatId)
    };
  }

  /* ---------------- 存取 ---------------- */
  function lsGet(k, def) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; }
    catch (e) { return def; }
  }
  function lsSet(k, o) {
    try { localStorage.setItem(k, JSON.stringify(o)); return true; }
    catch (e) { return false; }
  }

  /* ---------------- 当前会话档案 ---------------- */
  var active = null;

  function normalizeProfile(p) {
    p = p || {};
    var id = String(p.id || p.chatId || 'default');
    var name = String(p.aiName || p.name || '').trim();
    var uname = String(p.userName || '').trim();
    return {
      id: id,
      chatId: id,
      title: String(p.title || ''),
      aiName: name,
      userName: uname,
      aiAvatar: String(p.aiAvatar || ''),
      aiAvatarImage: p.aiAvatarImage || null,
      userAvatar: String(p.userAvatar || ''),
      userAvatarImage: p.userAvatarImage || null,
      model: String(p.model || ''),
      ts: Date.now()
    };
  }

  function readActiveFromStorage() {
    var o = lsGet(K_ACTIVE, null);
    return o && (o.id || o.chatId) ? normalizeProfile(o) : null;
  }

  function liveProfile() {
    var RP = window.__RP;
    if (RP && RP.ready) {
      try {
        var s = RP.session && RP.session();
        if (s && (s.id || s.chatId)) return normalizeProfile(s);
      } catch (e) {}
      try {
        var id = RP.chatId && RP.chatId();
        if (id) return normalizeProfile({
          id: id,
          aiName: (RP.aiName && RP.aiName()) || '',
          userName: (RP.userName && RP.userName()) || ''
        });
      } catch (e) {}
    }
    return readActiveFromStorage() || normalizeProfile({ id: 'default', aiName: '他', userName: '我' });
  }

  function currentProfile() {
    if (!active) active = liveProfile();
    return active;
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
    frame.addEventListener('load', function () {
      pushAll();
      clearUnread();
    });
  }

  function open() {
    buildOverlay();
    wrap.classList.add('on');
    var p = liveProfile();
    active = p;
    pushAll();
    clearUnread(p.id);
  }
  function close() {
    if (wrap) wrap.classList.remove('on');
  }

  /* ---------------- 顶栏那颗按钮 ----------------
     以前 fixed 在右下角，正好压在发送键上。现在优先塞进顶栏右侧，
     和搜索 / 设置并排；顶栏不存在时才退回浮动按钮，并且避开底栏。 */
  var btn = null, dot = null, unreadCount = 0;

  function buildButton() {
    if (btn) return;
    var css = document.createElement('style');
    css.textContent = [
      '#pbBtn{position:relative;flex-shrink:0;width:34px;height:34px;border:1px solid rgba(16,24,40,.14);',
      '  border-radius:50%;background:#fff;color:#3c4658;font-size:16px;line-height:1;cursor:pointer;',
      '  display:flex;align-items:center;justify-content:center;padding:0;',
      '  box-shadow:0 1px 2px rgba(16,24,40,.04);transition:color .15s,border-color .15s,transform .16s;}',
      '#pbBtn:hover{color:#0a7cff;border-color:rgba(10,124,255,.42);}',
      '#pbBtn:active{transform:scale(.92);}',
      '#pbBtn .pb-dot{position:absolute;right:-4px;top:-4px;min-width:17px;height:17px;',
      '  padding:0 4px;box-sizing:border-box;border-radius:980px;background:#FF3B30;color:#fff;',
      '  font:600 10px/17px -apple-system,system-ui,sans-serif;text-align:center;',
      '  box-shadow:0 0 0 2px #fff;display:none;}',
      '#pbBtn .pb-dot.on{display:block;}',
      '#pbBtn.pb-fixed{position:fixed;right:18px;bottom:calc(94px + env(safe-area-inset-bottom));',
      '  z-index:2147482999;width:46px;height:46px;font-size:21px;border-radius:50%;',
      '  background:rgba(28,32,38,.86);color:#fff;border:0;box-shadow:0 8px 26px rgba(0,0,0,.34);}',
      '#pbBtn.pb-fixed .pb-dot{box-shadow:0 0 0 2px rgba(28,32,38,.9);}',
      '@media (max-width:680px){#pbBtn{width:36px;height:36px;font-size:16px;}}'
    ].join('\n');
    document.head.appendChild(css);

    btn = document.createElement('button');
    btn.id = 'pbBtn';
    btn.type = 'button';
    btn.title = '打开小手机';
    btn.setAttribute('aria-label', '打开小手机');
    btn.innerHTML = '<span>📱</span><i class="pb-dot"></i>';
    btn.addEventListener('click', open);

    var topRight = document.querySelector('.topbar-right');
    if (topRight) {
      var settings = document.getElementById('settingsBtn');
      topRight.insertBefore(btn, settings || null);
    } else {
      btn.classList.add('pb-fixed');
      document.body.appendChild(btn);
    }
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

  function clearUnread(chatId) {
    var id = chatId || currentProfile().id;
    unreadCount = 0;
    paintDot();
    var k = keysFor(id).phone;
    var o = lsGet(k, null);
    if (o) { o.unread = 0; o.ts = Date.now(); lsSet(k, o); }
  }

  function readUnread(chatId) {
    var id = chatId || currentProfile().id;
    var o = lsGet(keysFor(id).phone, null);
    unreadCount = (o && o.unread) || 0;
    paintDot();
    if (o) emit('unread', o);
    return o;
  }

  /* ---------------- 主前端 → 手机 ---------------- */
  function post(msg) {
    if (!frame || !frame.contentWindow) return;
    try { frame.contentWindow.postMessage(msg, '*'); } catch (e) {}
  }

  function pushStoryToFrame() {
    var p = currentProfile();
    post({ source: 'lu-story', type: 'story', chatId: p.id, data: lsGet(keysFor(p.id).story, null) });
  }
  function pushStateToFrame() {
    var p = currentProfile();
    post({ source: 'lu-story', type: 'state', chatId: p.id, data: lsGet(keysFor(p.id).state, null) });
  }
  function pushRoleToFrame() {
    var p = currentProfile();
    post({ source: 'lu-story', type: 'role', chatId: p.id, data: lsGet(keysFor(p.id).role, null) });
  }
  function pushSessionToFrame() {
    var p = currentProfile();
    post({ source: 'lu-story', type: 'session', chatId: p.id, data: p });
  }
  function pushAll() {
    pushSessionToFrame();
    pushStoryToFrame();
    pushStateToFrame();
    pushRoleToFrame();
  }

  /* 切换会话：写 active，并通知已经打开的手机立刻换人 */
  function setSession(profile) {
    var p = normalizeProfile(profile || currentProfile());
    active = p;
    /* 头像图片可能是很大的 data URL，不写进 active 这个高频 key；
       嵌在 iframe 里时手机直接从 __RP.session() 拿完整头像。 */
    lsSet(K_ACTIVE, {
      id: p.id, chatId: p.id, title: p.title, model: p.model,
      aiName: p.aiName, userName: p.userName,
      aiAvatar: p.aiAvatar, userAvatar: p.userAvatar, ts: p.ts
    });
    pushSessionToFrame();
    pushStoryToFrame();
    pushStateToFrame();
    pushRoleToFrame();
    readUnread(p.id);
    return p;
  }

  function currentChatId() {
    return currentProfile().id;
  }

  /* 记一轮主线对话（role: 'user' 是她，'assistant' 是角色） */
  function pushTurn(role, content, chatId) {
    content = String(content == null ? '' : content).trim();
    if (!content) return;
    var id = chatId || currentProfile().id;
    var k = keysFor(id).story;
    var o = lsGet(k, { turns: [] }) || { turns: [] };
    o.turns = (o.turns || []).concat([{
      role: role === 'assistant' ? 'assistant' : 'user',
      content: content.slice(0, 1200)
    }]).slice(-MAX_TURNS);
    o.ts = Date.now();
    lsSet(k, o);
    pushStoryToFrame();
  }

  /* 记一整个 messages 数组（OpenAI 格式 [{role, content}]） */
  function pushHistory(messages, chatId) {
    if (!messages || !messages.length) return;
    var id = chatId || currentProfile().id;
    var k = keysFor(id).story;
    var o = {
      turns: messages
        .filter(function (m) { return m && m.content && (m.role === 'user' || m.role === 'assistant'); })
        .map(function (m) { return { role: m.role, content: String(m.content).slice(0, 1200) }; })
        .slice(-MAX_TURNS),
      ts: Date.now()
    };
    lsSet(k, o);
    pushStoryToFrame();
  }

  /* 设置状态：mood = angry | away | miss | calm */
  function setState(mood, reason, chatId) {
    var id = chatId || currentProfile().id;
    var k = keysFor(id).state;
    var o = { mood: mood || 'calm', reason: reason || '', ts: Date.now() };
    lsSet(k, o);
    pushStateToFrame();
    return o;
  }
  function clearState(chatId) { return setState('calm', '', chatId); }

  /* 她的设定（主前端那张字卡的 userRole）→ 手机拼 system 时带上 */
  function setRole(name, text, chatId) {
    var id = chatId || currentProfile().id;
    var k = keysFor(id).role;
    var o = { name: String(name || ''), text: String(text || '').slice(0, 1600), ts: Date.now() };
    lsSet(k, o);
    pushRoleToFrame();
    return o;
  }

  /* 主线判定「这一段改用手机聊」→ 把一条 iMessage 投进当前会话的手机 */
  function pushIncoming(text, opts) {
    opts = opts || {};
    var p = currentProfile();
    var id = opts.chatId || p.id;
    text = String(text == null ? '' : text).trim();
    if (!text) return null;
    var k = keysFor(id).incoming;
    var o = {
      text: text.slice(0, 1200),
      name: String(opts.name || p.aiName || '他'),
      ts: Date.now(),
      fromMain: true
    };
    lsSet(k, o);
    post({ source: 'lu-story', type: 'incoming', chatId: id, data: o });
    /* 没打开手机时也要亮红点；手机正开着且就是这一场，就不必再记未读 */
    var openHere = !!(wrap && wrap.classList.contains('on') && id === p.id);
    if (!openHere) {
      var pk = keysFor(id).phone;
      var po = lsGet(pk, { unread: 0, last: '', ts: 0 }) || {};
      po.unread = (po.unread || 0) + 1;
      po.last = text.replace(/\s+/g, ' ').slice(0, 60);
      po.ts = Date.now();
      lsSet(pk, po);
      if (id === p.id) { unreadCount = po.unread; paintDot(); }
    }
    emit('incoming', o);
    return o;
  }

  /* ---------------- 手机 → 主前端 ---------------- */
  window.addEventListener('storage', function (e) {
    if (!e.key) { readUnread(); return; }
    if (e.key.indexOf('lz.phone.') === 0) readUnread();
    if (e.key === K_ACTIVE) {
      active = readActiveFromStorage();
      readUnread();
    }
  });

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.source !== 'lu-phone') return;

    if (d.type === 'close') { close(); return; }

    if (d.type === 'return') {
      /* 手机里的剧情收尾 → 角色回到主线说一句。
         主前端如果提供了 __onPhoneReturn，就交给它写进对应会话；
         写完自动把手机收起来，用户不用自己判断该切回哪个界面。 */
      var data = d.data || { chatId: d.chatId, text: d.text };
      var handled = false;
      if (typeof window.__onPhoneReturn === 'function') {
        try { handled = window.__onPhoneReturn(data) !== false; } catch (e) { handled = false; }
      }
      emit('return', data);
      if (handled || !data.chatId || data.chatId === currentProfile().id) close();
      return;
    }

    if (d.type === 'unread' && d.state) {
      unreadCount = d.state.unread || 0;
      paintDot();
      emit('unread', d.state);
      return;
    }

    if (d.type === 'edit' && d.data) {
      emit('phoneEdit', d.data);
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
    active = liveProfile();
    readUnread(active.id);
    setInterval(function () {
      /* 主前端没有显式调 setSession 的路径（比如直接改 currentChatId）时兜底 */
      var p = liveProfile();
      if (!active || p.id !== active.id) {
        setSession(p);
      } else {
        readUnread(p.id);
      }
    }, 1200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.PhoneBridge = {
    open: open,
    close: close,
    setRole: setRole,
    setState: setState,
    clearState: clearState,
    setSession: setSession,
    session: function () { return currentProfile(); },
    pushTurn: pushTurn,
    pushHistory: pushHistory,
    pushIncoming: pushIncoming,
    on: on,
    off: off,
    clearUnread: clearUnread,
    readUnread: readUnread,
    get unread() { return unreadCount; },
    keys: function (chatId) { return keysFor(chatId || currentProfile().id); },
    activeKey: K_ACTIVE
  };
})();
