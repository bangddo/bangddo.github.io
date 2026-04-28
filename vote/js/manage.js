import { db, auth } from './firebase-config.js';
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  setDoc, onSnapshot, query, orderBy, writeBatch, serverTimestamp, Timestamp, limit,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  hashPhoneList, formatDateTime, toLocalInputValue, fromLocalInputValue,
  voteStatus, statusLabel,
} from './util.js';

const loginSection = document.getElementById('login-section');
const manageSection = document.getElementById('manage-section');
const userInfo = document.getElementById('user-info');
const logoutBtn = document.getElementById('logout-btn');
const messageArea = document.getElementById('message-area');
const voteListEl = document.getElementById('vote-list');
const listEmptyEl = document.getElementById('list-empty');
const panelContent = document.getElementById('panel-content');

let votes = [];
let selectedVoteId = null;
let votesUnsubscribe = null;
let resultsUnsubscribe = null;

function showMessage(text, type = 'info', timeout = 3000) {
  messageArea.innerHTML = `<div class="message ${type}">${escapeHtml(text)}</div>`;
  if (timeout) setTimeout(() => { messageArea.innerHTML = ''; }, timeout);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

document.getElementById('login-submit').onclick = async () => {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.classList.add('hidden');
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const token = await cred.user.getIdTokenResult(true);
    if (!token.claims.admin) {
      await signOut(auth);
      errorEl.textContent = '관리자 권한이 없는 계정입니다.';
      errorEl.classList.remove('hidden');
    }
  } catch (err) {
    console.error(err);
    errorEl.textContent = '로그인 실패: ' + (err.code ?? err.message);
    errorEl.classList.remove('hidden');
  }
};

document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('login-submit').click();
});

logoutBtn.onclick = () => signOut(auth);

onAuthStateChanged(auth, async user => {
  if (!user) {
    showLogin();
    return;
  }
  const token = await user.getIdTokenResult();
  if (!token.claims.admin) {
    showMessage('관리자 권한이 필요합니다.', 'error');
    await signOut(auth);
    return;
  }
  showManage(user);
});

function showLogin() {
  loginSection.classList.remove('hidden');
  manageSection.classList.add('hidden');
  userInfo.classList.add('hidden');
  logoutBtn.classList.add('hidden');
  if (votesUnsubscribe) { votesUnsubscribe(); votesUnsubscribe = null; }
  if (resultsUnsubscribe) { resultsUnsubscribe(); resultsUnsubscribe = null; }
}

function showManage(user) {
  loginSection.classList.add('hidden');
  manageSection.classList.remove('hidden');
  userInfo.classList.remove('hidden');
  logoutBtn.classList.remove('hidden');
  userInfo.textContent = user.email;
  subscribeVotes();
}

function subscribeVotes() {
  if (votesUnsubscribe) votesUnsubscribe();
  const q = query(collection(db, 'votes'), orderBy('createdAt', 'desc'));
  votesUnsubscribe = onSnapshot(q, snap => {
    votes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSidebar();
    if (selectedVoteId) {
      const exists = votes.find(v => v.id === selectedVoteId);
      if (!exists) {
        selectedVoteId = null;
        showEmptyPanel();
      } else {
        renderDetail(exists);
      }
    }
  }, err => {
    console.error(err);
    showMessage('투표 목록 로드 실패: ' + err.message, 'error', 0);
  });
}

function renderSidebar() {
  if (votes.length === 0) {
    voteListEl.innerHTML = '';
    listEmptyEl.classList.remove('hidden');
    return;
  }
  listEmptyEl.classList.add('hidden');
  const now = new Date();
  voteListEl.innerHTML = votes.map(v => {
    const status = voteStatus(v, now);
    return `
      <div class="vote-card ${selectedVoteId === v.id ? 'selected' : ''}" data-id="${v.id}">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
          <strong style="font-size:14px;">${escapeHtml(v.title)}${v.isPublic === false ? ' <span class="text-muted" style="font-weight:normal;">(비공개)</span>' : ''}</strong>
          <span class="badge ${status}">${statusLabel(status)}</span>
        </div>
      </div>
    `;
  }).join('');
  voteListEl.querySelectorAll('.vote-card').forEach(card => {
    card.onclick = () => {
      selectedVoteId = card.dataset.id;
      renderSidebar();
      renderDetail(votes.find(v => v.id === selectedVoteId));
    };
  });
}

function showEmptyPanel() {
  panelContent.innerHTML = '<p class="text-muted">왼쪽에서 투표를 선택하거나 새로 등록하세요.</p>';
}

document.getElementById('new-vote-btn').onclick = () => {
  selectedVoteId = null;
  renderSidebar();
  renderForm(null);
};

function renderForm(vote) {
  const isEdit = !!vote;
  const now = new Date();
  const defaultStart = isEdit ? toLocalInputValue(vote.startAt.toDate()) : toLocalInputValue(now);
  const defaultEnd = isEdit ? toLocalInputValue(vote.endAt.toDate()) : toLocalInputValue(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const items = isEdit ? vote.items : [''];
  const lockTimeAndAnon = isEdit;

  panelContent.innerHTML = `
    <h2>${isEdit ? '투표 수정' : '새 투표 등록'}</h2>
    <div class="form-group">
      <label>투표 제목</label>
      <input type="text" id="f-title" value="${escapeHtml(isEdit ? vote.title : '')}">
    </div>
    <div class="form-group">
      <label>투표 항목</label>
      <div id="items-container"></div>
      <button class="btn-secondary btn-sm mt-2" id="add-item-btn">+ 항목 추가</button>
      <div id="items-locked-msg" class="text-muted hidden mt-2">이미 투표가 진행되어 항목 수정이 잠겼습니다.</div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>시작 시간</label>
        <input type="datetime-local" id="f-start" value="${defaultStart}" ${lockTimeAndAnon ? 'disabled' : ''}>
      </div>
      <div class="form-group">
        <label>종료 시간</label>
        <input type="datetime-local" id="f-end" value="${defaultEnd}" ${lockTimeAndAnon ? 'disabled' : ''}>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>최대 선택 개수 (1=단일)</label>
        <input type="number" id="f-max" min="1" value="${isEdit ? vote.maxChoices : 1}" ${lockTimeAndAnon ? 'disabled' : ''}>
      </div>
      <div class="form-group">
        <label>익명 투표</label>
        <div class="checkbox-row" style="height: 36px;">
          <input type="checkbox" id="f-anon" ${isEdit && vote.isAnonymous ? 'checked' : ''} ${lockTimeAndAnon ? 'disabled' : ''}>
          <label for="f-anon">익명으로 진행</label>
        </div>
      </div>
    </div>
    <div class="form-group">
      <div class="checkbox-row">
        <input type="checkbox" id="f-public" ${!isEdit || vote.isPublic !== false ? 'checked' : ''}>
        <label for="f-public">공개 (체크 해제 시 유권자 화면에 노출되지 않음)</label>
      </div>
    </div>
    <div class="form-group">
      <label>투표 대상자 인증번호 (전화번호, 줄/콤마 구분)</label>
      <textarea id="f-phones" placeholder="010-1234-5678&#10;010-9876-5432" rows="6"></textarea>
      ${isEdit ? `<div class="text-muted mt-2">기존 ${vote.allowedPhoneHashes?.length ?? 0}개 등록됨. 새로 입력하면 전체 교체됩니다. 비워두면 유지됩니다.</div>` : ''}
    </div>
    <div id="form-error" class="message error hidden"></div>
    <div class="button-row">
      <button class="btn-secondary" id="cancel-btn">취소</button>
      <button class="btn-primary" id="save-btn">${isEdit ? '저장' : '등록'}</button>
    </div>
  `;

  const itemsContainer = document.getElementById('items-container');
  const errorEl = document.getElementById('form-error');

  function renderItems(values) {
    itemsContainer.innerHTML = values.map((val, idx) => `
      <div class="item-input-row">
        <input type="text" data-idx="${idx}" value="${escapeHtml(val)}" placeholder="항목 ${idx + 1}">
        <button class="btn-secondary btn-sm" data-remove="${idx}">×</button>
      </div>
    `).join('');
    itemsContainer.querySelectorAll('input').forEach(input => {
      input.oninput = () => {
        values[Number(input.dataset.idx)] = input.value;
      };
    });
    itemsContainer.querySelectorAll('button[data-remove]').forEach(btn => {
      btn.onclick = () => {
        values.splice(Number(btn.dataset.remove), 1);
        if (values.length === 0) values.push('');
        renderItems(values);
      };
    });
  }

  const itemValues = [...items];
  renderItems(itemValues);

  document.getElementById('add-item-btn').onclick = () => {
    itemValues.push('');
    renderItems(itemValues);
  };

  if (isEdit) {
    checkBallotsExist(vote.id).then(hasBallots => {
      if (hasBallots) {
        document.querySelectorAll('#items-container input').forEach(i => i.disabled = true);
        document.getElementById('add-item-btn').disabled = true;
        document.querySelectorAll('#items-container button[data-remove]').forEach(b => b.disabled = true);
        document.getElementById('items-locked-msg').classList.remove('hidden');
      }
    });
  }

  document.getElementById('cancel-btn').onclick = () => {
    if (isEdit) renderDetail(vote); else showEmptyPanel();
  };

  document.getElementById('save-btn').onclick = async () => {
    errorEl.classList.add('hidden');
    const title = document.getElementById('f-title').value.trim();
    const cleanedItems = itemValues.map(s => s.trim()).filter(Boolean);
    const phonesText = document.getElementById('f-phones').value;
    const maxChoices = Number(document.getElementById('f-max').value) || 1;
    const isAnonymous = document.getElementById('f-anon').checked;
    const isPublic = document.getElementById('f-public').checked;

    if (!title) return showError('제목을 입력하세요.');
    if (cleanedItems.length < 2) return showError('항목을 2개 이상 입력하세요.');
    if (maxChoices < 1 || maxChoices > cleanedItems.length) return showError('최대 선택 개수가 유효하지 않습니다.');

    let phoneHashes;
    if (phonesText.trim()) {
      phoneHashes = await hashPhoneList(phonesText);
      if (phoneHashes.length === 0) return showError('유효한 전화번호가 없습니다.');
    } else if (isEdit) {
      phoneHashes = vote.allowedPhoneHashes ?? [];
    } else {
      return showError('투표 대상자 전화번호를 입력하세요.');
    }

    try {
      if (isEdit) {
        const update = {
          title,
          items: cleanedItems,
          allowedPhoneHashes: phoneHashes,
          isPublic,
        };
        await updateDoc(doc(db, 'votes', vote.id), update);
        showMessage('수정되었습니다.', 'success');
      } else {
        const startAt = fromLocalInputValue(document.getElementById('f-start').value);
        const endAt = fromLocalInputValue(document.getElementById('f-end').value);
        if (!startAt || !endAt) return showError('시간을 입력하세요.');
        if (endAt <= startAt) return showError('종료 시간이 시작 시간보다 뒤여야 합니다.');

        const ref = await addDoc(collection(db, 'votes'), {
          title,
          items: cleanedItems,
          startAt: Timestamp.fromDate(startAt),
          endAt: Timestamp.fromDate(endAt),
          isAnonymous,
          isPublic,
          maxChoices,
          allowedPhoneHashes: phoneHashes,
          createdAt: serverTimestamp(),
        });
        selectedVoteId = ref.id;
        showMessage('등록되었습니다.', 'success');
      }
    } catch (err) {
      console.error(err);
      showError('저장 실패: ' + err.message);
    }
  };

  function showError(text) {
    errorEl.textContent = text;
    errorEl.classList.remove('hidden');
  }
}

async function checkBallotsExist(voteId) {
  const snap = await getDocs(query(collection(db, 'votes', voteId, 'ballots'), limit(1)));
  return !snap.empty;
}

function renderDetail(vote) {
  if (resultsUnsubscribe) { resultsUnsubscribe(); resultsUnsubscribe = null; }

  const status = voteStatus(vote);
  panelContent.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
      <div>
        <h2 style="margin-bottom: 4px;">${escapeHtml(vote.title)}</h2>
        <div class="text-muted">
          <span class="badge ${status}">${statusLabel(status)}</span>
          ${vote.isPublic === false ? '<span class="badge ended">비공개</span>' : ''}
          ${formatDateTime(vote.startAt.toDate())} ~ ${formatDateTime(vote.endAt.toDate())} ·
          ${vote.isAnonymous ? '익명' : '기명'} ·
          ${(vote.maxChoices ?? 1) > 1 ? `복수 선택(최대 ${vote.maxChoices}개)` : '단일 선택'} ·
          대상 ${vote.allowedPhoneHashes?.length ?? 0}명
        </div>
      </div>
      <div class="button-row">
        <button class="btn-secondary btn-sm" id="edit-btn">수정</button>
        <button class="btn-danger btn-sm" id="delete-btn">삭제</button>
      </div>
    </div>
    <div class="mt-4">
      <h3 style="font-size:15px; margin-bottom:8px;">결과</h3>
      <div id="results-area"><p class="text-muted">집계 중...</p></div>
    </div>
  `;

  document.getElementById('edit-btn').onclick = () => renderForm(vote);
  document.getElementById('delete-btn').onclick = () => confirmDelete(vote);

  resultsUnsubscribe = onSnapshot(
    collection(db, 'votes', vote.id, 'ballots'),
    snap => renderResults(vote, snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.error(err);
      document.getElementById('results-area').innerHTML =
        `<div class="message error">결과 로드 실패: ${escapeHtml(err.message)}</div>`;
    }
  );
}

function renderResults(vote, ballots) {
  const area = document.getElementById('results-area');
  if (!area) return;

  const counts = vote.items.map(() => 0);
  ballots.forEach(b => {
    (b.choices ?? []).forEach(idx => {
      if (idx >= 0 && idx < counts.length) counts[idx]++;
    });
  });
  const totalVoters = ballots.length;
  const totalChoices = counts.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...counts);

  let html = `
    <div class="text-muted mb-4">
      ${totalVoters}명 참여 / ${vote.allowedPhoneHashes?.length ?? 0}명 대상
      ${(vote.maxChoices ?? 1) > 1 ? `· 총 선택 ${totalChoices}건` : ''}
    </div>
  `;
  html += vote.items.map((label, idx) => {
    const c = counts[idx];
    const pct = totalVoters > 0 ? Math.round((c / max) * 100) : 0;
    const ratio = totalVoters > 0 ? ((c / totalVoters) * 100).toFixed(1) : '0.0';
    return `
      <div class="result-row">
        <div class="label">
          <span>${escapeHtml(label)}</span>
          <span class="count">${c}표 (${ratio}%)</span>
        </div>
        <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
      </div>
    `;
  }).join('');

  if (!vote.isAnonymous && ballots.length > 0) {
    html += `
      <h3 style="font-size:14px; margin-top:24px; margin-bottom:8px;">기명 투표 내역</h3>
      <table style="width:100%; font-size:13px; border-collapse: collapse;">
        <thead><tr style="border-bottom:1px solid var(--border);">
          <th style="text-align:left; padding:6px;">투표자</th>
          <th style="text-align:left; padding:6px;">선택</th>
          <th style="text-align:left; padding:6px;">시각</th>
        </tr></thead>
        <tbody>
          ${ballots.map(b => `
            <tr style="border-bottom:1px solid var(--border);">
              <td style="padding:6px; font-family:monospace;">${b.id.substring(0, 8)}…</td>
              <td style="padding:6px;">${(b.choices ?? []).map(i => escapeHtml(vote.items[i] ?? `#${i}`)).join(', ')}</td>
              <td style="padding:6px;" class="text-muted">${b.submittedAt ? formatDateTime(b.submittedAt.toDate()) : '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="text-muted mt-2">투표자는 전화번호 해시의 앞 8자리만 표시됩니다.</div>
    `;
  }

  area.innerHTML = html;
}

function confirmDelete(vote) {
  const modal = document.getElementById('modal-root');
  modal.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <h2>투표 삭제</h2>
        <p>"${escapeHtml(vote.title)}" 투표와 모든 표를 삭제합니다. 이 작업은 되돌릴 수 없습니다.</p>
        <div class="button-row">
          <button class="btn-secondary" id="del-cancel">취소</button>
          <button class="btn-danger" id="del-confirm">삭제</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('del-cancel').onclick = () => modal.innerHTML = '';
  document.getElementById('del-confirm').onclick = async () => {
    modal.innerHTML = '';
    try {
      await deleteVoteWithSubcollections(vote.id);
      showMessage('삭제되었습니다.', 'success');
      selectedVoteId = null;
      showEmptyPanel();
    } catch (err) {
      console.error(err);
      showMessage('삭제 실패: ' + err.message, 'error', 0);
    }
  };
}

async function deleteSubcollection(path) {
  const col = collection(db, ...path);
  while (true) {
    const snap = await getDocs(query(col, limit(400)));
    if (snap.empty) break;
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < 400) break;
  }
}

async function deleteVoteWithSubcollections(voteId) {
  await deleteSubcollection(['votes', voteId, 'ballots']);
  await deleteSubcollection(['votes', voteId, 'voters']);
  await deleteDoc(doc(db, 'votes', voteId));
}
