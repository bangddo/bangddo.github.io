import { db } from './firebase-config.js';
import {
  collection, query, where, onSnapshot, doc, getDoc, setDoc,
  writeBatch, serverTimestamp, Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { hashPhone, normalizePhone, formatRemaining, voteStatus } from './util.js';

const SESSION_HASH = 'vote.phoneHash';
const SESSION_RAW = 'vote.phoneRaw';

const entrySection = document.getElementById('entry-section');
const listSection = document.getElementById('list-section');
const listEl = document.getElementById('vote-list');
const emptyEl = document.getElementById('empty-state');
const messageArea = document.getElementById('message-area');
const modalRoot = document.getElementById('modal-root');
const phoneDisplay = document.getElementById('phone-display');

let phoneHash = sessionStorage.getItem(SESSION_HASH);
let phoneRaw = sessionStorage.getItem(SESSION_RAW);
let votes = [];
let votedSet = new Set();
let unsubscribe = null;

function showMessage(text, type = 'info', timeout = 3000) {
  messageArea.innerHTML = `<div class="message ${type}">${text}</div>`;
  if (timeout) setTimeout(() => { messageArea.innerHTML = ''; }, timeout);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function maskPhone(raw) {
  if (!raw) return '';
  if (raw.length <= 4) return raw;
  return raw.slice(0, raw.length - 4).replace(/\d/g, '*') + raw.slice(-4);
}

function closeModal() { modalRoot.innerHTML = ''; }

function showEntry() {
  entrySection.classList.remove('hidden');
  listSection.classList.add('hidden');
  const input = document.getElementById('entry-phone');
  input.value = '';
  document.getElementById('entry-error').classList.add('hidden');
  setTimeout(() => input.focus(), 0);
}

function showList() {
  entrySection.classList.add('hidden');
  listSection.classList.remove('hidden');
  phoneDisplay.textContent = maskPhone(phoneRaw ?? '');
}

document.getElementById('entry-submit').onclick = handleEntry;
document.getElementById('entry-phone').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleEntry();
});
document.getElementById('reset-phone').onclick = clearPhone;

async function handleEntry() {
  const errorEl = document.getElementById('entry-error');
  errorEl.classList.add('hidden');
  const raw = document.getElementById('entry-phone').value.trim();
  if (!raw) {
    errorEl.textContent = '인증번호를 입력하세요.';
    errorEl.classList.remove('hidden');
    return;
  }
  const hash = await hashPhone(raw);
  if (!hash) {
    errorEl.textContent = '유효한 번호를 입력하세요.';
    errorEl.classList.remove('hidden');
    return;
  }
  phoneHash = hash;
  phoneRaw = normalizePhone(raw);
  sessionStorage.setItem(SESSION_HASH, phoneHash);
  sessionStorage.setItem(SESSION_RAW, phoneRaw);
  showList();
  await loadVotes();
}

function clearPhone() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  phoneHash = null;
  phoneRaw = null;
  votes = [];
  votedSet = new Set();
  sessionStorage.removeItem(SESSION_HASH);
  sessionStorage.removeItem(SESSION_RAW);
  listEl.innerHTML = '';
  emptyEl.classList.add('hidden');
  showEntry();
}

function renderList() {
  if (!phoneHash) return;
  const now = new Date();
  const visible = votes.filter(v =>
    voteStatus(v, now) === 'active' && !votedSet.has(v.id)
  );

  if (visible.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    emptyEl.textContent =
      '참여 가능한 투표가 없습니다. 등록되지 않은 번호이거나 모두 투표를 완료했을 수 있습니다.';
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
    const v = visible.find(x => x.id === card.dataset.voteId);
    card.addEventListener('click', () => openVoteModal(v));
  });
}

function openCompletedModal(vote) {
  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="message success">${escapeHtml(vote.title)} 투표를 완료했습니다.</div>
        <div class="button-row">
          <button class="btn-primary" id="completed-close">닫기</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('completed-close').onclick = closeModal;
}

function openVoteModal(vote) {
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
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'votes', vote.id, 'ballots', phoneHash), {
        choices,
        submittedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'votes', vote.id, 'voters', phoneHash), {
        at: serverTimestamp(),
      });
      await batch.commit();
      votedSet.add(vote.id);
      openCompletedModal(vote);
      showMessage(`${escapeHtml(vote.title)} 투표를 완료했습니다.`, 'success');
      renderList();
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

async function loadVotes() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (!phoneHash) return;

  const now = Timestamp.fromDate(new Date());
  const q = query(
    collection(db, 'votes'),
    where('allowedPhoneHashes', 'array-contains', phoneHash),
    where('isPublic', '==', true),
    where('endAt', '>', now),
  );

  unsubscribe = onSnapshot(q, async snap => {
    votes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const checks = await Promise.all(votes.map(async v => {
      try {
        const voterDoc = await getDoc(doc(db, 'votes', v.id, 'voters', phoneHash));
        return [v.id, voterDoc.exists()];
      } catch {
        return [v.id, false];
      }
    }));
    votedSet = new Set(checks.filter(([, e]) => e).map(([id]) => id));
    renderList();
  }, err => {
    console.error(err);
    showMessage('투표 목록을 불러오지 못했습니다. Firebase 설정을 확인하세요.', 'error', 0);
  });
}

if (phoneHash) {
  showList();
  loadVotes();
} else {
  showEntry();
}

setInterval(renderList, 30000);
