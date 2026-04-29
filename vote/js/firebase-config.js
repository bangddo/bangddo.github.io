import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeAppCheck, ReCaptchaV3Provider } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js';

// TODO: Firebase 콘솔 → 프로젝트 설정 → 내 앱 → Web 앱 → SDK 설정에서 복사한 값으로 교체
const firebaseConfig = {
  apiKey: "AIzaSyD55b1dcUwgSo_XAGZRQaXFda0uvIfqZ-k",
  authDomain: "bangddo-vote.firebaseapp.com",
  projectId: "bangddo-vote",
  storageBucket: "bangddo-vote.firebasestorage.app",
  messagingSenderId: "42727234944",
  appId: "1:42727234944:web:53ff0ab38a660263a83565",
  measurementId: "G-45TG7PXBJF"
};

// App Check (brute-force / 무단 호출 방지) 설정 절차:
// 1) https://www.google.com/recaptcha/admin/create 에서 v3 사이트 키 발급
//    (도메인: bangddo.github.io, localhost / 라벨: bangddo-vote)
// 2) Firebase 콘솔 → 프로젝트 설정 → App Check → 웹 앱 등록 → reCAPTCHA v3 공급자 + 비밀 키 등록
// 3) 아래 APP_CHECK_SITE_KEY에 v3 "사이트 키"(공개 키) 입력
// 4) Firebase 콘솔 → App Check → API → Cloud Firestore에서 처음에는 "모니터링" 모드로 1주일 운영
//    후 정상 사용자 차단이 없으면 "강제(Enforce)"로 전환
const APP_CHECK_SITE_KEY = ''; // ← reCAPTCHA v3 사이트 키를 여기에 입력하면 활성화됨

export const app = initializeApp(firebaseConfig);

const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
if (APP_CHECK_SITE_KEY && !isLocal) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
}

export const db = getFirestore(app);
export const auth = getAuth(app);