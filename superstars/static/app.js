(function () {
  var BODY = document.body;
  var STATIC = BODY.dataset.static === '1';           // GitHub Pages 용 정적 사이트인가
  var ROOT = (BODY.dataset.base || '') + '/';

  // 정적 사이트에서는 주소창을 루트에 고정한 채 내용만 바꿔 끼운다(아래 shell). 서버 모드에서는 보통 이동.
  function navigateTo(url) {
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

  function init(root) {
    root = root || document;
    applyDates(root);

    // 기록 표 정렬: th[data-sort="num|text"] 클릭. 규정 충족/미충족 그룹(tbody)은 유지하고 각 그룹 안에서만 정렬
    root.querySelectorAll('table.sortable').forEach(function (table) {
      var ths = table.querySelectorAll('th[data-sort]');
      ths.forEach(function (th) {
        th.addEventListener('click', function () {
          var type = th.dataset.sort;
          var col = Array.prototype.indexOf.call(th.parentNode.children, th);
          var dir = th.classList.contains('desc') ? 'asc' : 'desc';
          ths.forEach(function (t) { t.classList.remove('asc', 'desc'); });
          th.classList.add(dir);
          function compare(a, b) {
            var ca = a.cells[col], cb = b.cells[col];
            if (type === 'num') {
              var va = ca.dataset.value === undefined || ca.dataset.value === '' ? null : parseFloat(ca.dataset.value);
              var vb = cb.dataset.value === undefined || cb.dataset.value === '' ? null : parseFloat(cb.dataset.value);
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
        });
      });
    });

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

    // 삭제 등 확인이 필요한 폼 (관리자)
    root.querySelectorAll('form[data-confirm]').forEach(function (f) {
      f.addEventListener('submit', function (e) {
        if (!window.confirm(f.dataset.confirm)) e.preventDefault();
      });
    });

    // 동기화 진행 중이면 상태를 폴링하다가 끝나면 새로고침 (관리자)
    var poll = root.querySelector('[data-sync-poll]');
    if (poll && !poll.dataset.polling) {
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

  init(document);
})();
