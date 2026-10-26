(function () {
  // 기록 표 정렬: th[data-sort="num|text"] 클릭
  document.querySelectorAll('table.sortable').forEach(function (table) {
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
        // 규정 충족/미충족 그룹(tbody)은 유지한 채 각 그룹 안에서만 정렬하고, 순번은 이어서 매긴다
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

  // 정적 사이트: 통합 기록의 리그 체크박스를 바꾸면 해당 조합으로 미리 만들어 둔 페이지로 이동
  document.querySelectorAll('[data-subset-base]').forEach(function (box) {
    var boxes = Array.prototype.slice.call(box.querySelectorAll('input[type=checkbox][data-id]'));
    var all = boxes.map(function (c) { return Number(c.dataset.id); });
    box.addEventListener('change', function () {
      var ids = boxes.filter(function (c) { return c.checked; }).map(function (c) { return Number(c.dataset.id); });
      if (!ids.length) ids = all;
      ids.sort(function (a, b) { return a - b; });
      location.href = box.dataset.subsetBase.replace('{ids}', ids.join('_'));
    });
  });

  // 팀 일정 종류가 '경기'일 때만 상대팀·점수 입력란을 보여준다
  document.querySelectorAll('select[data-toggle-kind]').forEach(function (sel) {
    var target = document.querySelector(sel.dataset.target);
    if (!target) return;
    var apply = function () { target.hidden = sel.value !== sel.dataset.toggleKind; };
    sel.addEventListener('change', apply);
    apply();
  });

  // 삭제 등 확인이 필요한 폼
  document.querySelectorAll('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      if (!window.confirm(f.dataset.confirm)) e.preventDefault();
    });
  });

  // 동기화 진행 중이면 상태를 폴링하다가 끝나면 새로고침
  var poll = document.querySelector('[data-sync-poll]');
  if (poll) {
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
})();
