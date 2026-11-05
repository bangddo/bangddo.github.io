// 라인업 짜보기 (관리자). 참석자 → 1~9번 포지션·선수 선택(이미 고른 항목은 다른 칸에서 빠짐) → 남는 인원은 대기,
// 손잡이로 끌어 타순을 바꾸고, 선발 9명의 타율·출루율·장타율을 꺾은선으로, "라인업 복사"로 메신저용 글을 클립보드에.
// 서버에 저장하지 않고 이 브라우저(localStorage)에만 임시로 남긴다.
(function () {
  var root = document.querySelector('[data-lineup]');
  var dataEl = document.getElementById('lineupData');
  if (!root || !dataEl) return;

  var DATA = JSON.parse(dataEl.textContent);
  var KEY = 'superstars.lineup';
  var SLOTS = 9;
  var SERIES = [{ key: 'avg', label: '타율', cls: 's1' }, { key: 'obp', label: '출루율', cls: 's2' }, { key: 'slg', label: '장타율', cls: 's3' }];
  var SVGNS = 'http://www.w3.org/2000/svg';

  var POS = {}, ROSTER = {}, SETS = {};
  DATA.positions.forEach(function (p) { POS[p.code] = p; });
  DATA.players.forEach(function (p) { ROSTER[p.name] = p; });
  DATA.sets.forEach(function (s) { SETS[s.key] = s; });

  var state = { attendees: '', set: DATA.sets.length ? DATA.sets[0].key : '', slots: [] };
  for (var i = 0; i < SLOTS; i++) state.slots.push({ pos: '', name: '' });
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) {
      state.attendees = typeof saved.attendees === 'string' ? saved.attendees : '';
      if (SETS[saved.set]) state.set = saved.set;
      (saved.slots || []).slice(0, SLOTS).forEach(function (s, i) {
        state.slots[i] = { pos: POS[s && s.pos] ? s.pos : '', name: (s && typeof s.name === 'string') ? s.name : '' };
      });
    }
  } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  var area = root.querySelector('[data-attendees]');
  var setSel = root.querySelector('[data-stat-set]');
  var rows = Array.prototype.slice.call(root.querySelectorAll('tr[data-slot]'));
  area.value = state.attendees;
  setSel.value = state.set;

  // '1. 홍길동', '- 홍길동', '홍길동(17)' 처럼 붙여 넣어도 이름만
  function cleanName(line) {
    return line.replace(/^\s*(?:\d+\s*[.)]|[-•*·])\s*/, '').replace(/\s*\(\s*#?\d+\s*\)\s*$/, '').replace(/\s+/g, ' ').trim();
  }
  function attendees() {
    var seen = {}, out = [];
    state.attendees.split(/\r?\n/).forEach(function (l) {
      var n = cleanName(l);
      if (n && !seen[n]) { seen[n] = true; out.push(n); }
    });
    return out;
  }
  function statOf(name) {
    var s = SETS[state.set];
    return (s && name && s.stats[name]) || null;
  }
  function knownName(name) {
    return !!ROSTER[name] || DATA.sets.some(function (s) { return !!s.stats[name]; });
  }
  function fmtRate(v) {
    if (v === null || v === undefined) return '-';
    var t = Number(v).toFixed(3);
    return v < 1 ? t.replace(/^0/, '') : t;
  }
  function playerLabel(name) {
    var p = ROSTER[name], label = name;
    if (p && p.no) label += ' #' + p.no;
    if (p && p.pos.length) label += ' (' + p.pos.map(function (c) { return POS[c] ? POS[c].short : c; }).join('·') + ')';
    return label;
  }
  function fillSelect(sel, items, current, placeholder) {
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    var first = document.createElement('option');
    first.value = ''; first.textContent = placeholder;
    sel.appendChild(first);
    items.forEach(function (it) {
      var o = document.createElement('option');
      o.value = it.value; o.textContent = it.label;
      sel.appendChild(o);
    });
    sel.value = current;
  }
  function setText(el, text) { if (el) el.textContent = text; }
  function benchOf(names) {                                 // 참석자 중 타순에 없는 사람
    var inLineup = state.slots.map(function (s) { return s.name; });
    return names.filter(function (n) { return inLineup.indexOf(n) === -1; });
  }

  function render() {
    var names = attendees();
    state.slots.forEach(function (s) { if (s.name && names.indexOf(s.name) === -1) s.name = ''; });   // 참석자에서 빠진 선수는 타순에서도 뺀다

    setText(root.querySelector('[data-att-count]'), names.length + '명');
    var unknown = names.filter(function (n) { return !knownName(n); });
    var unk = root.querySelector('[data-att-unknown]');
    unk.hidden = !unknown.length;
    unk.textContent = unknown.length ? '명부와 기록에 없는 이름(오타인지 확인): ' + unknown.join(', ') : '';

    rows.forEach(function (tr, i) {
      var slot = state.slots[i];
      var usedPos = state.slots.filter(function (s, j) { return j !== i && s.pos; }).map(function (s) { return s.pos; });
      var usedName = state.slots.filter(function (s, j) { return j !== i && s.name; }).map(function (s) { return s.name; });
      fillSelect(tr.querySelector('[data-pos]'),
        DATA.positions.filter(function (p) { return usedPos.indexOf(p.code) === -1; }).map(function (p) { return { value: p.code, label: p.name }; }),
        slot.pos, '포지션');
      fillSelect(tr.querySelector('[data-player]'),
        names.filter(function (n) { return usedName.indexOf(n) === -1; }).map(function (n) { return { value: n, label: playerLabel(n) }; }),
        slot.name, names.length ? '선수' : '참석자를 먼저 입력');
      var st = statOf(slot.name);
      SERIES.forEach(function (se) { setText(tr.querySelector('[data-stat="' + se.key + '"]'), st ? fmtRate(st[se.key]) : '-'); });
      setText(tr.querySelector('[data-stat="pa"]'), slot.name ? (st ? String(st.pa || 0) : '기록 없음') : '-');
    });

    var bench = benchOf(names);
    setText(root.querySelector('[data-bench-count]'), bench.length + '명');
    copy.box.hidden = true;                                 // 바뀐 뒤에는 예전 복사 글을 감춘다
    var box = root.querySelector('[data-bench]');
    while (box.firstChild) box.removeChild(box.firstChild);
    if (!bench.length) {
      var none = document.createElement('span');
      none.className = 'muted small';
      none.textContent = names.length ? '대기 선수가 없습니다.' : '참석자를 입력하면 라인업에 들지 않은 선수가 여기에 나옵니다.';
      box.appendChild(none);
    }
    bench.forEach(function (n) {
      var chip = document.createElement('span'), st = statOf(n);
      chip.className = 'bench-chip';
      chip.appendChild(document.createTextNode(playerLabel(n)));
      var small = document.createElement('small');
      small.textContent = st ? fmtRate(st.avg) + ' / ' + fmtRate(st.obp) + ' / ' + fmtRate(st.slg) : '기록 없음';
      chip.appendChild(small);
      box.appendChild(chip);
    });

    setText(root.querySelector('[data-chart-set]'), SETS[state.set] ? SETS[state.set].label : '');
    drawChart();
    save();
  }

  // ---- 꺾은선 그래프 (SVG). 가로: 타순 1~9, 세로: 타율·출루율·장타율 한 축. 기록 없는 칸은 선을 끊는다.
  var chart = { box: root.querySelector('[data-chart-box]'), tip: root.querySelector('[data-chart-tip]') };

  function svg(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function drawChart() {
    var box = chart.box;
    while (box.firstChild) box.removeChild(box.firstChild);
    chart.tip.hidden = true;
    var W = Math.max(box.clientWidth || 0, 300), H = 260;
    var m = { l: 40, r: 12, t: 12, b: 44 };
    var pw = W - m.l - m.r, ph = H - m.t - m.b;
    var pts = state.slots.map(function (s) { return statOf(s.name); });
    var max = 0;
    pts.forEach(function (p) { if (p) SERIES.forEach(function (se) { if (p[se.key] != null) max = Math.max(max, p[se.key]); }); });
    var step = max > 1 ? 0.2 : 0.1;
    var yMax = Math.max(0.5, Math.ceil(max / step - 1e-9) * step);
    if (yMax - max < step * 0.25) yMax += step;            // 맨 위 값이 틀에 붙지 않게
    function x(i) { return m.l + pw * (i + 0.5) / SLOTS; }
    function y(v) { return m.t + ph * (1 - v / yMax); }

    var s = svg('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      'aria-label': '선발 9명 타율·출루율·장타율 꺾은선 그래프' }, box);
    for (var v = 0; v <= yMax + 1e-9; v += step) {
      svg('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), 'class': v === 0 ? 'grid base' : 'grid' }, s);
      var t = svg('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, s);
      t.textContent = v === 0 ? '0' : fmtRate(Math.round(v * 1000) / 1000);
    }
    var narrow = pw / SLOTS < 40;
    state.slots.forEach(function (slot, i) {
      var no = svg('text', { x: x(i), y: H - m.b + 16, 'text-anchor': 'middle', 'class': 'xlab-no' }, s);
      no.textContent = String(i + 1);
      var nm = svg('text', { x: x(i), y: H - m.b + 31, 'text-anchor': 'middle', 'class': narrow ? 'xlab narrow' : 'xlab' }, s);
      var name = slot.name || '-';
      nm.textContent = name.length > 4 ? name.slice(0, 4) + '…' : name;
    });

    var cross = svg('line', { x1: 0, x2: 0, y1: m.t, y2: m.t + ph, 'class': 'crosshair', visibility: 'hidden' }, s);
    SERIES.forEach(function (se) {
      var d = '', pen = false;
      pts.forEach(function (p, i) {
        var val = p ? p[se.key] : null;
        if (val == null) { pen = false; return; }
        d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(val).toFixed(1);
        pen = true;
      });
      if (d) svg('path', { d: d, 'class': 'ln ' + se.cls }, s);
    });
    SERIES.forEach(function (se) {                        // 점은 선 위에 (흰 테두리로 겹쳐도 보이게)
      pts.forEach(function (p, i) {
        var val = p ? p[se.key] : null;
        if (val != null) svg('circle', { cx: x(i), cy: y(val), r: 4, 'class': 'dot ' + se.cls }, s);
      });
    });
    if (!pts.some(function (p) { return p; })) {
      var empty = svg('text', { x: m.l + pw / 2, y: m.t + ph / 2, 'text-anchor': 'middle', 'class': 'empty-note' }, s);
      empty.textContent = '라인업에 선수를 넣으면 그래프가 나옵니다';
    }

    // 십자선 + 말풍선: 포인터에서 가장 가까운 타순을 잡는다
    var hit = svg('rect', { x: m.l, y: m.t, width: pw, height: ph + m.b, fill: 'transparent' }, s);
    function show(ev) {
      var r = s.getBoundingClientRect();
      var px = ev.clientX - r.left;
      var i = Math.max(0, Math.min(SLOTS - 1, Math.floor((px - m.l) / (pw / SLOTS))));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
      cross.setAttribute('visibility', 'visible');
      tipFor(i, x(i), r);
    }
    function hide() { cross.setAttribute('visibility', 'hidden'); chart.tip.hidden = true; }
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', hide);
  }

  function tipFor(i, px, svgRect) {
    var tip = chart.tip, slot = state.slots[i], st = statOf(slot.name);
    while (tip.firstChild) tip.removeChild(tip.firstChild);
    var title = document.createElement('div');
    title.className = 'tip-title';
    title.textContent = (i + 1) + '번' + (slot.pos ? ' · ' + POS[slot.pos].name : '') + (slot.name ? ' · ' + slot.name : ' · 비어 있음');
    tip.appendChild(title);
    if (slot.name && !st) {
      var no = document.createElement('div');
      no.className = 'muted';
      no.textContent = '기록 없음';
      tip.appendChild(no);
    }
    if (st) {
      SERIES.forEach(function (se) {
        var row = document.createElement('div'), key = document.createElement('i'), val = document.createElement('strong');
        row.className = 'tip-row';
        key.className = 'key ' + se.cls;
        val.textContent = fmtRate(st[se.key]);
        row.appendChild(key); row.appendChild(val); row.appendChild(document.createTextNode(se.label));
        tip.appendChild(row);
      });
      var pa = document.createElement('div');
      pa.className = 'muted';
      pa.textContent = '타석 ' + (st.pa || 0);
      tip.appendChild(pa);
    }
    tip.hidden = false;
    var wrap = chart.box.parentNode.getBoundingClientRect();
    var left = svgRect.left - wrap.left + px + 12;
    if (left + tip.offsetWidth > wrap.width) left = svgRect.left - wrap.left + px - tip.offsetWidth - 12;
    tip.style.left = Math.max(0, left) + 'px';
    tip.style.top = (svgRect.top - wrap.top + 16) + 'px';
  }

  // ---- 입력
  area.addEventListener('input', function () { state.attendees = area.value; render(); });
  setSel.addEventListener('change', function () { state.set = setSel.value; render(); });
  rows.forEach(function (tr, i) {
    tr.querySelector('[data-pos]').addEventListener('change', function (e) { state.slots[i].pos = e.target.value; render(); });
    tr.querySelector('[data-player]').addEventListener('change', function (e) { state.slots[i].name = e.target.value; render(); });
  });
  // ---- 타순 옮기기: 손잡이(≡)를 잡고 위아래로 끌면 그 자리로 끼워 넣는다(포지션도 함께). 마우스·터치는 pointer 이벤트, 키보드는 ↑↓
  var drag = null;
  function moveSlot(from, to) {
    if (to < 0 || to >= SLOTS || from === to) return false;
    state.slots.splice(to, 0, state.slots.splice(from, 1)[0]);
    return true;
  }
  function rowAt(y) {
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i].getBoundingClientRect();
      if (y < r.bottom) return i;
    }
    return rows.length - 1;
  }
  function markDrag() {
    rows.forEach(function (tr, j) { tr.classList.toggle('dragging', !!drag && drag.index === j); });
    root.classList.toggle('is-dragging', !!drag);
  }
  rows.forEach(function (tr, i) {
    var h = tr.querySelector('[data-drag]');
    h.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      drag = { index: i, id: e.pointerId };
      if (h.setPointerCapture) h.setPointerCapture(e.pointerId);    // 손가락이 손잡이 밖으로 나가도 계속 받는다
      markDrag();
    });
    h.addEventListener('pointermove', function (e) {
      if (!drag || drag.id !== e.pointerId) return;
      var to = rowAt(e.clientY);
      if (moveSlot(drag.index, to)) { drag.index = to; render(); markDrag(); }
    });
    function end(e) {
      if (!drag || drag.id !== e.pointerId) return;
      drag = null;
      markDrag();
    }
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
    h.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowUp' ? -1 : (e.key === 'ArrowDown' ? 1 : 0);
      if (d && moveSlot(i, i + d)) {
        e.preventDefault();
        render();
        rows[i + d].querySelector('[data-drag]').focus();
      }
    });
  });

  // ---- 복사: "1. 김태균 (LF)" 줄들, 빈 줄, "대기 김선우" 줄들(대기가 없으면 생략).
  // 선수를 고르지 않은 타순은 빼고(번호는 그대로), 두 글자 이름은 "조　민"처럼 가운데 전각 공백으로 세 글자 폭에 맞춘다
  var COPY_POS = { P: 'SP' };                               // 투수는 선발 투수(SP)로
  function copyName(n) { return /^[가-힣]{2}$/.test(n) ? n.charAt(0) + '　' + n.charAt(1) : n; }
  function lineupText() {
    var out = [];
    state.slots.forEach(function (s, i) {
      if (s.name) out.push((i + 1) + '. ' + copyName(s.name) + (s.pos ? ' (' + (COPY_POS[s.pos] || s.pos) + ')' : ''));
    });
    var bench = benchOf(attendees()).map(copyName);
    if (bench.length && out.length) out.push('');
    bench.forEach(function (n) { out.push('대기 ' + n); });
    return out.join('\n');
  }
  var copy = { btn: root.querySelector('[data-lineup-copy]'), msg: root.querySelector('[data-copy-msg]'),
               box: root.querySelector('[data-copy-text]'), timer: null };
  function say(text, stay) {
    if (copy.timer) window.clearTimeout(copy.timer);
    copy.timer = null;
    setText(copy.msg, text);
    if (text && !stay) copy.timer = window.setTimeout(function () { copy.timer = null; setText(copy.msg, ''); }, 4000);
  }
  function oldCopy(text) {                                  // clipboard API 가 없거나 막힌 브라우저
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.left = '0'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = !!document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
  function copied(ok, text) {
    if (ok) { copy.box.hidden = true; say('복사했습니다. 메신저에 붙여 넣으세요.'); return; }
    copy.box.value = text;                                  // 그래도 안 되면 글을 보여 주고 직접 복사하게
    copy.box.rows = Math.min(text.split('\n').length, 16);
    copy.box.hidden = false;
    say('자동 복사가 막혀 있습니다. 아래 글을 직접 복사하세요 (Ctrl+C, 휴대폰은 길게 눌러 복사).', true);
    copy.box.focus();
    copy.box.select();
  }
  copy.btn.addEventListener('click', function () {
    var text = lineupText();
    if (!text) { copy.box.hidden = true; say('복사할 라인업이 없습니다.'); return; }
    var clip = typeof navigator !== 'undefined' && navigator.clipboard;
    if (clip && clip.writeText) {
      clip.writeText(text).then(function () { copied(true, text); }, function () { copied(oldCopy(text), text); });
    } else {
      copied(oldCopy(text), text);
    }
  });

  root.querySelector('[data-lineup-reset]').addEventListener('click', function () {
    state.slots.forEach(function (s) { s.pos = ''; s.name = ''; });
    render();
  });
  var pending = false;
  window.addEventListener('resize', function () {
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(function () { pending = false; drawChart(); });
  });

  render();
})();
