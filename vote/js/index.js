import { db } from './firebase-config.js';
import {
  collection, query, where, onSnapshot, doc, getDoc, setDoc,
  serverTimestamp, Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { hashPhone, formatRemaining, formatDateTime, voteStatus } from './util.js';

const listEl = document.getElementById('vote-list');
const emptyEl = document.getElementById('empty-state');
const modalRoot = document.getElementById('modal-root');
const messageArea = document.getElementById('message-area');

let activeVotes = [];

function showMessage(text, type = 'info', timeout = 3000) {
  messageArea.innerHTML = `<div class="message ${type}">${text}</div>`;
  if (timeout) setTimeout(() => { messageArea.innerHTML = ''; }, timeout);
}

function renderList() {
  const now = new Date();
  const visible = activeVotes.filter(v => voteStatus(v, now) === 'active');

  if (visible.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  listEl.innerHTML = visible.map(v => {
    const itemCount = v.items?.length ?? 0;
    const choiceLabel = (v.maxChoices ?? 1) > 1 ? `복수 선택(최대 ${v.maxChoices}개)` : '단일 선택';
    const anonLabel = v.isAnonymous ? '익명' : '기명';
    return `
      <div class="vote-card" data-vote-id="${v.id}">
        <h3>${escapeHtml(v.title)}</h3>
        <div class="meta">
          <span class="badge active">진행중</span>
          <span>${formatRemaining(v.endAt, now)}</span>
          <span>${itemCount}개 항목 · ${choiceLabel} · ${anonLabel}</span>
        </div>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.vote-card').forEach(card => {
    card.addEventListener('click', () => openAuthModal(card.dataset.voteId));
  });
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function closeModal() { modalRoot.innerHTML = ''; }

function openAuthModal(voteId) {
  const vote = activeVotes.find(v => v.id === voteId);
  if (!vote) return;

  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <h2>${escapeHtml(vote.title)}</h2>
        <p class="text-muted">투표하려면 등록된 인증번호(전화번호)를 입력하세요.</p>
        <div class="form-group">
          <label>인증번호</label>
          <input type="text" id="phone-input" inputmode="numeric" placeholder="예: 010-1234-5678" autocomplete="off">
        </div>
        <div id="auth-error" class="message error hidden"></div>
        <div class="button-row">
          <button class="btn-secondary" id="auth-cancel">취소</button>
          <button class="btn-primary" id="auth-submit">계속</button>
        </div>
      </div>
    </div>
  `;
  const input = document.getElementById('phone-input');
  const errorEl = document.getElementById('auth-error');
  input.focus();

  document.getElementById('auth-cancel').onclick = closeModal;
  document.getElementById('auth-submit').onclick = handleAuth;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') handleAuth(); });

  async function handleAuth() {
    errorEl.classList.add('hidden');
    const raw = input.value.trim();
    if (!raw) {
      showAuthError('인증번호를 입력하세요.');
      return;
    }
    const phoneHash = await hashPhone(raw);
    if (!phoneHash) {
      showAuthError('유효한 번호를 입력하세요.');
      return;
    }
    if (!(vote.allowedPhoneHashes ?? []).includes(phoneHash)) {
      showAuthError('등록되지 않은 인증번호입니다.');
      return;
    }
    const ballotRef = doc(db, 'votes', vote.id, 'ballots', phoneHash);
    const existing = await getDoc(ballotRef);
    if (existing.exists()) {
      openCompletedModal(vote);
      return;
    }
    openVoteModal(vote, phoneHash);
  }
  function showAuthError(text) {
    errorEl.textContent = text;
    errorEl.classList.remove('hidden');
  }
}

function openCompletedModal(vote) {
  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <h2>${escapeHtml(vote.title)}</h2>
        <div class="message success">이미 투표를 완료하셨습니다.</div>
        <div class="button-row">
          <button class="btn-primary" id="completed-close">닫기</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('completed-close').onclick = closeModal;
}

function openVoteModal(vote, phoneHash) {
  const maxChoices = vote.maxChoices ?? 1;
  const isMulti = maxChoices > 1;
  const inputType = isMulti ? 'checkbox' : 'radio';

  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <h2>${escapeHtml(vote.title)}</h2>
        <p class="text-muted">${isMulti ? `최대 ${maxChoices}개 선택` : '하나만 선택'}</p>
        <div class="choice-list" id="choice-list">
          ${vote.items.map((label, idx) => `
            <label class="choice" data-idx="${idx}">
              <input type="${inputType}" name="choice" value="${idx}">
              <span>${escapeHtml(label)}</span>
            </label>
          `).join('')}
        </div>
        <div id="vote-error" class="message error hidden mt-4"></div>
        <div class="button-row">
          <button class="btn-secondary" id="vote-cancel">취소</button>
          <button class="btn-primary" id="vote-submit">투표 제출</button>
        </div>
      </div>
    </div>
  `;
  const choiceList = document.getElementById('choice-list');
  const errorEl = document.getElementById('vote-error');

  choiceList.addEventListener('change', () => {
    const selected = [...choiceList.querySelectorAll('input:checked')];
    if (isMulti && selected.length > maxChoices) {
      const last = selected[selected.length - 1];
      last.checked = false;
      showVoteError(`최대 ${maxChoices}개까지 선택 가능합니다.`);
      return;
    }
    errorEl.classList.add('hidden');
    choiceList.querySelectorAll('.choice').forEach(c => {
      c.classList.toggle('selected', c.querySelector('input').checked);
    });
  });

  document.getElementById('vote-cancel').onclick = closeModal;
  document.getElementById('vote-submit').onclick = submit;

  async function submit() {
    const selected = [...choiceList.querySelectorAll('input:checked')];
    if (selected.length === 0) {
      showVoteError('항목을 선택하세요.');
      return;
    }
    const choices = selected.map(el => Number(el.value)).sort((a, b) => a - b);
    const ballotRef = doc(db, 'votes', vote.id, 'ballots', phoneHash);
    try {
      await setDoc(ballotRef, {
        choices,
        submittedAt: serverTimestamp(),
      });
      openCompletedModal(vote);
      showMessage('투표가 완료되었습니다.', 'success');
    } catch (err) {
      console.error(err);
      showVoteError('투표 제출에 실패했습니다. (이미 투표했거나 종료됨)');
    }
  }

  function showVoteError(text) {
    errorEl.textContent = text;
    errorEl.classList.remove('hidden');
  }
}

const now = Timestamp.fromDate(new Date());
const q = query(collection(db, 'votes'), where('endAt', '>', now));

onSnapshot(q, snap => {
  activeVotes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderList();
}, err => {
  console.error(err);
  showMessage('투표 목록을 불러오지 못했습니다. Firebase 설정을 확인하세요.', 'error', 0);
});

setInterval(renderList, 30000);
