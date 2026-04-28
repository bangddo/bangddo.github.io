import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

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

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);