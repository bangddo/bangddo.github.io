(function () {
  var BODY = document.body;
  var STATIC = BODY.dataset.static === '1';           // GitHub Pages 용 정적 사이트인가
  var ROOT = (BODY.dataset.base || '') + '/';

  // 정적 사이트에서는 주소창을 루트에 고정한 채 내용만 바꿔 끼운다(아래 shell). 서버 모드에서는 보통 이동.
  function navigateTo(url) {
    if (STATIC && window.__superstarsLoad) window.__superstarsLoad(url, true);
    else location.href = url;
  }

  function init(root) {
    root = root || document;

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
