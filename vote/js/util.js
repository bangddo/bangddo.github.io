export function normalizePhone(raw) {
  return String(raw ?? '').replace(/\D/g, '');
}

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateInviteCode(length = 8) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  }
  return out;
}

export async function sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashPhone(raw) {
  const normalized = normalizePhone(raw);
  if (!normalized) return '';
  return sha256Hex(normalized);
}

export async function hashPhoneList(text) {
  const lines = String(text ?? '')
    .split(/[\n,;]/)
    .map(s => normalizePhone(s))
    .filter(Boolean);
  const unique = [...new Set(lines)];
  return Promise.all(unique.map(sha256Hex));
}

export function attachDigitFilter(el, { allowSeparators = false } = {}) {
  const re = allowSeparators ? /[^0-9\n,;]/g : /\D/g;
  el.addEventListener('input', () => {
    const before = el.value;
    const caret = el.selectionStart ?? before.length;
    const after = before.replace(re, '');
    if (after === before) return;
    const newCaret = before.slice(0, caret).replace(re, '').length;
    el.value = after;
    try { el.setSelectionRange(newCaret, newCaret); } catch {}
  });
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function formatDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function toLocalInputValue(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function fromLocalInputValue(value) {
  if (!value) return null;
  return new Date(value);
}

export function voteStatus(vote, now = new Date()) {
  const start = vote.startAt?.toDate ? vote.startAt.toDate() : new Date(vote.startAt);
  const end = vote.endAt?.toDate ? vote.endAt.toDate() : new Date(vote.endAt);
  if (now < start) return 'upcoming';
  if (now > end) return 'ended';
  return 'active';
}

export function statusLabel(status) {
  return { upcoming: '예정', active: '진행중', ended: '종료' }[status] ?? status;
}

export function formatRemaining(target, now = new Date()) {
  const t = target?.toDate ? target.toDate() : new Date(target);
  const diff = t.getTime() - now.getTime();
  if (diff <= 0) return '종료됨';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}분 남음`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 ${mins % 60}분 남음`;
  const days = Math.floor(hours / 24);
  return `${days}일 ${hours % 24}시간 남음`;
}
