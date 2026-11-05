import { escapeHtml, tallyChoices } from './util.js';

// 한 단계(다음 득표수까지 막대가 올라가는 시간)
const STEP_MS = 1000;
const CONFETTI_COLORS = ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#f72585', '#c77dff', '#ffffff'];

const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

/**
 * 투표 결과 연출 보기.
 *
 * 풀스크린 오버레이에서 모든 항목의 막대가 0부터 동시에 올라가다가 최저 득표수에서 멈춘다.
 * 클릭(또는 Space / Enter / →)할 때마다 다음 득표수까지 올라간다.
 * 멈춘 순간에는 어느 항목이 확정됐는지 드러내지 않고, 다음 클릭으로 연출이 이어질 때
 * 직전 득표수에서 멈춘 항목에 순위 배지를 붙인다 (둘만 남았을 때 2위가 먼저 보이지 않도록).
 * 마지막 단계에서 1위가 확정되면 바로 배지를 붙이고 꽃가루가 터진다.
 *
 * 득표 집계는 호출 시점의 ballots 로 고정된다 (연출 도중 새 투표가 들어와도 반영하지 않음).
 */
export function openRevealScreen(vote, ballots) {
  const items = vote.items ?? [];
  const counts = tallyChoices(items, ballots);
  const thresholds = [...new Set(counts)].sort((a, b) => a - b); // 단계별 목표 득표수 (오름차순)
  const maxCount = Math.max(1, ...counts);

  let step = -1;          // 마지막으로 끝난 단계 (thresholds 인덱스)
  let animating = false;
  let finished = false;
  let closed = false;
  let rafId = null;
  let stopConfetti = null;

  const overlay = document.createElement('div');
  overlay.className = 'reveal';
  overlay.tabIndex = -1;
  overlay.innerHTML = `
    <canvas class="reveal-confetti"></canvas>
    <button type="button" class="reveal-close" aria-label="닫기" title="닫기 (ESC)">✕</button>
    <div class="reveal-inner">
      <div class="reveal-header">
        <h1>${escapeHtml(vote.title)}</h1>
        <p>${ballots.length}명 참여 · ${vote.allowedPhoneHashes?.length ?? 0}명 대상</p>
      </div>
      <div class="reveal-rows" style="--rows:${items.length}">
        ${items.map((label, i) => `
          <div class="reveal-row" data-idx="${i}">
            <div class="reveal-label" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
            <div class="reveal-track"><div class="reveal-fill"></div></div>
            <div class="reveal-count">0</div>
            <div class="reveal-rank"></div>
          </div>
        `).join('')}
      </div>
      <div class="reveal-footer">
        <span class="reveal-hint"></span>
        <button type="button" class="reveal-replay hidden">다시 보기</button>
      </div>
    </div>
  `;

  const rows = [...overlay.querySelectorAll('.reveal-row')].map(row => ({
    row,
    fill: row.querySelector('.reveal-fill'),
    count: row.querySelector('.reveal-count'),
    rank: row.querySelector('.reveal-rank'),
  }));
  const hint = overlay.querySelector('.reveal-hint');
  const closeBtn = overlay.querySelector('.reveal-close');
  const replayBtn = overlay.querySelector('.reveal-replay');
  const canvas = overlay.querySelector('.reveal-confetti');

  function setHint(text) { hint.textContent = text; }

  function paint(i, value) {
    rows[i].fill.style.width = `${(value / maxCount) * 100}%`;
    rows[i].count.textContent = String(Math.round(value));
  }

  function reset() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (stopConfetti) { stopConfetti(); stopConfetti = null; }
    step = -1;
    animating = false;
    finished = false;
    overlay.classList.remove('finished');
    replayBtn.classList.add('hidden');
    rows.forEach(({ row, rank }, i) => {
      row.classList.remove('settled', 'winner');
      rank.innerHTML = '';
      paint(i, 0);
    });
    setHint('화면을 클릭하면 시작합니다');
  }

  function advance() {
    if (closed || animating || finished) return;
    const next = step + 1;
    if (next >= thresholds.length) return;

    const from = step >= 0 ? thresholds[step] : 0;
    const to = thresholds[next];
    const isLast = next === thresholds.length - 1;
    animating = true;
    setHint('');

    // 직전 단계에서 멈춘 항목의 순위는 다음 연출이 시작되는 지금 공개한다.
    if (step >= 0) revealSettled(from, false);

    const start = performance.now();
    const frame = now => {
      if (closed) return;
      const t = Math.min(1, (now - start) / STEP_MS);
      const eased = easeOutCubic(t);
      counts.forEach((c, i) => {
        const target = Math.min(c, to);
        if (target <= from) return; // 이전 단계에서 이미 확정된 항목
        paint(i, from + (target - from) * eased);
      });
      if (t < 1) { rafId = requestAnimationFrame(frame); return; }

      rafId = null;
      step = next;
      animating = false;
      if (isLast) {
        revealSettled(to, true);
        finish();
      } else {
        setHint('클릭하면 다음 순위를 공개합니다');
      }
    };
    rafId = requestAnimationFrame(frame);
  }

  // 득표수가 value 인 항목을 확정 표시한다. 순위 = 더 많이 득표한 항목 수 + 1 (동률은 같은 순위).
  function revealSettled(value, isWinner) {
    const rank = 1 + counts.filter(c => c > value).length;
    counts.forEach((c, i) => {
      if (c !== value) return;
      paint(i, c);
      rows[i].row.classList.add('settled');
      if (isWinner) rows[i].row.classList.add('winner');
      rows[i].rank.innerHTML = `<span>${isWinner ? '🏆 ' : ''}${rank}위</span>`;
    });
  }

  function finish() {
    finished = true;
    overlay.classList.add('finished');
    setHint('ESC 또는 ✕ 를 눌러 닫습니다');
    replayBtn.classList.remove('hidden');
    stopConfetti = fireConfetti(canvas);
  }

  function close() {
    if (closed) return;
    closed = true;
    if (rafId) cancelAnimationFrame(rafId);
    if (stopConfetti) stopConfetti();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    if (document.fullscreenElement === overlay) {
      document.exitFullscreen().catch(() => {});
    }
    overlay.remove();
  }

  function onKey(e) {
    if (e.target === closeBtn || e.target === replayBtn) return; // 버튼은 기본 동작(클릭)에 맡김
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); advance(); }
  }

  function onFullscreenChange() {
    // ESC 등으로 풀스크린이 해제되면 연출도 함께 닫는다.
    if (document.fullscreenElement !== overlay) close();
  }

  overlay.addEventListener('click', advance);
  closeBtn.addEventListener('click', e => { e.stopPropagation(); close(); });
  replayBtn.addEventListener('click', e => { e.stopPropagation(); reset(); });
  document.addEventListener('keydown', onKey);

  reset();
  document.body.appendChild(overlay);
  overlay.focus();

  // 풀스크린은 사용자 제스처(버튼 클릭) 안에서만 요청할 수 있다.
  // 거부되거나 지원하지 않으면 화면을 덮는 고정 오버레이로 그대로 동작한다.
  if (typeof overlay.requestFullscreen === 'function') {
    document.addEventListener('fullscreenchange', onFullscreenChange);
    let request;
    try { request = overlay.requestFullscreen(); } catch (err) { request = Promise.reject(err); }
    Promise.resolve(request).catch(() => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    });
  }

  return { close };
}

// 캔버스 꽃가루. 양쪽 아래에서 위로 터진 뒤 가운데에서 한 번 더 퍼진다. 정지 함수를 돌려준다.
function fireConfetti(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const H = canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  const gravity = H * 0.00028;
  const drag = 0.985;
  const particles = [];

  function burst(x, y, n, angleDeg, spreadDeg, speedScale = 1) {
    for (let i = 0; i < n; i++) {
      const angle = (angleDeg + (Math.random() - 0.5) * spreadDeg) * Math.PI / 180;
      const speed = H * (0.012 + Math.random() * 0.014) * speedScale;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: -Math.sin(angle) * speed,
        w: (6 + Math.random() * 7) * dpr,
        h: (4 + Math.random() * 6) * dpr,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.25,
        wobble: Math.random() * Math.PI * 2,
        wobbleSpeed: 0.08 + Math.random() * 0.1,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        life: 1,
        decay: 0.0035 + Math.random() * 0.005,
      });
    }
  }

  const timers = [
    setTimeout(() => burst(W * 0.5, H * 0.38, 220, 90, 360, 0.7), 350),
    setTimeout(() => { burst(W * 0.2, H * 0.95, 120, 70, 40); burst(W * 0.8, H * 0.95, 120, 110, 40); }, 900),
  ];
  burst(W * 0.08, H * 0.95, 160, 62, 45);
  burst(W * 0.92, H * 0.95, 160, 118, 45);

  const startedAt = performance.now();
  let rafId = null;

  function frame() {
    ctx.clearRect(0, 0, W, H);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vx *= drag;
      p.vy = p.vy * drag + gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.wobble += p.wobbleSpeed;
      p.life -= p.decay;
      if (p.life <= 0 || p.y > H + 40) { particles.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, Math.max(1, p.h * Math.abs(Math.cos(p.wobble))));
      ctx.restore();
    }
    // 예약된 버스트가 아직 남아 있을 수 있으니 처음 1.5초는 입자가 없어도 계속 돈다.
    if (particles.length > 0 || performance.now() - startedAt < 1500) {
      rafId = requestAnimationFrame(frame);
    } else {
      rafId = null;
    }
  }
  rafId = requestAnimationFrame(frame);

  return () => {
    timers.forEach(clearTimeout);
    if (rafId) cancelAnimationFrame(rafId);
    ctx.clearRect(0, 0, W, H);
  };
}
