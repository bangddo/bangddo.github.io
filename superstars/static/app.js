(function () {
  var BODY = document.body;
  var STATIC = BODY.dataset.static === '1';           // GitHub Pages 용 정적 사이트인가
  var ROOT = (BODY.dataset.base || '') + '/';

  // 정적 사이트에서는 주소창을 루트에 고정한 채 내용만 바꿔 끼운다(아래 shell). 서버 모드에서는 보통 이동.
  function navigateTo(url) {
    if (window.superstarsNavigate && window.superstarsNavigate(url)) return;   // GitHub 관리 화면 껍데기가 맡는 주소
    if (STATIC && window.__superstarsLoad) window.__superstarsLoad(url, true);
    else location.href = url;
  }

  // ---- 날짜 표시는 브라우저에서 다시 계산한다.
  // 정적 사이트(GitHub Pages)는 게시한 날 기준으로 만들어지므로, 열 때마다 오늘(한국 시간) 기준으로
  // D데이·'기준' 날짜를 고치고, 게시 뒤에 끝난 일정은 다가올 일정과 '예정된 일정' 탭에서 숨긴다.
  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function todayKST() {
    try {
      var s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    } catch (e) { /* 아래 방식으로 */ }
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function dayNum(s) {                     // 'YYYY-MM-DD' → 1970-01-01 부터 센 날 수
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null;
  }
  function fmtDate(s) {                    // 서버의 fmt_date 와 같은 모양: 2026.10.31(토)
    var n = dayNum(s);
    if (n === null) return '';
    var d = new Date(n * 86400000);
    return d.getUTCFullYear() + '.' + pad2(d.getUTCMonth() + 1) + '.' + pad2(d.getUTCDate()) + '(' + WEEKDAYS[d.getUTCDay()] + ')';
  }
  function ddayLabel(start, end, today) {  // 서버의 dday_span 과 같은 규칙
    var s = dayNum(start), e = dayNum(end), t = dayNum(today);
    if (s === null || t === null) return null;
    if (e !== null && e > s && s < t && t <= e) return '진행 중';
    var diff = s - t;
    if (diff === 0) return '오늘';
    if (diff === 1) return '내일';
    return diff > 1 ? 'D-' + diff : '';
  }
  function ended(el, t) {
    var e = dayNum(el.dataset.end);
    return e !== null && e < t;
  }
  function applyDates(root, today) {
    today = today || todayKST();
    var t = dayNum(today);
    if (t === null) return;
    root.querySelectorAll('[data-today-label]').forEach(function (el) { el.textContent = fmtDate(today) + ' 기준'; });
    root.querySelectorAll('.dday[data-start]').forEach(function (el) {
      var label = ddayLabel(el.dataset.start, el.dataset.end, today);
      if (label === null) return;
      el.textContent = label;
      el.classList.toggle('today', label === '오늘' || label === '내일' || label === '진행 중');
    });
    // 홈 다가올 일정: 끝난 일정은 숨기고, 남은 것 가운데 앞의 n 개만 보인다
    root.querySelectorAll('[data-up-list]').forEach(function (list) {
      var limit = parseInt(list.dataset.limit || '5', 10), shown = 0;
      list.querySelectorAll('.up-item[data-end]').forEach(function (li) {
        li.hidden = ended(li, t) || shown >= limit;
        li.classList.toggle('up-first', !li.hidden && shown === 0);
        if (!li.hidden) shown++;
      });
      var empty = list.parentNode.querySelector('[data-up-empty]');
      if (empty) empty.hidden = shown > 0;
    });
    // 일정 '예정된 일정' 탭: 게시 뒤에 끝난 일정을 숨기고 탭의 개수를 고친다
    root.querySelectorAll('[data-sched-when="upcoming"]').forEach(function (tabs) {
      var scope = tabs.closest('main') || root, left = 0, total = 0;
      scope.querySelectorAll('.sched-month').forEach(function (sec) {
        var first = true;
        sec.querySelectorAll('.sched-item[data-end]').forEach(function (li) {
          total++;
          li.hidden = ended(li, t);
          li.classList.toggle('sched-first', !li.hidden && first);
          if (!li.hidden) { left++; first = false; }
        });
        sec.hidden = first;                  // 그 달 일정이 모두 끝났으면 달 카드째로 숨김
      });
      var n = tabs.querySelector('[data-when-tab="upcoming"] small');
      if (n && total) n.textContent = left;
      var empty = scope.querySelector('[data-sched-empty]');
      if (empty) empty.hidden = !(total && !left);
    });
  }
  window.superstarsApplyDates = function (today) { applyDates(document, today); };

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);   // iOS 사파리
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error('copy failed'));
    });
  }   // 다른 날짜로 확인할 때 쓰는 도우미

  // ---- 떠 있는 말풍선: [data-tip] 에 마우스를 올리면 보이고(떼면 닫힘), 누르면 고정(다른 곳을 누르거나 Esc 로 닫힘).
  // 내용은 그 안의 숨은 [data-tip-body]. 표가 가로 스크롤 상자 안에 있어 잘리지 않도록 body 에 붙인 고정 위치 상자 하나를 쓴다
  var tip = { box: null, el: null, pinned: false, timer: null };
  function tipBox() {
    if (!tip.box) {
      tip.box = document.createElement('div');
      tip.box.className = 'float-tip';
      tip.box.hidden = true;
      tip.box.addEventListener('mouseenter', function () { clearTimeout(tip.timer); });   // 말풍선 안으로 옮겨 가 스크롤할 수 있게
      tip.box.addEventListener('mouseleave', function () { if (!tip.pinned) hideTipSoon(); });
      document.body.appendChild(tip.box);
    }
    return tip.box;
  }
  function placeTip() {
    var box = tip.box, r = tip.el.getBoundingClientRect(), gap = 6, edge = 8;
    var vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight;
    var w = box.offsetWidth, h = box.offsetHeight;
    var top = r.bottom + gap;
    if (top + h > vh - edge && r.top - gap - h >= edge) top = r.top - gap - h;   // 아래 자리가 모자라면 위로
    box.style.left = Math.max(edge, Math.min(r.left, vw - w - edge)) + 'px';
    box.style.top = Math.max(edge, Math.min(top, vh - h - edge)) + 'px';
  }
  function showTip(el, pin) {
    var body = el.querySelector('[data-tip-body]');
    if (!body) return;
    clearTimeout(tip.timer);
    if (tip.el && tip.el !== el) tip.el.classList.remove('tip-open');
    var box = tipBox();
    box.innerHTML = body.innerHTML;
    box.hidden = false;
    box.scrollTop = 0;
    tip.el = el;
    tip.pinned = !!pin;
    el.classList.toggle('tip-open', tip.pinned);
    placeTip();
  }
  function hideTip() {
    clearTimeout(tip.timer);
    if (tip.el) tip.el.classList.remove('tip-open');
    if (tip.box) tip.box.hidden = true;
    tip.el = null;
    tip.pinned = false;
  }
  function hideTipSoon() { clearTimeout(tip.timer); tip.timer = setTimeout(hideTip, 150); }
  function bindTip(el) {
    el.addEventListener('mouseenter', function () { if (!tip.pinned) showTip(el, false); });
    el.addEventListener('mouseleave', function () { if (!tip.pinned && tip.el === el) hideTipSoon(); });
    el.addEventListener('focus', function () { if (!tip.pinned) showTip(el, false); });
    el.addEventListener('blur', function () { if (!tip.pinned && tip.el === el) hideTip(); });
    el.addEventListener('click', function () { if (tip.el === el && tip.pinned) hideTip(); else showTip(el, true); });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (tip.el === el && tip.pinned) hideTip(); else showTip(el, true); }
    });
  }
  document.addEventListener('click', function (e) {
    if (tip.el && !tip.el.contains(e.target) && !(tip.box && tip.box.contains(e.target))) hideTip();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && tip.el) hideTip(); });
  window.addEventListener('scroll', function () { if (tip.el) placeTip(); }, true);   // 표 상자 가로 스크롤도 따라간다
  window.addEventListener('resize', function () { if (tip.el) placeTip(); });

  // ---- 기록 비교: 고른 시즌·리그(비교 대상)의 같은 선수 기록과 견줘 칸마다 증감(▲▼)을 붙인다.
  // 값은 그 시즌의 compare.json(통합·리그별 선수 기록)에서 받아 온다. 고른 대상은 이 탭에 남겨 다른 시즌·리그 화면에서도 이어 쓴다.
  // 관리자 전용 기능: 비교 칸(.compare-box)은 서버 모드는 로그인한 역할에게만, 정적 사이트는 showAdminBits 가 로그인한 브라우저에서만 보인다
  var RATE3 = ['avg', 'obp', 'slg', 'ops', 'wpct'], RATE2 = ['era', 'whip', 'bbk'];
  var compareCache = {};
  function loadCompare(url) {
    if (!compareCache[url]) {
      compareCache[url] = fetch(url, { credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .catch(function (e) { delete compareCache[url]; throw e; });
    }
    return compareCache[url];
  }
  function fmtStat(key, v) {                 // stats.fmt_stat 과 같은 모양
    if (v === null || v === undefined) return '-';
    if (RATE3.indexOf(key) !== -1) return Number(v).toFixed(3);
    if (RATE2.indexOf(key) !== -1) return Number(v).toFixed(2);
    if (key === 'sb_pct') return Math.round(v * 100) + '%';
    if (key === 'ip') return Math.floor(v / 3) + '.' + (v % 3);
    return String(Number.isInteger(v) ? v : +Number(v).toFixed(2));
  }
  function roundDelta(key, d) {              // 화면 자릿수로 맞춰 0.1+0.2 같은 찌꺼기를 없앤다
    var digits = RATE3.indexOf(key) !== -1 ? 3 : (RATE2.indexOf(key) !== -1 || key === 'sb_pct' ? 2 : (key === 'ip' ? 0 : 2));
    var r = Number(d.toFixed(digits));
    return r === 0 ? 0 : r;
  }
  function fmtDelta(key, d) {
    if (!d) return '±0';
    var a = Math.abs(d), s;
    if (RATE3.indexOf(key) !== -1) s = a.toFixed(3);
    else if (RATE2.indexOf(key) !== -1) s = a.toFixed(2);
    else if (key === 'sb_pct') s = Math.round(a * 100) + '%p';
    else if (key === 'ip') s = Math.floor(a / 3) + '.' + (a % 3);
    else s = String(+a.toFixed(2));
    return (d > 0 ? '▲' : '▼') + s;
  }
  function deltaTone(better, d) {            // better: up 늘면 좋음 / down 줄면 좋음 / '' 좋고 나쁨 없음
    if (!d) return 'flat';
    if (!better) return 'neutral';
    return (d > 0) === (better === 'up') ? 'good' : 'bad';
  }
  function bindCompare(root, sel) {
    var table = root.querySelector('table.stat-table');
    var note = root.querySelector('[data-compare-note]');
    if (!table || !note) return;
    var box = sel.closest('.compare-box');
    if (box && box.hidden) return;              // 관리자 전용: 로그인하지 않은 브라우저에서는 이 탭에 남은 비교도 되살리지 않는다
    var text = note.querySelector('[data-compare-text]'), sortBox = note.querySelector('[data-compare-sort]');
    var urls = {};
    try { urls = JSON.parse(sel.dataset.compareUrls || '{}'); } catch (e) { return; }
    var cols = Array.prototype.map.call(table.tHead.rows[0].cells, function (th) {
      return th.dataset.col ? { key: th.dataset.col, better: th.dataset.better || '' } : null;
    });
    var rows = Array.prototype.slice.call(table.querySelectorAll('tbody tr[data-player]'));
    var KEY = 'superstars-records-compare', seq = 0;

    function clear() {
      rows.forEach(function (tr) {
        Array.prototype.forEach.call(tr.cells, function (td) {
          var d = td.querySelector('.delta');
          if (d) td.removeChild(d);
          if (td.dataset.delta !== undefined) delete td.dataset.delta;
          if (td.hasAttribute('data-cmp')) { td.removeAttribute('title'); td.removeAttribute('data-cmp'); }
        });
        var tag = tr.querySelector('.tag-cmp');
        if (tag) tag.parentNode.removeChild(tag);
      });
    }
    function apply(label, data) {
      clear();
      rows.forEach(function (tr) {
        var other = data[(tr.dataset.player || '').trim()];
        if (!other) {
          var tag = document.createElement('span');
          tag.className = 'tag-cmp';
          tag.textContent = '비교 기록 없음';
          tr.cells[1].appendChild(tag);
          return;
        }
        cols.forEach(function (c, i) {
          var td = c && tr.cells[i], theirs = c ? other[c.key] : null;
          if (!td || theirs === undefined || theirs === null) return;
          td.setAttribute('data-cmp', '');
          td.title = label + ': ' + fmtStat(c.key, theirs);
          var mine = td.dataset.value === '' || td.dataset.value === undefined ? null : parseFloat(td.dataset.value);
          if (mine === null || isNaN(mine)) return;
          var d = roundDelta(c.key, mine - theirs);
          td.dataset.delta = String(d);
          var s = document.createElement('small');
          s.className = 'delta ' + deltaTone(c.better, d);
          s.textContent = fmtDelta(c.key, d);
          td.appendChild(s);
        });
      });
      text.textContent = '';                  // 안내 글은 불러오는 중·실패할 때만
    }
    function choose(save) {
      var v = sel.value, my = ++seq;
      if (save) { try { if (v) sessionStorage.setItem(KEY, v); else sessionStorage.removeItem(KEY); } catch (e) { /* 무시 */ } }
      if (!v) {
        clear();
        note.hidden = true;
        if (sortBox.checked) { sortBox.checked = false; table.classList.remove('sort-delta'); table.superstarsResort(); }
        return;
      }
      var i = v.indexOf(':'), season = v.slice(0, i), unit = v.slice(i + 1);
      var label = sel.options[sel.selectedIndex].textContent.trim();
      note.hidden = false;
      text.textContent = label + ' 기록을 불러오는 중…';
      loadCompare(urls[season]).then(function (d) {
        if (my !== seq) return;               // 그 사이 다른 대상을 고름
        apply(label, (d && d.units && d.units[unit]) || {});
        if (table.classList.contains('sort-delta')) table.superstarsResort();
      }, function () {
        if (my !== seq) return;
        clear();
        text.textContent = '비교 기록을 불러오지 못했습니다. 잠시 뒤 다시 골라 보세요.';
      });
    }
    sel.addEventListener('change', function () { choose(true); });
    sortBox.addEventListener('change', function () {
      table.classList.toggle('sort-delta', sortBox.checked);
      table.superstarsResort();
    });
    var saved = null;
    try { saved = sessionStorage.getItem(KEY); } catch (e) { /* 무시 */ }
    if (saved && Array.prototype.some.call(sel.options, function (o) { return o.value === saved; })) {
      sel.value = saved;
      choose(false);
    }
  }

  // ---- 정적 사이트: 관리 화면에 로그인한 브라우저에서만 [data-admin-perm] 링크·버튼을 보인다.
  // 로그인 표(관리 화면이 이 사이트 localStorage 에 둔 것)의 앞부분에 역할(r)과 만료 시각(e)이 들어 있다. 서명 확인은 하지 않는다:
  // 여기서는 보이기만 하고, 실제 저장은 관리 화면이 중계(Worker)에서 표를 다시 확인한다
  function adminPerms() {
    var el = document.getElementById('adminPerms'), tok = null;
    if (!el) return null;
    try { tok = localStorage.getItem('superstars.adminToken'); } catch (e) { return null; }
    if (!tok) return null;
    try {
      var b = tok.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
      var p = JSON.parse(atob(b + '==='.slice((b.length + 3) % 4)));
      if (!p || !p.r || !(p.e > Date.now() / 1000)) return null;     // 만료된 표
      return JSON.parse(el.textContent)[p.r] || null;
    } catch (e) { return null; }
  }
  function showAdminBits(root) {
    var perms = adminPerms();
    root.querySelectorAll('[data-admin-perm]').forEach(function (el) {
      var need = el.dataset.adminPerm;
      el.hidden = !(perms && (need === 'any' || perms.indexOf(need) !== -1));
    });
  }

  function init(root) {
    root = root || document;
    applyDates(root);
    showAdminBits(root);
    hideTip();                                  // 정적 사이트에서 내용을 바꿔 끼울 때 예전 말풍선은 닫는다
    root.querySelectorAll('[data-tip]').forEach(bindTip);

    // 기록 표 정렬: th[data-sort="num|text"] 클릭. 규정 충족/미충족 그룹(tbody)은 유지하고 각 그룹 안에서만 정렬
    // 기록 비교 중 '증감 크기로 정렬'을 켜면(table.sort-delta) 숫자 열은 칸의 값 대신 증감(data-delta)으로 정렬한다
    root.querySelectorAll('table.sortable').forEach(function (table) {
      var ths = table.querySelectorAll('th[data-sort]');
      function sortBy(th, dir) {
        var type = th.dataset.sort;
        var col = Array.prototype.indexOf.call(th.parentNode.children, th);
        var field = type === 'num' && table.classList.contains('sort-delta') ? 'delta' : 'value';
        ths.forEach(function (t) { t.classList.remove('asc', 'desc'); });
        th.classList.add(dir);
        function num(td) { var v = td.dataset[field]; return v === undefined || v === '' ? null : parseFloat(v); }
        function compare(a, b) {
          var ca = a.cells[col], cb = b.cells[col];
          if (type === 'num') {
            var va = num(ca), vb = num(cb);
            if (va === null && vb === null) return 0;
            if (va === null) return 1;      // 값 없는 선수는 항상 아래로
            if (vb === null) return -1;
            return dir === 'desc' ? vb - va : va - vb;
          }
          var ta = ca.textContent.trim(), tb = cb.textContent.trim();
          return dir === 'desc' ? tb.localeCompare(ta, 'ko') : ta.localeCompare(tb, 'ko');
        }
        var n = 0;
        Array.prototype.forEach.call(table.tBodies, function (tbody) {
          if (!tbody.classList.contains('sortable-body')) return;
          var rows = Array.prototype.slice.call(tbody.rows);
          rows.sort(compare);
          rows.forEach(function (r) {
            tbody.appendChild(r);
            var rk = r.querySelector('td.rank');
            if (rk) rk.textContent = ++n;
          });
        });
      }
      table.superstarsResort = function () {         // 지금 정렬된 열을 같은 방향으로 다시 (증감 정렬을 켜고 끌 때)
        var th = table.querySelector('th.asc, th.desc');
        if (th) sortBy(th, th.classList.contains('asc') ? 'asc' : 'desc');
      };
      ths.forEach(function (th) {
        th.addEventListener('click', function () { sortBy(th, th.classList.contains('desc') ? 'asc' : 'desc'); });
      });
    });

    root.querySelectorAll('select[data-compare]').forEach(function (sel) { bindCompare(root, sel); });

    // 정적 사이트: 시즌·보기 같은 select 는 고른 페이지로 이동
    root.querySelectorAll('select[data-nav]').forEach(function (sel) {
      sel.addEventListener('change', function () { navigateTo(sel.value); });
    });
    // 정적 사이트: 규정 미충족 토글은 반대 상태의 페이지로 이동
    root.querySelectorAll('input[data-nav-url]').forEach(function (box) {
      box.addEventListener('change', function () { navigateTo(box.dataset.navUrl); });
    });
    // 정적 사이트: 통합 기록의 리그 체크박스를 바꾸면 해당 조합으로 미리 만들어 둔 페이지로 이동
    root.querySelectorAll('[data-subset-base]').forEach(function (box) {
      var boxes = Array.prototype.slice.call(box.querySelectorAll('input[type=checkbox][data-id]'));
      var all = boxes.map(function (c) { return Number(c.dataset.id); });
      box.addEventListener('change', function () {
        var ids = boxes.filter(function (c) { return c.checked; }).map(function (c) { return Number(c.dataset.id); });
        if (!ids.length) ids = all;
        ids.sort(function (a, b) { return a - b; });
        navigateTo(box.dataset.subsetBase.replace('{ids}', ids.join('_')));
      });
    });

    // 팀 일정 종류가 '경기'일 때만 상대팀·점수 입력란을 보여준다 (관리자)
    root.querySelectorAll('select[data-toggle-kind]').forEach(function (sel) {
      var target = document.querySelector(sel.dataset.target);
      if (!target) return;
      var apply = function () { target.hidden = sel.value !== sel.dataset.toggleKind; };
      sel.addEventListener('change', apply);
      apply();
    });

    // 팀 일정 폼: 시작 날짜를 고르면 종료 날짜를 같은 날로 맞춘다. 따로 바꿔 둔 종료 날짜는 유지 (관리자)
    root.querySelectorAll('input[data-sync-end]').forEach(function (start) {
      var scope = start.form || root;
      var end = scope.querySelector('input[name="' + start.dataset.syncEnd + '"]');
      if (!end) return;
      var prev = start.value;
      if (start.value) end.min = start.value;
      start.addEventListener('change', function () {
        if (!end.value || end.value === prev || (start.value && end.value < start.value)) end.value = start.value;
        if (start.value) end.min = start.value; else end.removeAttribute('min');
        prev = start.value;
      });
    });

    // 선수단: 가입 리그 체크박스로 표의 행을 거른다. 여러 개 체크하면 전부 가입한 선수만(AND), 모두 해제 = 전체. 선택은 탭 안에서 기억
    root.querySelectorAll('[data-roster-filter]').forEach(function (box) {
      var card = box.closest('.card') || root;
      var table = card.querySelector('table.roster-table');
      if (!table) return;
      var boxes = Array.prototype.slice.call(box.querySelectorAll('input[type=checkbox][data-league-filter]'));
      var rows = Array.prototype.slice.call(table.querySelectorAll('tbody tr'));
      var counter = card.querySelector('[data-roster-count]');
      var empty = card.querySelector('[data-roster-empty]');
      var KEY = 'superstars-roster-leagues';
      try {
        var saved = JSON.parse(sessionStorage.getItem(KEY) || '[]');
        boxes.forEach(function (c) { if (saved.indexOf(c.value) !== -1) c.checked = true; });
      } catch (e) { /* 저장소를 못 쓰면 그냥 전체 */ }
      var apply = function () {
        var sel = boxes.filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
        var shown = 0;
        rows.forEach(function (tr) {
          var mine = (tr.dataset.leagues || '').split(',').filter(Boolean);
          var ok = !sel.length || sel.every(function (id) { return mine.indexOf(id) !== -1; });   // AND: 체크한 리그 전부에 가입
          tr.hidden = !ok;
          if (ok) shown++;
        });
        if (counter) counter.textContent = sel.length ? shown + '명 / 전체 ' + rows.length + '명' : rows.length + '명';
        if (empty) empty.hidden = shown > 0;
        try { sessionStorage.setItem(KEY, JSON.stringify(sel)); } catch (e) { /* 무시 */ }
      };
      box.addEventListener('change', apply);
      apply();
    });

    // 상대팀별 전적: 팀명 검색. 띄어쓰기·기호·대소문자는 무시하고 이름(다른 표기 포함)의 일부만 맞아도 보인다.
    // 시즌·종류를 바꿔도 같은 팀을 계속 볼 수 있게 이 탭(sessionStorage)에 검색어를 남긴다
    root.querySelectorAll('input[data-opp-search]').forEach(function (input) {
      var card = input.closest('.card') || root;
      var rows = Array.prototype.slice.call(card.querySelectorAll('tr[data-opp-name]'));
      var counter = card.querySelector('[data-opp-count]');
      var empty = card.querySelector('[data-opp-empty]');
      var wrap = card.querySelector('.table-wrap');
      var KEY = 'superstars-opp-search';
      var norm = function (s) { return String(s || '').replace(/[\s\-_'’"()]+/g, '').toLowerCase(); };   // stats.norm_team 과 같은 규칙
      var keys = rows.map(function (tr) { return tr.dataset.oppName.split('|').map(norm); });
      input.hidden = false;
      try { input.value = sessionStorage.getItem(KEY) || ''; } catch (e) { /* 저장소를 못 쓰면 빈 칸 */ }
      var apply = function () {
        var q = norm(input.value), shown = 0;
        rows.forEach(function (tr, i) {
          var ok = !q || keys[i].some(function (k) { return k.indexOf(q) !== -1; });
          tr.hidden = !ok;
          if (ok) shown++;
        });
        if (counter) counter.textContent = q ? shown + '팀 / 전체 ' + rows.length + '팀' : rows.length + '팀';
        if (empty) empty.hidden = shown > 0;
        if (wrap) wrap.hidden = shown === 0;
        try { if (q) sessionStorage.setItem(KEY, input.value); else sessionStorage.removeItem(KEY); } catch (e) { /* 무시 */ }
      };
      input.addEventListener('input', apply);
      input.addEventListener('keydown', function (e) { if (e.key === 'Escape' && input.value) { input.value = ''; apply(); } });
      apply();
    });

    // 표 전체를 한 번에 저장하는 폼(선수 명부): 고친 뒤 저장 없이 떠나려 하면 경고 (관리자)
    root.querySelectorAll('form[data-dirty-guard]').forEach(function (f) {
      var dirty = false;
      f.addEventListener('input', function () { dirty = true; });
      f.addEventListener('change', function () { dirty = true; });
      f.addEventListener('submit', function () { dirty = false; });
      window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
    });
    // formaction 으로 다른 주소에 보내는 버튼의 확인창 (예: 명부의 삭제)
    root.querySelectorAll('button[data-confirm]').forEach(function (b) {
      b.addEventListener('click', function (e) { if (!window.confirm(b.dataset.confirm)) e.preventDefault(); });
    });

    // 참불투표 제목 복사 (관리자 일정 화면). 파이는 http 주소라 navigator.clipboard 가 막히므로 예전 방식으로도 시도한다
    root.querySelectorAll('button[data-copy]').forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', function () {
        var text = btn.dataset.copy, label = btn.textContent;
        copyText(text).then(function () {
          btn.textContent = '복사됨 ✓';
          btn.classList.add('copied');
          setTimeout(function () { btn.textContent = label; btn.classList.remove('copied'); }, 1500);
        }, function () {
          window.prompt('자동 복사가 안 되는 환경입니다. 아래 글을 복사해 쓰세요.', text);
        });
      });
    });

    // 선수 통산 기록: 연도 줄을 누르면 그 해의 리그별 기록을 펼치고 접는다
    root.querySelectorAll('tr[data-season-toggle]').forEach(function (tr) {
      var btn = tr.querySelector('.season-btn');
      var subs = tr.parentNode.querySelectorAll('tr[data-season-of="' + tr.dataset.seasonToggle + '"]');
      tr.addEventListener('click', function () {
        var open = !tr.classList.contains('open');
        tr.classList.toggle('open', open);
        if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        Array.prototype.forEach.call(subs, function (s) { s.hidden = !open; });
      });
    });

    // 삭제 등 확인이 필요한 폼 (관리자)
    root.querySelectorAll('form[data-confirm]').forEach(function (f) {
      f.addEventListener('submit', function (e) {
        if (!window.confirm(f.dataset.confirm)) e.preventDefault();
      });
    });

    // 동기화 진행 중이면 상태를 폴링하다가 끝나면 새로고침 (관리자)
    var poll = root.querySelector('[data-sync-poll]');
    if (poll && !poll.dataset.polling && !window.superstarsRemote) {     // GitHub 관리 화면은 껍데기가 따로 새로 받는다
      poll.dataset.polling = '1';
      var base = poll.dataset.base || '';
      var timer = setInterval(function () {
        fetch(base + '/api/status', { cache: 'no-store' })
          .then(function (r) { return r.json(); })
          .then(function (s) {
            if (!s.running) { clearInterval(timer); location.reload(); }
            else { poll.textContent = '동기화 진행 중… ' + (s.current || ''); }
          })
          .catch(function () {});
      }, 4000);
    }
  }

  // ---- 정적 사이트 껍데기: 링크를 누르면 미리 만든 페이지를 가져와 본문만 바꾸고 주소창은 루트(/superstars/)에 고정
  if (STATIC) {
    var KEY = 'superstars.view';

    function remember(url) { try { sessionStorage.setItem(KEY, url); } catch (e) {} }

    function swap(doc) {
      document.title = doc.title;
      ['.topbar', 'main', 'footer'].forEach(function (sel) {
        var fresh = doc.querySelector(sel), cur = document.querySelector(sel);
        if (fresh && cur) cur.replaceWith(fresh);
      });
      init(document);
      window.scrollTo(0, 0);
    }

    function load(url, push) {
      fetch(url, { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (html) {
          swap(new DOMParser().parseFromString(html, 'text/html'));
          remember(url);
          if (push) history.pushState({ url: url }, '', ROOT);
        })
        .catch(function () { location.href = url; });   // 가져오기에 실패하면 그냥 그 주소로 이동
    }
    window.__superstarsLoad = load;

    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest ? e.target.closest('a[href]') : null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#') return;
      var u = new URL(a.href, location.href);
      if (u.origin !== location.origin || u.pathname.indexOf(ROOT) !== 0 || /\.(ics|pdf|zip|png|jpg)$/i.test(u.pathname)) return;
      if (u.pathname.indexOf(ROOT + 'admin') === 0) return;      // 관리 화면은 껍데기 페이지로 그냥 이동
      e.preventDefault();
      load(u.pathname + u.search, true);
    });

    window.addEventListener('popstate', function (e) {
      load((e.state && e.state.url) || ROOT, false);
    });

    // 첫 진입: 하위 주소로 직접 들어왔으면 주소창만 루트로 바꾸고, 루트로 들어왔는데 직전 화면이 기억돼 있으면 복원
    var here = location.pathname + location.search;
    if (location.pathname !== ROOT) {
      remember(here);
      history.replaceState({ url: here }, '', ROOT);
    } else {
      var saved = null;
      try { saved = sessionStorage.getItem(KEY); } catch (e) {}
      history.replaceState({ url: saved || ROOT }, '', ROOT);
      if (saved && saved !== ROOT) load(saved, false);
    }
  }

  window.superstarsInit = init;     // GitHub 관리 화면 껍데기가 받아 넣은 화면에도 같은 동작을 붙인다
  init(document);
})();
