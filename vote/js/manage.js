import { db, auth } from './firebase-config.js';
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  setDoc, onSnapshot, query, orderBy, writeBatch, serverTimestamp, Timestamp, limit,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  hashPhoneList, formatDateTime, toLocalInputValue, fromLocalInputValue,
  voteStatus, statusLabel, generateInviteCode,
} from './util.js';

const loginSection = document.getElementById('login-section');
const signupSection = document.getElementById('signup-section');
const pendingSection = document.getElementById('pending-section');
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
let adminWatchUnsubscribe = null;
let inviteFromUrl = null;

function showMessage(text, type = 'info', timeout = 3000) {
  messageArea.innerHTML = `<div class="message ${type}">${escapeHtml(text)}</div>`;
  if (timeout) setTimeout(() => { messageArea.innerHTML = ''; }, timeout);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

document.getElementById('login-submit').onclick = handleLogin;
document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleLogin();
});
document.getElementById('signup-submit').onclick = handleSignup;
document.getElementById('signup-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleSignup();
});
document.getElementById('pending-cancel').onclick = handlePendingCancel;

logoutBtn.onclick = () => signOut(auth);

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.classList.add('hidden');
  try {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged 가 admins 검사 + 화면 전환 처리
  } catch (err) {
    console.error(err);
    errorEl.textContent = '로그인 실패: ' + (err.code ?? err.message);
    errorEl.classList.remove('hidden');
  }
}

async function handleSignup() {
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const errorEl = document.getElementById('signup-error');
  errorEl.classList.add('hidden');

  if (!inviteFromUrl) {
    showSignupError('초대 코드가 유효하지 않습니다.');
    return;
  }
  if (!email) return showSignupError('이메일을 입력하세요.');
  if (!password || password.length < 6) return showSignupError('비밀번호는 6자리 이상이어야 합니다.');

  let cred;
  try {
    cred = await createUserWithEmailAndPassword(auth, email, password);
  } catch (err) {
    if (err.code === 'auth/email-already-in-use') {
      // 이전 가입 시도가 실패해서 Auth 계정만 남았을 가능성 — 같은 비밀번호로 로그인 시도
      try {
        cred = await signInWithEmailAndPassword(auth, email, password);
      } catch (signinErr) {
        console.error(signinErr);
        showSignupError('이미 가입된 이메일입니다. 같은 비밀번호로 자동 복구 시도가 실패했습니다. 비밀번호가 다르면 Firebase 콘솔(Authentication > Users)에서 해당 계정 삭제 후 재가입하세요.');
        return;
      }
    } else {
      console.error(err);
      showSignupError('가입 실패: ' + (err.code ?? err.message));
      return;
    }
  }

  // invite 코드를 사용 표시 + 가입 요청 작성 (batched)
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'inviteCodes', inviteFromUrl), {
      usedBy: cred.user.uid,
      usedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'adminRequests', cred.user.uid), {
      email,
      inviteCode: inviteFromUrl,
      requestedAt: serverTimestamp(),
    });
    await batch.commit();
    // URL 정리
    history.replaceState({}, '', location.pathname);
    inviteFromUrl = null;
  } catch (err) {
    console.error(err);
    // 가입은 됐지만 요청 작성 실패 — 사용자가 재시도하거나 관리자에게 문의
    showSignupError('가입 요청 작성 실패: ' + (err.code ?? err.message) + '. 관리자에게 문의하세요.');
  }

  function showSignupError(text) {
    errorEl.textContent = text;
    errorEl.classList.remove('hidden');
  }
}

async function handlePendingCancel() {
  const user = auth.currentUser;
  if (!user) return;
  const ok = confirm('가입 요청을 취소하고 계정을 삭제하시겠습니까?');
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'adminRequests', user.uid));
    await user.delete();
  } catch (err) {
    console.error(err);
    showMessage('취소 실패: ' + err.message, 'error', 0);
  }
}

onAuthStateChanged(auth, async user => {
  cleanupAdminWatch();
  if (!user) {
    if (inviteFromUrl) showSignup();
    else showLogin();
    return;
  }
  // admin 여부 확인
  const adminSnap = await getDoc(doc(db, 'admins', user.uid));
  if (adminSnap.exists()) {
    showManage(user);
    return;
  }
  // adminRequest 있으면 승인 대기 화면 + 실시간 admins 구독
  const reqSnap = await getDoc(doc(db, 'adminRequests', user.uid));
  if (reqSnap.exists()) {
    showPending(user);
    return;
  }
  // 권한도 요청도 없음
  showMessage('관리자 권한이 필요합니다. 초대 코드를 받아 가입하세요.', 'error', 5000);
  await signOut(auth);
});

function cleanupAdminWatch() {
  if (adminWatchUnsubscribe) { adminWatchUnsubscribe(); adminWatchUnsubscribe = null; }
}

function hideAllSections() {
  loginSection.classList.add('hidden');
  signupSection.classList.add('hidden');
  pendingSection.classList.add('hidden');
  manageSection.classList.add('hidden');
}

function showLogin() {
  hideAllSections();
  loginSection.classList.remove('hidden');
  userInfo.classList.add('hidden');
  logoutBtn.classList.add('hidden');
  if (votesUnsubscribe) { votesUnsubscribe(); votesUnsubscribe = null; }
  if (resultsUnsubscribe) { resultsUnsubscribe(); resultsUnsubscribe = null; }
}

function showSignup() {
  hideAllSections();
  signupSection.classList.remove('hidden');
  document.getElementById('signup-code-display').textContent = inviteFromUrl ?? '';
  userInfo.classList.add('hidden');
  logoutBtn.classList.add('hidden');
}

function showPending(user) {
  hideAllSections();
  pendingSection.classList.remove('hidden');
  document.getElementById('pending-email').textContent = user.email;
  userInfo.classList.add('hidden');
  logoutBtn.classList.remove('hidden');
  // admins/{uid} 생성을 실시간 구독 → 승인되면 화면 전환
  adminWatchUnsubscribe = onSnapshot(doc(db, 'admins', user.uid), snap => {
    if (snap.exists()) {
      cleanupAdminWatch();
      showManage(user);
    }
  });
}

function showManage(user) {
  hideAllSections();
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

document.getElementById('open-admin-panel').onclick = () => {
  selectedVoteId = null;
  renderSidebar();
  renderAdminPanel();
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
        ${status === 'active' ? '<button class="btn-secondary btn-sm" id="end-now-btn">즉시 종료</button>' : ''}
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
  if (status === 'active') {
    document.getElementById('end-now-btn').onclick = () => confirmEndNow(vote);
  }

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

function confirmEndNow(vote) {
  const modal = document.getElementById('modal-root');
  modal.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <h2>투표 즉시 종료</h2>
        <p>"${escapeHtml(vote.title)}" 투표를 지금 종료합니다. 종료 후에는 신규 투표를 받을 수 없습니다.</p>
        <div class="button-row">
          <button class="btn-secondary" id="end-cancel">취소</button>
          <button class="btn-danger" id="end-confirm">종료</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('end-cancel').onclick = () => modal.innerHTML = '';
  document.getElementById('end-confirm').onclick = async () => {
    modal.innerHTML = '';
    try {
      await updateDoc(doc(db, 'votes', vote.id), { endAt: Timestamp.now() });
      showMessage('투표가 종료되었습니다.', 'success');
    } catch (err) {
      console.error(err);
      showMessage('종료 실패: ' + err.message, 'error', 0);
    }
  };
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

// ========== 관리자 관리 패널 ==========

const INVITE_TTL_DAYS = 7;
let adminPanelUnsubscribes = [];

function unsubscribeAdminPanel() {
  adminPanelUnsubscribes.forEach(u => u());
  adminPanelUnsubscribes = [];
}

function renderAdminPanel() {
  unsubscribeAdminPanel();
  if (resultsUnsubscribe) { resultsUnsubscribe(); resultsUnsubscribe = null; }

  panelContent.innerHTML = `
    <h2>관리자 관리</h2>

    <section class="mb-4">
      <h3 style="font-size:14px; margin: 0 0 8px;">초대 코드 발급</h3>
      <p class="text-muted mb-2">새 관리자를 초대할 코드를 생성합니다. 발급 후 ${INVITE_TTL_DAYS}일간 유효.</p>
      <button id="gen-invite-btn" class="btn-primary btn-sm">+ 초대 코드 생성</button>
      <div id="last-invite" class="hidden mt-2"></div>
    </section>

    <section class="mb-4">
      <h3 style="font-size:14px; margin: 16px 0 8px;">활성 초대 코드</h3>
      <div id="invite-list"><p class="text-muted">불러오는 중...</p></div>
    </section>

    <section class="mb-4">
      <h3 style="font-size:14px; margin: 16px 0 8px;">가입 요청</h3>
      <div id="request-list"><p class="text-muted">불러오는 중...</p></div>
    </section>

    <section>
      <h3 style="font-size:14px; margin: 16px 0 8px;">현재 관리자</h3>
      <div id="admin-list"><p class="text-muted">불러오는 중...</p></div>
    </section>
  `;

  document.getElementById('gen-invite-btn').onclick = generateInvite;
  subscribeAdminPanelData();
}

async function generateInvite() {
  const me = auth.currentUser;
  if (!me) return;
  const btn = document.getElementById('gen-invite-btn');
  btn.disabled = true;
  try {
    const code = generateInviteCode(8);
    const expiresAt = Timestamp.fromDate(
      new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)
    );
    await setDoc(doc(db, 'inviteCodes', code), {
      createdBy: me.uid,
      createdAt: serverTimestamp(),
      expiresAt,
      usedBy: null,
      usedAt: null,
    });
    const url = `${location.origin}${location.pathname}?invite=${code}`;
    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {}
    const last = document.getElementById('last-invite');
    last.classList.remove('hidden');
    last.innerHTML = `
      <div class="message success">
        초대 URL ${copied ? '<strong>(클립보드에 복사됨)</strong>' : ''}<br>
        <code style="word-break:break-all; display:inline-block; margin-top:4px;">${escapeHtml(url)}</code>
      </div>
    `;
  } catch (err) {
    console.error(err);
    showMessage('생성 실패: ' + err.message, 'error', 0);
  } finally {
    btn.disabled = false;
  }
}

function subscribeAdminPanelData() {
  const me = auth.currentUser;

  // 활성 초대 코드 (미사용)
  const inviteQ = query(collection(db, 'inviteCodes'), orderBy('createdAt', 'desc'));
  adminPanelUnsubscribes.push(onSnapshot(inviteQ, snap => {
    const codes = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(c => !c.usedBy);
    const listEl = document.getElementById('invite-list');
    if (!listEl) return;
    if (codes.length === 0) {
      listEl.innerHTML = '<p class="text-muted">활성 초대 코드가 없습니다.</p>';
      return;
    }
    const now = new Date();
    listEl.innerHTML = `
      <table style="width:100%; font-size:13px; border-collapse:collapse;">
        <thead><tr style="border-bottom:1px solid var(--border);">
          <th style="text-align:left; padding:6px;">코드</th>
          <th style="text-align:left; padding:6px;">만료</th>
          <th style="text-align:right; padding:6px;"></th>
        </tr></thead>
        <tbody>
          ${codes.map(c => {
            const exp = c.expiresAt?.toDate?.();
            const expired = exp && exp < now;
            return `
              <tr style="border-bottom:1px solid var(--border); ${expired ? 'opacity:0.5;' : ''}">
                <td style="padding:6px; font-family:monospace;">${escapeHtml(c.id)}</td>
                <td style="padding:6px;" class="text-muted">${exp ? formatDateTime(exp) : '-'}${expired ? ' <span class="badge ended">만료</span>' : ''}</td>
                <td style="padding:6px; text-align:right;">
                  <button class="btn-secondary btn-sm" data-revoke="${c.id}">폐기</button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
    listEl.querySelectorAll('button[data-revoke]').forEach(btn => {
      btn.onclick = () => revokeInvite(btn.dataset.revoke);
    });
  }, err => {
    console.error(err);
    const el = document.getElementById('invite-list');
    if (el) el.innerHTML = `<div class="message error">로드 실패: ${escapeHtml(err.message)}</div>`;
  }));

  // 가입 요청
  const reqQ = query(collection(db, 'adminRequests'), orderBy('requestedAt', 'asc'));
  adminPanelUnsubscribes.push(onSnapshot(reqQ, snap => {
    const reqs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const listEl = document.getElementById('request-list');
    if (!listEl) return;
    if (reqs.length === 0) {
      listEl.innerHTML = '<p class="text-muted">대기 중인 요청이 없습니다.</p>';
      return;
    }
    listEl.innerHTML = `
      <table style="width:100%; font-size:13px; border-collapse:collapse;">
        <thead><tr style="border-bottom:1px solid var(--border);">
          <th style="text-align:left; padding:6px;">이메일</th>
          <th style="text-align:left; padding:6px;">요청시각</th>
          <th style="text-align:right; padding:6px;"></th>
        </tr></thead>
        <tbody>
          ${reqs.map(r => `
            <tr style="border-bottom:1px solid var(--border);">
              <td style="padding:6px;">${escapeHtml(r.email ?? '-')}</td>
              <td style="padding:6px;" class="text-muted">${r.requestedAt ? formatDateTime(r.requestedAt.toDate()) : '-'}</td>
              <td style="padding:6px; text-align:right;">
                <button class="btn-primary btn-sm" data-approve="${r.id}" data-email="${escapeHtml(r.email ?? '')}">승인</button>
                <button class="btn-secondary btn-sm" data-reject="${r.id}">거부</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    listEl.querySelectorAll('button[data-approve]').forEach(btn => {
      btn.onclick = () => approveRequest(btn.dataset.approve, btn.dataset.email);
    });
    listEl.querySelectorAll('button[data-reject]').forEach(btn => {
      btn.onclick = () => rejectRequest(btn.dataset.reject);
    });
  }, err => {
    console.error(err);
    const el = document.getElementById('request-list');
    if (el) el.innerHTML = `<div class="message error">로드 실패: ${escapeHtml(err.message)}</div>`;
  }));

  // 현재 관리자 목록
  const adminQ = query(collection(db, 'admins'), orderBy('grantedAt', 'asc'));
  adminPanelUnsubscribes.push(onSnapshot(adminQ, snap => {
    const admins = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const listEl = document.getElementById('admin-list');
    if (!listEl) return;
    if (admins.length === 0) {
      listEl.innerHTML = '<p class="text-muted">등록된 관리자가 없습니다.</p>';
      return;
    }
    listEl.innerHTML = `
      <table style="width:100%; font-size:13px; border-collapse:collapse;">
        <thead><tr style="border-bottom:1px solid var(--border);">
          <th style="text-align:left; padding:6px;">이메일</th>
          <th style="text-align:left; padding:6px;">부여시각</th>
          <th style="text-align:right; padding:6px;"></th>
        </tr></thead>
        <tbody>
          ${admins.map(a => {
            const isMe = a.id === me?.uid;
            return `
              <tr style="border-bottom:1px solid var(--border);">
                <td style="padding:6px;">${escapeHtml(a.email ?? a.id.substring(0, 8))}${isMe ? ' <span class="text-muted">(나)</span>' : ''}</td>
                <td style="padding:6px;" class="text-muted">${a.grantedAt ? formatDateTime(a.grantedAt.toDate()) : '-'}</td>
                <td style="padding:6px; text-align:right;">
                  <button class="btn-secondary btn-sm" data-revoke-admin="${a.id}" ${isMe ? 'disabled' : ''}>회수</button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
    listEl.querySelectorAll('button[data-revoke-admin]').forEach(btn => {
      btn.onclick = () => revokeAdmin(btn.dataset.revokeAdmin);
    });
  }, err => {
    console.error(err);
    const el = document.getElementById('admin-list');
    if (el) el.innerHTML = `<div class="message error">로드 실패: ${escapeHtml(err.message)}</div>`;
  }));
}

async function revokeInvite(code) {
  if (!confirm(`초대 코드 "${code}" 를 폐기하시겠습니까?`)) return;
  try {
    await deleteDoc(doc(db, 'inviteCodes', code));
    showMessage('폐기되었습니다.', 'success');
  } catch (err) {
    console.error(err);
    showMessage('폐기 실패: ' + err.message, 'error', 0);
  }
}

async function approveRequest(uid, email) {
  const me = auth.currentUser;
  if (!me) return;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'admins', uid), {
      email,
      grantedBy: me.uid,
      grantedAt: serverTimestamp(),
    });
    batch.delete(doc(db, 'adminRequests', uid));
    await batch.commit();
    showMessage(`${email} 승인 완료.`, 'success');
  } catch (err) {
    console.error(err);
    showMessage('승인 실패: ' + err.message, 'error', 0);
  }
}

async function rejectRequest(uid) {
  if (!confirm('가입 요청을 거부하시겠습니까?')) return;
  try {
    await deleteDoc(doc(db, 'adminRequests', uid));
    showMessage('거부되었습니다.', 'success');
  } catch (err) {
    console.error(err);
    showMessage('거부 실패: ' + err.message, 'error', 0);
  }
}

async function revokeAdmin(uid) {
  if (uid === auth.currentUser?.uid) {
    showMessage('자기 자신의 권한은 회수할 수 없습니다.', 'error');
    return;
  }
  if (!confirm('해당 관리자의 권한을 회수하시겠습니까?')) return;
  try {
    await deleteDoc(doc(db, 'admins', uid));
    showMessage('회수되었습니다.', 'success');
  } catch (err) {
    console.error(err);
    showMessage('회수 실패: ' + err.message, 'error', 0);
  }
}

// ========== Invite URL 처리 ==========

(function checkInviteParam() {
  const params = new URLSearchParams(location.search);
  const code = params.get('invite');
  if (!code) return;
  validateInviteAndShow(code);
})();

async function validateInviteAndShow(code) {
  try {
    const snap = await getDoc(doc(db, 'inviteCodes', code));
    if (!snap.exists()) {
      showMessage('유효하지 않은 초대 코드입니다.', 'error', 0);
      return;
    }
    const data = snap.data();
    if (data.usedBy) {
      showMessage('이미 사용된 초대 코드입니다.', 'error', 0);
      return;
    }
    const exp = data.expiresAt?.toDate?.();
    if (exp && exp < new Date()) {
      showMessage('만료된 초대 코드입니다.', 'error', 0);
      return;
    }
    inviteFromUrl = code;
    if (!auth.currentUser) showSignup();
  } catch (err) {
    console.error(err);
    showMessage('초대 코드 검증 실패: ' + err.message, 'error', 0);
  }
}
