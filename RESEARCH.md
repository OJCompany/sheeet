# 리서치 — 스프레드시트·협업툴에서의 게임 구현 사례 분석

> SHEEET의 "실시간 vs 턴제" 설계 판단을 위한 선행 사례 조사
> (다중 소스 웹리서치 + 팩트 검증, 21개 소스 / 25개 검증된 주장 기반)

---

## 🎯 한 줄 결론

> **스프레드시트(시트/엑셀)에서 문서화된 게임은 거의 전부 ①싱글플레이거나 ②턴제 멀티플레이다.
> "진짜 실시간 멀티플레이 + 자동 충돌 해결"은 오직 Figma 같은 전용 협업툴에서만 나타난다.**
> 이유: 구글 시트/Apps Script에는 저지연 푸시(push)가 없어서 클라이언트가 폴링해야 하고, 구조 자체가 턴제에 맞다.

**단, 중요한 반전:** 구글 시트의 **네이티브 공동편집은 셀 변경을 다른 사람에게 거의 실시간으로 전파**한다. 즉 링크만 공유하면 상대의 수(手)를 실시간으로 "본다". 문제는 게임 **로직·턴 심판(arbitration)**을 Apps Script 트리거로 처리할 때 (onEdit는 이벤트를 ~2개만 큐잉하고 빠른 입력은 버림) 고빈도 동시 입력을 안정적으로 순서 매길 수 없다는 것.

---

## 📋 사례별 분석

### A. 구글 시트 (Google Sheets)

| # | 사례 | 게임 | 실시간/턴제 | 동기화 기술 | 멀티 | 동시성 처리 |
|---|---|---|---|---|---|---|
| 1 | **eieio.games 실시간 시트** ⭐ | 타이밍 퍼즐 | **실시간** | 순수 수식만! (반복계산 + 자기참조 순환식 + NOW()) | ❌ 싱글 | 해당 없음 (싱글) |
| 2 | **Kieran Dixon — Connect 4** | 사목(커넥트4) | 턴제 | `onEdit(e)` 트리거, 체크박스 틱 | ✅ 2인 | 턴 교대 (수동) |
| 3 | **freeCodeCamp — Tic-Tac-Toe** | 틱택토 | 턴제 | Data Validation 드롭다운 + 버튼→Apps Script | ✅ 2인 | onEdit/폴링 없이 수동 턴 |
| 4 | **gamepyong — Sheets as DB** | 브라우저 멀티게임 | 턴제 권장 | 읽기=Sheetrock(Visualization Query), 쓰기=Apps Script `doPost` | ✅ | **클라이언트 주기적 폴링** (푸시 없음) |

**핵심 디테일:**
- **①번(eieio)**: 서버·WebSocket·Firebase 없이 **스프레드시트 수식만으로 실시간**을 낸 놀라운 사례. "반복 계산(최대 1회)"을 켜고 셀이 자기 자신을 참조하게 해서 `NOW()`를 딱 한 번 캡처·고정. 단 **싱글플레이 타이밍 게임 한정**, 멀티/동시성 해결 아님. 가끔 새로고침을 위해 수동 편집이 필요한 한계.
- **④번(gamepyong)**: 시트를 DB로 쓴 구조. 블로그가 직접 *"이런 셋업은 턴제 멀티플레이에 잘 맞는다"*, *"클라이언트는 시트를 주기적으로 폴링해야 한다"*고 명시.

### B. 엑셀 (Excel / VBA)

| # | 사례 | 게임 | 실시간/턴제 | 기술 | 멀티 |
|---|---|---|---|---|---|
| 5 | **SUNJIANZHI/Excel-Game** | 2048·지뢰찾기·스네이크·스도쿠·테트리스·틱택토 | 혼합 | VBA `.xlsm`, 외부 서버 없음 | ❌ 전부 싱글 (틱택토는 로컬 핫시트) |
| 6 | **Doom.xls (C Bel)** ⭐ | 1인칭 3D 레이캐스팅 (둠류) | 실시간(로컬) | **수식만으로 픽셀 단위 렌더**(조건부 서식 색 그라데이션), VBA는 키입력만 | ❌ 싱글 |
| 7 | **RPG-Excel / Cary Walkin VBA Arena** | 턴제 RPG | 턴제 | VBA, 셀=지형/맵, 셀 값=게임 상태(HP·퀘스트·전투) | ❌ 싱글 |
| 8 | **오빠두 — 엑셀 VBA 마리오** (한국어) | 액션 마리오 | 실시간(로컬) | Range 이동·Offset, KeyPressAPI 입력, DoEvents 프레임 제어, MP3 효과음 | ❌ 싱글 |

→ 엑셀 게임은 **전부 로컬 싱글플레이**. 네트워킹·링크공유 플레이 없음. "셀을 게임 캔버스로 쓴다"는 발상의 풍부한 선례이자, 동시에 **멀티플레이는 아무도 못 했다**는 공백을 보여줌.

### C. 협업 캔버스 툴 (Figma / FigJam) — 유일한 "진짜 실시간 멀티"

| # | 사례 | 게임 | 실시간/턴제 | 동기화 기술 | 동시성 처리 |
|---|---|---|---|---|---|
| 9 | **Figma Chess 위젯** | 체스 | 실시간 상태동기 | `useSyncedState`/`useSyncedMap` (Figma 네이티브 멀티플레이 인프라) | 개발자 서버 불필요 |
| 10 | **FigJam Tic-Tac-Toe 위젯** | 틱택토 (2명+ 지원) | 실시간 상태동기 (로직은 턴제) | 게임 상태가 파일 안에 살고, 커서처럼 동기화 | 위와 동일 |
| 11 | **Figma 멀티플레이 엔진 (공식 블로그)** ⭐ | (기반 기술) | 실시간 | **클라이언트/서버 + WebSocket, 문서당 서버 프로세스 1개** | **Last-Writer-Wins** (서버가 이벤트 순서 정의 → 타임스탬프 불필요, 병합 없이 하나의 값만 채택) |

**핵심:** Figma는 위젯 개발자가 서버를 안 짜도 됨. 플랫폼이 커서·편집을 동기화하는 그 **네이티브 실시간 인프라**에 게임 상태를 얹음. 같은 속성에 동시 편집이 나면 `AB` 또는 `BC`처럼 **제출된 값 중 하나**만 남고 절대 병합(`ABC`)되지 않음. → SHEEET가 "진짜 실시간 충돌안전 멀티"를 원하면 **이 아키텍처를 직접 복제**해야 함(= Firebase 등).

---

## 🧭 SHEEET에 주는 교훈 (핵심)

1. **아무도 구글 시트에서 "진짜 동시 실시간 멀티 + 견고한 충돌해결"을 문서화하지 못했다.** → 이 공백 자체가 기회이자 경고. 심사에서 "왜 아무도 안 했나"에 답할 수 있어야 함.

2. **네이티브 공동편집은 이미 준-실시간이다.** 링크 공유 → 상대 수를 실시간으로 봄. "실시간 관전/보드 미러링"은 별도 기술 없이 시트 그대로 가능. (REALTIME.md의 하이브리드 관전 모드와 일치)

3. **게임 로직·턴 심판은 턴제로 가라.** Apps Script `onEdit`는 빠른 연속 입력을 흘리고(~2개만 큐잉), `onSelectionChange`는 2초 스로틀, Drive watch 웹훅은 ~3분 지연, 구글 Realtime API는 2019년 폐지됨. **고빈도 동시 입력을 시트 트리거로 순서 매기는 건 불가능.**

4. **수식만으로도 실시간 "느낌"은 낼 수 있다** (eieio/Doom.xls) — 단 **싱글플레이 타이밍/렌더링 한정**. 멀티 동시성은 이걸로 못 푼다.

5. **진짜 실시간 멀티가 필요하면 Figma 모델을 복제** = 클라이언트↔외부 실시간 DB(Firebase Realtime DB)로 WebSocket 동기화 + Last-Writer-Wins. (REALTIME.md의 옵션 A/B와 정확히 일치)

### → 설계 결론
```
게임 종류별로 나눠서:
 · 턴제(오목·빙고·틱택토·사목)  → 순수 구글 시트 + onEdit만으로 충분. "무설치 링크플레이" 컨셉 100% 보존
 · 실시간(픽셀맞히기·타자·워들) → HTML+Firebase 하이브리드 (Figma식 LWW), 시트는 로비/관전/보스키
```
IDEA.md의 "폴링 지연을 설계 조건으로 받아들여 턴제에 최적화" 판단은 **선례상 정확히 옳다**. MVP 대표게임(오목·빙고·지뢰찾기)은 전부 턴제/싱글이라 순수 시트로 구현 가능 → 실시간은 차별화 게임에만 선택적으로.

---

## ❓ 아직 확인 못 한 열린 질문

1. 구글 시트 네이티브 공동편집의 **실측 end-to-end 지연**은? (A의 셀 편집 → B에게 보이기까지 sub-second인가?)
2. **같은 셀을 두 명이 동시 편집**하면 구글은 어떻게 처리하나? (Figma처럼 LWW? 하나 조용히 드롭?) → SHEEET가 이걸 활용할지 피할지 결정 필요
3. 링크 즉시플레이 모델의 **실용 상한**: 시트당 최대 동시 편집자 수, Apps Script 할당량, 셀당 편집 처리량 → 플레이어 수·입력 빈도 한계

---

## 📚 주요 소스

- eieio.games — 실시간 구글시트: https://eieio.games/blog/realtime-google-sheet/
- Tyler Robertson — 수식만으로 시트 게임: https://blog.atylerrobertson.com/read/make-video-games-in-google-sheets-using-only-built-in-functions-(part-1)
- freeCodeCamp — Apps Script 틱택토: https://www.freecodecamp.org/news/learn-google-apps-script-basics-by-building-tic-tac-toe/
- Kieran Dixon — Connect 4 (YouTube): https://www.youtube.com/watch?v=YkMlKqXzfGc
- gamepyong — Sheets 멀티플레이 백엔드: http://gamepyong.blogspot.com/2017/08/multiplayer-games-using-google-sheets.html
- SUNJIANZHI/Excel-Game (6종 VBA): https://github.com/SUNJIANZHI/Excel-Game
- Doom.xls 소개: https://www.gamedeveloper.com/design/3d-engine-entirely-made-of-ms-excel-formulae-enjoy-this-doom-xls-file-
- Figma 멀티플레이 기술 (공식): https://www.figma.com/blog/how-figmas-multiplayer-technology-works/
- Figma Chess 위젯: https://www.figma.com/community/widget/1032204675316247617/chess
- FigJam Tic-Tac-Toe 위젯: https://www.figma.com/community/widget/1024713306526703527/tic-tac-toe
- 오빠두 — 엑셀 VBA 마리오(한국어): https://www.oppadu.com/엑셀-vba-게임-만들기-마리오-완성/
- johngrib — 엑셀 스네이크(한국어): https://johngrib.github.io/wiki/article/excel-snake-game/

> ⚠️ 한계: gamepyong·엑셀 RPG는 단일 블로그 소스 + 일부 "턴제" 추론 포함. 일부 Figma URL은 로그인 게이트(403)로 검색스니펫·공식문서로 교차검증. 트리거 제한 수치는 2026년 기준이며 구글이 바꿀 수 있음.
