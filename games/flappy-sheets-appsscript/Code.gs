/**
 * SHEEET · 셀 플래피 — 구글 시트 안에서 실행 (Apps Script HtmlService)
 * ------------------------------------------------------------------
 * 게임은 시트 위에 뜨는 모달 다이얼로그(HTML 패널) 안에서 60fps로 렌더링된다.
 * 패널 안 클라이언트 JS가 직접 렌더링하므로 부드럽다 —
 * (진짜 시트 셀을 Apps Script로 직접 그리면 재계산·서버왕복 때문에 1~2fps로 끊긴다.
 *  그래서 셀 액션게임은 "패널 렌더"가 정답. RESEARCH.md / REALTIME.md 참고.)
 *
 * 설치: 확장 프로그램 > Apps Script 에서
 *   1) 이 파일(Code.gs) 내용 붙여넣기
 *   2) [+] > HTML 파일 추가 → 이름 'Game' → Game.html 내용 붙여넣기
 *   3) 저장 후 시트 새로고침 → 메뉴 [🎮 SHEEET > 셀 플래피 실행]
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🎮 SHEEET')
    .addItem('셀 플래피 실행 🐤', 'openFlappy')
    .addToUi();
}

function openFlappy() {
  var html = HtmlService.createHtmlOutputFromFile('Game')
    .setWidth(680)
    .setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, 'SHEEET · 셀 플래피');
}
