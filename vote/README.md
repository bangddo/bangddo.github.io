# 투표 솔루션

GitHub Pages + Firebase Firestore 로 동작하는 정적 투표 시스템.

- `index.html`: 유권자 — 진행 중인 투표 목록을 보고 인증번호로 투표
- `manage.html`: 관리자 — 투표 등록/수정/삭제/결과 조회

## 동작 방식 요약

- 관리자가 투표 등록 시 대상자 인증번호 목록을 입력하면, 클라이언트에서 SHA-256 해시로 변환되어 저장됩니다 (평문 저장 안 함)
- 유권자는 자신의 인증번호를 입력 → 해시 일치 + 미투표 + 투표 기간 내 일 때만 표 작성
- 투표 기록(`ballots/{phoneHash}`)은 **관리자만 읽기 가능**, 일반 사용자는 자기 ballot 만들기만 가능
- `isAnonymous=true` 투표도 phoneHash가 ballot 문서 ID에 남지만, Firestore Rules로 비관리자의 read를 차단하므로 외부에 노출되지 않습니다
- **공개 여부**(`isPublic`): 체크 해제 시 유권자 화면(`index.html`)에서 보이지 않고 투표 제출도 차단됨. 관리자만 read/edit 가능 (초안/예약용)

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
firebase deploy --only firestore:rules,firestore:indexes
```

> `firestore.indexes.json` 에 `(isPublic, endAt)` 복합 인덱스가 정의되어 있습니다. 콘솔로만 작업하는 경우, 처음 `index.html` 열었을 때 콘솔에 뜨는 `The query requires an index. You can create it here: ...` 링크를 클릭하면 자동 생성됩니다.

### 4. 첫 관리자 부트스트랩 (1회만 수동, 이후는 UI에서 초대로 추가)

관리자 권한은 Firestore `admins/{uid}` 문서로 관리됩니다. **첫 관리자**만 콘솔에서 수동 작성하고, 이후 신규 관리자는 manage.html UI에서 초대 코드로 가입을 받을 수 있습니다.

1. **Firebase 콘솔 > Authentication > Users** 에서 "사용자 추가" → 이메일/비밀번호 입력해서 첫 관리자 계정 생성
2. 생성된 사용자의 **UID 복사** (Authentication > Users 목록에 표시됨)
3. **Firestore Database > Data** 탭에서 컬렉션 시작:
   - 컬렉션 ID: `admins`
   - 문서 ID: 위에서 복사한 UID
   - 필드:
     - `email` (string) — 해당 관리자 이메일
     - `grantedAt` (timestamp) — 현재 시각
4. 저장 → `manage.html` 접속 → 로그인하면 정상 동작

> **주의**: 1~3 단계를 마친 **후에** `firestore.rules` 를 배포하세요. 룰을 먼저 배포하면 admins 컬렉션이 비어 있어 모든 관리자 동작이 거부되는 lockout 상태가 됩니다.

### 4-1. 신규 관리자 추가 (UI 사용)

첫 관리자 진입 후에는 manage.html 에서 다음 흐름으로 추가 관리자를 가입시킬 수 있습니다:

1. 관리자가 좌측 사이드바의 **관리자/초대 코드 열기** 클릭
2. **+ 초대 코드 생성** → 8자리 코드와 URL 이 클립보드에 자동 복사됨
3. 가입 희망자에게 URL 전달 (`https://.../manage.html?invite=XXXXXXXX`)
4. 가입 희망자가 URL 진입 → 이메일/비밀번호 입력해서 가입 신청
5. 관리자 화면 **가입 요청** 섹션에 실시간으로 표시됨 → **승인** 클릭
6. 가입 희망자 화면이 자동으로 관리자 메인으로 전환됨

초대 코드는 7일 후 만료, 1회만 사용 가능. **권한 회수**는 동일 화면 **현재 관리자** 섹션에서 가능 (자기 자신 회수는 차단).

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

- **인증번호 보안**: 10~11자리 숫자라 이론상 brute force 가능. 소규모(친목/사내) 용도로 적합. 외부 공개 투표라면 Firebase Auth 의 SMS OTP 도입 필요(유료)
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
