// GitHub 관리 화면 껍데기. 파이가 만들어 Cloudflare 중계(relay/)에 올려 둔 관리 화면을 받아 보여 주고,
// 폼 제출은 중계에 명령으로 맡긴 뒤 파이가 처리한 결과 화면(안내 포함)을 보여 준다.
// 보고 있는 관리 화면은 주소 뒤 #/admin/... 로 기억한다. 비밀번호는 로그인할 때 한 번 보내고, 브라우저에는 기한 있는 로그인 표만 둔다.
(function () {
  var box = document.querySelector('[data-remote-admin]');
  if (!box) return;
  window.superstarsRemote = true;

  var RELAY = (box.dataset.relay || '').replace(/\/+$/, '');
  var BASE = box.dataset.base || '';
  var KEY = 'superstars.adminToken', ROLE_KEY = 'superstars.adminRole';
  var $ = function (sel) { return box.querySelector(sel); };
  var view = $('[data-ra-view]'), loginBox = $('[data-ra-login]'), bar = $('[data-ra-bar]');
  var busy = $('[data-ra-busy]'), errBox = $('[data-ra-error]');

  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function stored(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  var token = stored(KEY);
  var current = '';          // 보고 있는 관리 경로 (/admin, /admin/events?edit=3 ...)
  var seq = 0;               // 화면 불러오기 순번 (늦게 온 응답이 새 화면을 덮지 않게)
  var dirty = false;         // 명부 표처럼 저장 전 변경이 있는 화면
  var syncTimer = null, pendingAnchor = '';

  // ---- 중계 호출
  function api(method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(RELAY + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (r.status === 401 && path !== '/api/login') { logout(d.error || '다시 로그인하세요.'); throw new Error('auth'); }
          if (!r.ok) throw new Error(d.error || ('중계 서버 오류 (HTTP ' + r.status + ')'));
          return d;
        });
      }, function () { throw new Error('중계 서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.'); });
  }

  // ---- 상태 표시
  function setBusy(text) { busy.textContent = text; busy.hidden = !text; view.classList.toggle('ra-dim', !!text); }
  function showError(msg) { setBusy(''); errBox.textContent = msg; errBox.hidden = !msg; }
  function piStatus(seen) {
    var el = $('[data-ra-pi]');
    if (seen === undefined) return;
    var ago = seen ? Math.max(0, Math.round(Date.now() / 1000 - seen)) : null;
    el.classList.toggle('ra-pi-bad', ago === null || ago > 150);
    if (ago === null) el.textContent = '파이가 아직 연결된 적이 없습니다';
    else if (ago <= 150) el.textContent = '파이 연결됨';
    else el.textContent = '파이가 ' + Math.round(ago / 60) + '분째 응답이 없습니다 · 맡긴 일은 파이가 연결되면 처리됩니다';
  }

  // ---- 로그인
  function showLogin(msg) {
    clearTimeout(syncTimer);
    view.innerHTML = ''; bar.hidden = true; setBusy(''); errBox.hidden = true;
    loginBox.hidden = false;
    var e = $('[data-ra-login-error]');
    e.textContent = msg || ''; e.hidden = !msg;
    var input = loginBox.querySelector('input[name="password"]');
    if (input) { input.value = ''; input.focus(); }
  }
  function logout(msg) { token = null; store(KEY, null); store(ROLE_KEY, null); showLogin(msg); }
  function loggedIn(role) {
    loginBox.hidden = true; bar.hidden = false;
    $('[data-ra-role]').textContent = role ? role + ' 권한' : '';
  }
  $('[data-ra-login-form]').addEventListener('submit', function (e) {
    e.preventDefault();
    var pw = e.target.querySelector('input[name="password"]').value;
    var btn = e.target.querySelector('button');
    btn.disabled = true;
    api('POST', '/api/login', { password: pw }).then(function (d) {
      token = d.token; store(KEY, token); store(ROLE_KEY, d.role_name);
      loggedIn(d.role_name);
      load(routeFromHash(), '');
    }, function (err) {
      var el = $('[data-ra-login-error]');
      el.textContent = err.message; el.hidden = false;
    }).then(function () { btn.disabled = false; });
  });
  $('[data-ra-logout]').addEventListener('click', function () { logout('로그아웃했습니다.'); });

  // ---- 주소
  function routeFromHash() {
    var h = '';
    try { h = decodeURIComponent(location.hash.slice(1)); } catch (e) {}
    return h === '/admin' || h.indexOf('/admin/') === 0 || h.indexOf('/admin?') === 0 ? h : '/admin';
  }
  function toRel(href) {         // 화면 안 링크·폼 주소 → 관리 경로. 관리 화면이 아니면 null
    var u;
    try { u = new URL(href, location.href); } catch (e) { return null; }
    if (u.origin !== location.origin || u.pathname.indexOf(BASE + '/admin') !== 0) return null;
    var p = u.pathname.slice(BASE.length).replace(/\/+$/, '') || '/admin';
    if (p !== '/admin' && p.indexOf('/admin/') !== 0) return null;
    return { path: p + u.search, anchor: decodeURIComponent(u.hash.slice(1)) };
  }
  function go(path, anchor) {
    if (dirty && !window.confirm('저장하지 않은 변경이 있습니다. 이 화면을 떠날까요?')) return;
    dirty = false;
    if (location.hash !== '#' + path) { pendingAnchor = anchor || ''; location.hash = path; }
    else load(path, anchor);
  }
  function replaceHash(path) {
    current = path;
    try { history.replaceState(null, '', '#' + path); } catch (e) {}
  }
  window.addEventListener('hashchange', function () {
    if (!token) return;
    var a = pendingAnchor; pendingAnchor = '';
    load(routeFromHash(), a);
  });
  window.superstarsNavigate = function (url) {     // app.js 의 select[data-nav] 같은 이동
    var rel = toRel(url);
    if (!rel) return false;
    go(rel.path, rel.anchor);
    return true;
  };

  // ---- 화면
  function scrollTo(anchor) {
    var el = anchor && document.getElementById(anchor);
    if (el) el.scrollIntoView(); else window.scrollTo(0, 0);
  }
  function show(page, anchor, keepScroll) {
    setBusy(''); errBox.hidden = true;
    var y = window.scrollY;
    view.innerHTML = page.main || '';
    if (page.title) document.title = page.title;
    dirty = false;
    if (window.superstarsInit) window.superstarsInit(view);
    if (view.querySelector('[data-lineup]')) {      // 라인업 짜보기 스크립트는 화면을 넣을 때마다 다시 붙인다
      var s = document.createElement('script');
      s.src = box.dataset.lineupSrc;
      document.body.appendChild(s);
    }
    if (keepScroll) window.scrollTo(0, y); else scrollTo(anchor);
    clearTimeout(syncTimer);
    if (view.querySelector('[data-sync-poll]')) {   // 동기화 중이면 잠시 뒤 새 화면을 다시 받는다
      syncTimer = setTimeout(function () { if (!dirty && busy.hidden) load(current, '', true); }, 8000);
    }
  }
  function waitFor(id, stillWanted) {
    var started = Date.now();
    return new Promise(function (resolve, reject) {
      (function tick() {
        if (!stillWanted()) return resolve(null);
        api('GET', '/api/command/' + id).then(function (d) {
          if (d.status === 'done') return resolve(d.result || {});
          piStatus(d.pi_last_seen);
          var waited = (Date.now() - started) / 1000;
          if (waited > 90) {
            return reject(new Error('파이가 응답하지 않습니다. 파이가 켜져 있는지 확인하세요. 맡긴 일은 파이가 다시 연결되면 처리됩니다.'));
          }
          if (waited > 6 && stillWanted()) setBusy('파이의 응답을 기다리는 중… ' + Math.round(waited) + '초');
          setTimeout(tick, waited < 10 ? 700 : 2000);
        }, reject);
      })();
    });
  }
  function load(path, anchor, quiet) {
    var my = ++seq;
    current = path;
    if (!quiet) setBusy('불러오는 중…');
    api('GET', '/api/page?path=' + encodeURIComponent(path)).then(function (d) {
      if (my !== seq) return;
      piStatus(d.pi_last_seen);
      if (d.page) return show(d.page, anchor, quiet);
      if (!quiet) setBusy('파이가 화면을 만드는 중입니다…');
      return waitFor(d.pending, function () { return my === seq; }).then(function (res) {
        if (!res || my !== seq) return;
        if (!res.main) return showError(res.error || '화면을 받지 못했습니다.');
        show(res, anchor, quiet);
        if (res.path && res.path !== path) replaceHash(res.path);     // 권한이 없어 관리 첫 화면으로 간 경우
      });
    }).catch(function (err) { if (err.message !== 'auth' && my === seq) showError(err.message); });
  }
  function submit(path, pairs, form) {
    var my = ++seq;
    var buttons = form.querySelectorAll('button, input[type="submit"]');
    Array.prototype.forEach.call(buttons, function (b) { b.disabled = true; });
    setBusy('저장하는 중…');
    api('POST', '/api/command', { path: path, form: pairs }).then(function (d) {
      piStatus(d.pi_last_seen);
      return waitFor(d.id, function () { return true; });           // 저장은 다른 화면으로 가도 끝까지 기다린다
    }).then(function (res) {
      if (my !== seq) return;
      if (!res.main) { showError(res.error || '처리 결과를 받지 못했습니다.'); return; }
      show(res, res.hash || '');
      if (res.path) replaceHash(res.path);
    }).catch(function (err) {
      if (err.message !== 'auth') showError(err.message);
    }).then(function () {
      Array.prototype.forEach.call(buttons, function (b) { b.disabled = false; });
    });
  }

  // ---- 화면 안의 링크·폼을 가로챈다
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.target === '_blank') return;
    var rel = toRel(a.href);
    if (!rel) return;
    e.preventDefault();
    if (!token) return showLogin();
    if (rel.path === current && rel.anchor) return scrollTo(rel.anchor);
    go(rel.path, rel.anchor);
  }, true);
  view.addEventListener('submit', function (e) {
    if (e.defaultPrevented) return;                  // 확인 창에서 취소한 경우 등
    var f = e.target;
    var rel = toRel(f.getAttribute('action') || location.href);
    if (!rel) return;
    e.preventDefault();
    var pairs = [];
    new FormData(f).forEach(function (v, k) { if (typeof v === 'string') pairs.push([k, v]); });
    if (e.submitter && e.submitter.name) pairs.push([e.submitter.name, e.submitter.value || '']);
    if ((f.getAttribute('method') || 'get').toLowerCase() === 'get') {
      var q = new URLSearchParams(pairs).toString();
      return go(rel.path.split('?')[0] + (q ? '?' + q : ''), '');
    }
    if (rel.path === '/admin/logout') return logout('로그아웃했습니다.');
    submit(rel.path.split('?')[0], pairs, f);
  });
  ['input', 'change'].forEach(function (t) {
    view.addEventListener(t, function (e) { if (e.target.closest && e.target.closest('form[data-dirty-guard]')) dirty = true; });
  });

  // ---- 보고 있는 동안 '사용 중' 알림 (파이가 확인 간격을 줄인다)
  function ping() {
    if (token && document.visibilityState === 'visible') api('POST', '/api/ping').then(function (d) { piStatus(d.pi_last_seen); }, function () {});
  }
  setInterval(ping, 20000);
  document.addEventListener('visibilitychange', ping);

  if (!RELAY) { showError('중계 서버 주소가 설정되지 않았습니다.'); return; }
  if (token) { loggedIn(stored(ROLE_KEY)); load(routeFromHash(), ''); }
  else showLogin();
})();
