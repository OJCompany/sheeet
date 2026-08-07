# SHEEET 🎮

> **설치도, 가입도, 앱도 없다. 링크를 열면 그 시트가 곧 게임방이다.**

구글 스프레드시트를 **멀티플레이 게임 플랫폼**으로 바꾼 프로젝트.
웹에서 게임을 고르면 방(=시트 파일들)이 만들어지고, 참가자는 **링크만 열면 로그인 없이 바로 플레이**한다.

<br>

> ### 🌐 지금 바로 체험 → **https://sheeet-zeta.vercel.app**
> 아무 설치 없이 됩니다. 게임 카드 클릭 → 나온 링크를 친구에게 → 끝.

<br>

## 🕹️ 게임 목록

| | 게임 | 인원 | 한 줄 소개 |
|---|---|---|---|
| ⚫ | **오목** | 2 | 1인 1링크 · 턴 강제 · 실시간 판세 미터 |
| 🖼️ | **픽셀 기억 그리기** | 2~6 | 정답 암기 → 따라 그리기 → 일치율 채점 |
| 🎭 | **라이어 게임** | 3~8 | 한 명만 제시어를 모른다 — 토론·투표 |
| 🌀 | **3D 미로 탈출** | 2 | 시트 셀로 1인칭 3D 렌더링, 탈출 경주 |
| 🏇 | **경마** | 무제한 | 한 링크 공유 · 베팅 후 레이스 관전 |
| 🧠 | **퀴즈쇼** | 무제한 | 구글 슬라이드 · 아바타를 끌어 정답 선택 |
| 🎴 | **섯다** (보너스) | 1 (+AI 1~4) | 엑셀 VBA 오프라인 게임 → [파트 C](#c-엑셀-섯다--오프라인-보너스) |

## 🧩 어떻게 동작하나

```
[웹 랜딩 (web/, Next.js)]
        │  게임 선택 → POST /api/room
        ▼
[방 공장 (apps-script/, Google Apps Script 웹앱)]
        │  인원수만큼 구글 시트 파일 생성
        │  + 링크 공유 권한 + onEdit 트리거 등록
        ▼
[플레이어별 시트 = 게임판]   ← 참가자는 링크만 열면 됨
```

**핵심 아이디어 — 1인 1링크 = 신원.**
익명 사용자는 누가 편집했는지 식별할 수 없다(구글 한계). 그래서 플레이어마다 전용
파일을 만들고 **링크 소지자 = 그 플레이어**로 취급한다. 이 구조 덕분에 스프레드시트에서
비밀 정보(라이어 제시어)와 턴 강제가 가능해진다. 게임 로직은 전부 호스트 계정의
중앙 Apps Script 하나에서 돌고, 게임판 파일에는 코드가 없다.

<br>

---

# 🛠️ 클린 설치 가이드

**아무것도 설치되지 않은 새 컴퓨터** 기준. 목적에 맞는 파트만 골라 진행하면 된다.

| 하고 싶은 것 | 필요한 파트 | 필요한 것 |
|---|---|---|
| 그냥 체험 | 없음 — [라이브 데모](https://sheeet-zeta.vercel.app) | 브라우저 |
| 웹을 내 컴퓨터에서 실행/빌드 | [0](#0-공통-준비--런타임-설치) → [A](#a-웹-프론트엔드-web) | Node.js |
| 백엔드까지 처음부터 전부 재현 | [0](#0-공통-준비--런타임-설치) → [B](#b-백엔드-방-공장-apps-script) → [A](#a-웹-프론트엔드-web) | Node.js + 구글 계정 |
| 엑셀 섯다 플레이/빌드 | [C](#c-엑셀-섯다--오프라인-보너스) | Windows + 엑셀 |

<br>

## 0. 공통 준비 — 런타임 설치

**Node.js 20 이상** (파트 A·B 공통):

| OS | 설치 명령 |
|---|---|
| macOS | `brew install node` (Homebrew가 없으면 https://brew.sh 먼저) |
| Windows | https://nodejs.org → LTS 인스톨러 실행 |
| Ubuntu/Debian | `sudo apt update && sudo apt install -y nodejs npm` |

```bash
node -v          # v20 이상이면 OK (npm은 Node에 포함)
```

**저장소 받기** (git이 없으면 GitHub의 Download ZIP도 가능):

```bash
git clone https://github.com/OJCompany/sheeet.git
cd sheeet
```

<br>

## A. 웹 프론트엔드 (`web/`)

### ① 설치 → ② 환경 변수 → ③ 실행

```bash
cd web
npm install                              # ① 의존성 설치
echo "FACTORY_URL=<방 공장 웹앱 URL>" > .env.local   # ② 파트 B에서 얻는 URL
npm run dev                              # ③ http://localhost:3000
```

게임 카드 클릭 → 방 링크/QR이 나오면 전체 파이프라인 정상.

### 프로덕션 빌드

```bash
npm run build    # 컴파일 (Next.js 프로덕션 빌드)
npm run start    # 빌드 결과물 서빙 (기본 3000 포트)
```

배포(Vercel 기준): `npm i -g vercel && vercel deploy --prod` — `web/` 디렉터리에서.

<br>

## B. 백엔드 "방 공장" (`apps-script/`)

서버리스 Apps Script라 별도 컴파일이 없다. **배포 = 코드를 구글에 올리고 웹앱으로 여는 것.**
호스트 1명의 구글 계정으로 1회만 하면 된다. (모든 게임방이 이 계정의 드라이브에 생성됨)

### B-1. 코드 올리기 (브라우저, 10분)

1. https://sheets.new 로 새 스프레드시트 생성 — 관리용 "마스터 시트"
2. 메뉴 **확장 프로그램 → Apps Script** → 편집기의 기본 코드 삭제
3. 이 레포의 `apps-script/room-factory.gs` **내용 전체를 붙여넣고 저장**
4. 함수 드롭다운에서 `testCreateOmokRoom` 선택 → **실행** → 권한 승인
5. 로그에 오목 방 링크 2개가 찍히면 엔진 정상

> 💡 4번에서 "확인되지 않은 앱" 경고가 떠도 정상 (방금 본인이 붙여넣은 코드라서).
> **고급 → 이동 → 허용** 으로 진행하면 된다.

### B-2. 웹앱으로 열기 — 프론트가 호출할 API

1. 편집기 우상단 **배포 → 새 배포 → 유형: 웹 앱**
2. **실행 계정 = 나** / **액세스 권한 = 모든 사용자** → 배포
3. 나온 `…/exec` URL이 **`FACTORY_URL`** → 파트 A의 ②에 넣는다

```bash
# 검증 — 방 링크 JSON이 나오면 성공
curl -sL "<FACTORY_URL>?game=omok&players=2"
```

### B-3. 빠른 시작 승인 (1회, 필수)

편집기 함수 드롭다운 → **`enableFastStart`** 실행 → 승인.
픽셀·경마의 장시간 연출을 스크립트가 자기 웹앱 호출로 완주시키는 권한이다.
(생략 시 게임은 되지만 라운드 시작이 최대 90초 지연)

### B-4. 이후 코드 수정·재배포 — clasp CLI

```bash
npm i -g @google/clasp
clasp login                        # 호스트 구글 계정으로 로그인
# 1회: https://script.google.com/home/usersettings 에서 Apps Script API 켜기

cd apps-script
# .clasp.json의 scriptId를 본인 프로젝트 ID로 교체 (편집기 URL의 /projects/<ID>)
clasp push -f                      # 로컬 코드 반영
clasp deployments                  # 배포 ID 확인
clasp redeploy <배포ID> -d "설명"   # 웹앱 새 버전 (URL은 유지됨)
```

> 📗 퀴즈쇼(슬라이드 게임) 템플릿 등록, 게임별 사용법, 트러블슈팅은 **[SETUP.md](SETUP.md)** 에 따로 정리돼 있다.

<br>

## C. 엑셀 섯다 — 오프라인 보너스

2~5인(나 + AI 1~4명) 화투 섯다. 콜/하프/따당/다이 베팅, 땡잡이·암행어사·구사 특수 규칙,
난이도 3종 AI. 상세 규칙: [seotda/README.md](seotda/README.md)

### 실행 — 빌드 불필요 (완성 파일 동봉)

**요구 사항: Windows + 데스크톱 엑셀 2016 이상**

1. `seotda/섯다.xlsm` 을 엑셀에서 연다
2. 노란 보안 경고에서 **"콘텐츠 사용"** 클릭 (매크로 허용)
3. 타이틀 화면에서 인원(2~5인)·난이도(초급/중급/고급) 선택 → 플레이

> 💡 ZIP으로 받았다면 Windows가 파일을 차단할 수 있다:
> 파일 우클릭 → 속성 → **"차단 해제"** 체크. `git clone`으로 받으면 이 과정이 없다.

### 소스에서 다시 빌드 (선택)

VBA 소스(`seotda/build/vba/*.bas`)에서 `섯다.xlsm`을 재생성:

```powershell
cd seotda\build
powershell -ExecutionPolicy Bypass -File build.ps1
# 시트·도형 UI 생성 → VBA 모듈 주입 → 셀프테스트 → 섯다.xlsm 저장·재오픈 검증

powershell -ExecutionPolicy Bypass -File test-e2e.ps1   # E2E 테스트
```

<br>

---

## 📁 저장소 구조

```
web/                    Next.js 랜딩 (게임 선택 → 방 생성 → 링크/QR) + 전면 셀 광고판
  app/page.js             랜딩 본체 (게임 카드 6종 + AdBackdrop 광고판)
  app/api/room/route.js   방 생성 프록시 (FACTORY_URL 호출, 장애 시 1회 재시도)
  app/api/ads/route.js    광고판 조회 프록시 (1분 캐시)
apps-script/            방 공장 + 시트 게임 5종 (clasp 프로젝트)
  room-factory.gs         전체 백엔드 (방 생성 · 게임 로직 · 웜풀 · 트리거)
  slides-quiz.gs          퀴즈쇼 (구글 슬라이드 템플릿에 설치)
seotda/                 엑셀 VBA 섯다 (오프라인) — 실행 파일 + VBA 소스 + 빌드 스크립트
SETUP.md                팀 운영 가이드 (배포 · 게임별 사용법 · 트러블슈팅)
IDEA.md                 기획서
```
