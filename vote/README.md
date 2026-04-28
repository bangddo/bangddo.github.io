# 투표 솔루션

GitHub Pages + Firebase Firestore 로 동작하는 정적 투표 시스템.

- `index.html`: 유권자 — 진행 중인 투표 목록을 보고 인증번호(전화번호)로 투표
- `manage.html`: 관리자 — 투표 등록/수정/삭제/결과 조회

## 동작 방식 요약

- 관리자가 투표 등록 시 대상자 전화번호 목록을 입력하면, 클라이언트에서 SHA-256 해시로 변환되어 저장됩니다 (평문 저장 안 함)
- 유권자는 자신의 전화번호를 입력 → 해시 일치 + 미투표 + 투표 기간 내 일 때만 표 작성
- 투표 기록(`ballots/{phoneHash}`)은 **관리자만 읽기 가능**, 일반 사용자는 자기 ballot 만들기만 가능
- `isAnonymous=true` 투표도 phoneHash가 ballot 문서 ID에 남지만, Firestore Rules로 비관리자의 read를 차단하므로 외부에 노출되지 않습니다

## 세팅

### 1. Firebase 프로젝트 생성

1. https://console.firebase.google.com 에서 프로젝트 생성 (Spark 무료 플랜으로 충분)
2. 좌측 **Build > Firestore Database** → "데이터베이스 만들기" → **production 모드** → 지역 선택
3. 좌측 **Build > Authentication** → "시작하기" → **Email/Password** 제공업체 활성화
4. 우측 상단 톱니바퀴 → **프로젝트 설정** → 하단 "내 앱"에서 **웹 앱(`</>`)** 추가 → 표시되는 `firebaseConfig` 값을 복사

### 2. 코드에 config 붙여넣기

`js/firebase-config.js` 의 `firebaseConfig` 객체를 위에서 복사한 값으로 교체.

> 이 값들은 공개되어도 안전합니다 — 보안은 Firestore Rules / Auth 가 담당.

### 3. 보안 규칙 배포

**옵션 A — Firebase 콘솔에서 직접 붙여넣기**

1. **Firestore Database > 규칙** 탭
2. `firestore.rules` 내용을 복사해서 붙여넣고 **게시**

**옵션 B — Firebase CLI**

```bash
npm install -g firebase-tools
firebase login
firebase init firestore   # 기존 firestore.rules 사용 선택
firebase deploy --only firestore:rules
```

### 4. 관리자 계정 생성 + 권한 부여

1. **Firebase 콘솔 > Authentication > Users** 에서 "사용자 추가" → 이메일/비밀번호 입력해서 관리자 계정 생성
2. 관리자 권한(custom claim `admin: true`)은 콘솔 UI에 없어서 한 번만 스크립트로 부여해야 합니다:

   ```bash
   # 프로젝트 루트에서
   npm install firebase-admin
   ```

   `set-admin.js` 파일을 임시로 만들고:

   ```js
   const admin = require('firebase-admin');
   const serviceAccount = require('./service-account.json'); // 콘솔에서 다운로드
   admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

   const email = process.argv[2];
   admin.auth().getUserByEmail(email)
     .then(user => admin.auth().setCustomUserClaims(user.uid, { admin: true }))
     .then(() => { console.log('admin 권한 부여 완료'); process.exit(0); })
     .catch(err => { console.error(err); process.exit(1); });
   ```

   서비스 계정 키 다운로드: **프로젝트 설정 > 서비스 계정 > 새 비공개 키 생성** → `service-account.json` 으로 저장

   ```bash
   node set-admin.js admin@example.com
   ```

   완료 후 `service-account.json` 과 `set-admin.js` 는 삭제하거나 `.gitignore` 에 추가.

3. 관리자가 `manage.html` 에 처음 로그인할 때 토큰이 갱신되며 권한이 적용됩니다 (필요 시 한 번 로그아웃 후 재로그인).

### 5. GitHub Pages 배포

1. 이 디렉토리 전체를 GitHub 저장소에 push
2. **Settings > Pages** → Source: `main` 브랜치 `/` 루트 선택 → 저장
3. 발급된 도메인(`https://USER.github.io/REPO/`)을 Firebase 콘솔의 **Authentication > Settings > Authorized domains** 에 추가

## 로컬 개발

브라우저는 `file://` 에서 ES module import 를 거부하므로 정적 서버 필요:

```bash
# Python 3
python -m http.server 8000

# 또는 Node
npx serve .
```

`http://localhost:8000` 접속 후 `localhost` 가 Firebase Authorized domains 에 기본 포함되어 있는지 확인.

## 주의 / 한계

- **전화번호 보안**: 10~11자리 숫자라 이론상 brute force 가능. 소규모(친목/사내) 용도로 적합. 외부 공개 투표라면 Firebase Auth 의 SMS OTP 도입 필요(유료)
- **수정 제한**: 이미 투표가 1건이라도 들어온 후에는 항목(items) 수정이 비활성화됩니다 (결과 왜곡 방지). 제목/대상자 수정은 가능
- **시간 신뢰성**: Firestore Rules의 `request.time` 으로 서버측 검증. 클라이언트 시계 조작해도 투표 차단됨
- **삭제 시 ballots 정리**: 클라이언트에서 batch delete (400개 단위 페이지네이션). 매우 많은 투표가 있다면 Cloud Function 으로 옮기는 게 안전

## 파일 구조

```
index.html               유권자 화면
manage.html              관리자 화면
css/style.css            공통 스타일
js/firebase-config.js    Firebase 초기화 (config 교체 필요)
js/util.js               해시/시간/포맷 유틸
js/index.js              유권자 화면 로직
js/manage.js             관리자 화면 로직
firestore.rules          Firestore 보안 규칙 (콘솔에 배포)
```
