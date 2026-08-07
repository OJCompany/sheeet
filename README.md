# SHEEET 🎮

**설치도, 가입도, 앱도 없다. 링크를 열면 그 시트가 곧 게임방이다.**

구글 스프레드시트를 멀티플레이 게임 플랫폼으로 바꾼 프로젝트.
웹에서 게임을 고르면 방(=시트 파일들)이 만들어지고, 참가자는 링크만 열면
로그인 없이 바로 플레이한다.

🌐 **라이브 데모**: https://sheeet-zeta.vercel.app — 설치 없이 바로 체험 가능

| 게임 | 인원 | 방식 |
|---|---|---|
| ⚫ 오목 | 2 | 1인 1링크 · 턴 강제 · 실시간 판세 미터 |
| 🖼️ 픽셀 기억 그리기 | 2~6 | 정답 암기 → 따라 그리기 → 일치율 채점 |
| 🎭 라이어 게임 | 3~8 | 한 명만 제시어를 모른다 — 토론·투표 |
| 🌀 3D 미로 탈출 | 2 | 시트 셀로 1인칭 3D 렌더링, 탈출 경주 |
| 🏇 경마 | 제한 없음 | 한 링크 공유 · 베팅 후 레이스 관전 |
| 🧠 퀴즈쇼 | 제한 없음 | 구글 슬라이드 · 아바타를 끌어 정답 선택 |
| 🎴 섯다 (보너스) | 1 (+AI 1~4) | 엑셀 VBA 오프라인 게임 — 아래 [C. 엑셀 섯다](#c-엑셀-섯다-오프라인-보너스) |

## 시스템 구성

```
[웹 랜딩 (web/, Next.js)] ──POST /api/room──▶ [방 공장 (apps-script/, Google Apps Script 웹앱)]
                                                    │ 게임별로 인원수만큼 구글 시트 파일 생성
                                                    │ + 링크 공유 권한 + onEdit 트리거 등록
                                                    ▼
                                           [플레이어별 시트 = 게임판]  ← 참가자는 링크만 열면 됨
```

핵심 아이디어: **1인 1링크 = 신원**. 익명 사용자는 식별이 불가능하므로 플레이어마다
전용 파일을 만들고 링크 소지자 = 그 플레이어로 취급한다. 이 구조로 비밀 정보(라이어
제시어)와 턴 강제가 스프레드시트에서 구조적으로 가능해진다. 게임 로직은 전부 호스트
계정의 중앙 Apps Script 하나에서 돈다(게임판 파일에는 코드가 없다).

---

# 클린 설치 가이드

아무것도 설치되지 않은 새 컴퓨터 기준, 세 파트로 나뉜다.

- **A. 웹 프론트엔드** — Node.js만 있으면 어디서든 실행/빌드
- **B. 백엔드(방 공장)** — 구글 계정 필요, Apps Script에 배포
- **C. 엑셀 섯다** — Windows + 데스크톱 엑셀 필요 (오프라인 보너스 게임)

## 0. 공통 준비 — 런타임·도구 설치

### Node.js 20 이상 (파트 A·B 공통)

- **macOS**: `brew install node` (Homebrew가 없으면 https://brew.sh 의 한 줄 설치 먼저)
- **Windows**: https://nodejs.org 에서 LTS 인스톨러 다운로드 → 실행
- **Ubuntu/Debian**: `sudo apt update && sudo apt install -y nodejs npm`

설치 확인:

```bash
node -v    # v20 이상이면 OK (npm은 Node에 포함됨)
```

### 저장소 클론 (git이 없으면 GitHub의 "Download ZIP"으로 대체 가능)

```bash
git clone https://github.com/OJCompany/sheeet.git
cd sheeet
```

## A. 웹 프론트엔드 (web/) — 실행·빌드

### A-1. 의존성 설치

```bash
cd web
npm install
```

### A-2. 환경 변수

`web/.env.local` 파일을 만들고 방 공장 웹앱 URL을 넣는다
(파트 B를 완료하면 나오는 URL. 팀 운영 서버를 쓰려면 팀에 문의):

```
FACTORY_URL=https://script.google.com/macros/s/…웹앱ID…/exec
```

### A-3. 개발 서버 실행

```bash
npm run dev
# → http://localhost:3000 접속. 게임 카드 클릭 → 방 링크/QR이 나오면 전체 파이프라인 정상
```

### A-4. 프로덕션 빌드/실행

```bash
npm run build   # 컴파일 (Next.js 프로덕션 빌드)
npm run start   # 빌드 결과물 서빙 (기본 3000 포트)
```

배포는 Vercel 기준: `npm i -g vercel && vercel deploy --prod` (`web/` 디렉터리에서).

## B. 백엔드 "방 공장" (apps-script/) — 구글 Apps Script 배포

빌드 개념이 없는 서버리스 스크립트라서, "배포 = 코드를 구글에 올리고 웹앱으로 여는 것"이다.
호스트 1명의 구글 계정으로 1회만 하면 된다.

### B-1. 최초 세팅 (브라우저, 10분)

1. https://sheets.new 로 새 스프레드시트 생성 (관리용 "마스터 시트")
2. 메뉴 **확장 프로그램 → Apps Script** → 편집기에서 기본 코드 삭제
3. 이 레포의 `apps-script/room-factory.gs` 내용 전체를 붙여넣고 저장
4. 함수 드롭다운에서 `testCreateOmokRoom` 선택 → 실행 → 권한 승인
   ("확인되지 않은 앱" 경고는 **고급 → 이동 → 허용**. 본인이 방금 붙여넣은 코드라 정상)
5. 로그에 오목 방 링크 2개가 찍히면 엔진 정상

### B-2. 웹앱으로 열기 (프론트가 호출할 API)

1. 편집기 우상단 **배포 → 새 배포 → 유형: 웹 앱**
2. **실행 계정 = 나 / 액세스 권한 = 모든 사용자** → 배포
3. 나온 URL(`…/exec`)이 `FACTORY_URL` — 파트 A-2에 넣는다
4. 검증: 브라우저에서 `FACTORY_URL?game=omok&players=2` → 방 링크 JSON이 나오면 성공

### B-3. 빠른 시작 승인 (1회, 필수)

픽셀·경마의 장시간 연출은 스크립트가 자기 웹앱을 호출해 완주시킨다. 이 권한을 1회 승인:
편집기 함수 드롭다운 → `enableFastStart` 실행 → 승인. (안 하면 라운드 시작이 최대 90초 지연)

### B-4. 이후 코드 수정·재배포 (clasp CLI)

```bash
npm i -g @google/clasp
clasp login                       # 호스트 구글 계정으로 로그인
# https://script.google.com/home/usersettings 에서 Apps Script API 켜기 (1회)

cd apps-script
# .clasp.json의 scriptId를 본인 프로젝트 ID로 교체 (편집기 URL의 /projects/<ID>)
clasp push -f                     # 로컬 코드 반영
clasp deployments                 # 배포 ID 확인
clasp redeploy <배포ID> -d "설명"  # 웹앱 새 버전 (URL 유지)
```

퀴즈쇼(구글 슬라이드 게임)의 템플릿 등록 등 상세 운영법은 **[SETUP.md](SETUP.md)** 참고.

## C. 엑셀 섯다 (오프라인 보너스)

2~5인(나 + AI 1~4명) 화투 섯다. 콜/하프/따당/다이 베팅, 땡잡이·암행어사·구사 특수 규칙,
난이도 3종 AI. 상세 규칙은 [seotda/README.md](seotda/README.md).

### C-1. 실행 (빌드 불필요 — 완성 파일 동봉)

요구 사항: **Windows + 데스크톱 엑셀 2016 이상**

1. `seotda/섯다.xlsm` 을 엑셀에서 연다
2. 노란 보안 경고에서 **"콘텐츠 사용"** 클릭 (매크로 허용)
   - ZIP으로 받은 경우 파일이 차단될 수 있음: 파일 우클릭 → 속성 → **"차단 해제"** 체크.
     `git clone`으로 받으면 이 과정이 필요 없다
3. 타이틀 화면에서 인원(2~5인)·난이도(초급/중급/고급) 선택 → 플레이

### C-2. 소스에서 다시 빌드 (선택)

`seotda/build/vba/*.bas`(VBA 소스)에서 `섯다.xlsm`을 재생성하는 스크립트가 있다:

```powershell
# Windows PowerShell (엑셀 설치 필요, 관리자 권한 불필요)
cd seotda\build
powershell -ExecutionPolicy Bypass -File build.ps1
# 시트·도형 UI 생성 → VBA 모듈 주입 → 셀프테스트 실행 → 섯다.xlsm 저장·재오픈 검증
```

E2E 테스트: `powershell -ExecutionPolicy Bypass -File test-e2e.ps1`

## 저장소 구조

```
web/                    Next.js 랜딩 (게임 선택 → 방 생성 → 링크/QR) + 전면 셀 광고판
  app/page.js             랜딩 본체 (게임 카드 6종 + AdBackdrop)
  app/api/room/route.js   방 생성 프록시 (FACTORY_URL 호출, 장애 시 1회 재시도)
  app/api/ads/route.js    광고판 조회 프록시 (1분 캐시)
apps-script/            방 공장 + 시트 게임 5종 (clasp 프로젝트)
  room-factory.gs         전체 백엔드 (방 생성·게임 로직·웜풀·트리거)
  slides-quiz.gs          퀴즈쇼 (구글 슬라이드 템플릿에 설치)
seotda/                 엑셀 VBA 섯다 (오프라인) — 실행 파일 + VBA 소스 + 빌드 스크립트
SETUP.md                팀 운영 가이드 (배포·게임별 사용법·트러블슈팅 상세)
IDEA.md                 기획서
```
