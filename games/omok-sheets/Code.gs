/**
 * SHEEET · 오목 (Gomoku) — 구글 시트 네이티브 / 턴제
 * ------------------------------------------------------------------
 * 순수 Google Sheets + Apps Script(onEdit)만으로 동작하는 2인 대전 오목.
 * 링크만 공유하면(편집 권한) 두 사람이 같은 시트에서 번갈아 둔다.
 * 구글 공동편집이 상대의 수(手)를 준-실시간으로 전파하므로 서버가 필요 없다.
 *
 * 규칙: 빈 칸을 클릭 → 아무 키나 입력 후 Enter → 현재 차례의 돌이 놓인다.
 *       가로/세로/대각선 5목 완성 시 승리.
 *
 * 설치: 확장 프로그램 > Apps Script 에 이 코드를 붙여넣고 저장 → 시트로 돌아와
 *       메뉴 [🎮 SHEEET > 새 게임]을 누르면 오목판이 생성된다.
 */

// ── 설정 ────────────────────────────────────────────────────────────
var BOARD = { startRow: 2, startCol: 2, size: 15 }; // B2 기준 15×15
var BLACK = '●'; // ●
var WHITE = '○'; // ○
var STATUS_CELL = 'R2'; // 현재 차례 / 결과 표시
var TURN_CELL   = 'R3'; // 턴 카운터(숫자, 짝수=흑 차례)

// ── 메뉴 ────────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🎮 SHEEET')
    .addItem('새 게임 (오목판 생성)', 'setupGame')
    .addToUi();
}

// ── 새 게임: 오목판 그리기 ──────────────────────────────────────────
function setupGame() {
  var sh = SpreadsheetApp.getActiveSheet();
  sh.clear();

  var sr = BOARD.startRow, sc = BOARD.startCol, n = BOARD.size;
  var board = sh.getRange(sr, sc, n, n);
  board.setBackground('#f6e7c1'); // 나무결 느낌
  board.setBorder(true, true, true, true, true, true, '#b58b4c', SpreadsheetApp.BorderStyle.SOLID);
  board.setHorizontalAlignment('center').setVerticalAlignment('middle');
  board.setFontSize(14).clearContent();

  // 셀을 정사각형에 가깝게
  for (var c = sc; c < sc + n; c++) sh.setColumnWidth(c, 30);
  for (var r = sr; r < sr + n; r++) sh.setRowHeight(r, 30);

  // 제목 · 상태 · 안내
  sh.getRange('B1').setValue('SHEEET · 오목 (Gomoku)').setFontWeight('bold').setFontSize(14);
  sh.getRange('Q2').setValue('상태 →');
  sh.getRange(STATUS_CELL).setValue('다음: 흑(●)').setFontWeight('bold').setFontColor('#1a73e8');
  sh.getRange('Q3').setValue('턴 →');
  sh.getRange(TURN_CELL).setValue(0);
  sh.getRange('B18').setValue(
    '▶ 빈 칸을 클릭→아무 키나 입력 후 Enter 를 누르면 돌이 놓입니다.  ' +
    '흑(●)·백(○) 번갈아 진행, 가로/세로/대각선 5목 완성 시 승리!'
  ).setFontColor('#666666');
}

// ── 착수 처리 ──────────────────────────────────────────────────────
function onEdit(e) {
  var sh = e.range.getSheet();
  var r = e.range.getRow(), c = e.range.getColumn();

  // 보드 범위 밖이면 무시
  if (r < BOARD.startRow || r > BOARD.startRow + BOARD.size - 1) return;
  if (c < BOARD.startCol || c > BOARD.startCol + BOARD.size - 1) return;

  // 동시 착수 경쟁 방지 (문서 단위 잠금)
  var lock = LockService.getDocumentLock();
  try { lock.waitLock(5000); } catch (err) { return; }

  try {
    // 이미 끝난 게임이면 입력 되돌림
    var status = String(sh.getRange(STATUS_CELL).getValue());
    if (status.indexOf('승리') > -1) { e.range.clearContent(); return; }

    // 이미 돌이 있는 칸을 덮어쓰려 하면 원복
    if (e.oldValue === BLACK || e.oldValue === WHITE) {
      e.range.setValue(e.oldValue);
      return;
    }

    // 차례 판정: 짝수 턴 = 흑
    var turn = Number(sh.getRange(TURN_CELL).getValue()) || 0;
    var isBlack = (turn % 2 === 0);
    var stone = isBlack ? BLACK : WHITE;

    e.range.setValue(stone);
    e.range.setFontColor(isBlack ? '#000000' : '#c0392b');

    if (checkWin(sh, r, c, stone)) {
      sh.getRange(STATUS_CELL)
        .setValue((isBlack ? '흑(●)' : '백(○)') + ' 승리! 🎉')
        .setFontColor('#d93025');
    } else {
      sh.getRange(TURN_CELL).setValue(turn + 1);
      sh.getRange(STATUS_CELL)
        .setValue('다음: ' + (isBlack ? '백(○)' : '흑(●)'));
    }
  } finally {
    lock.releaseLock();
  }
}

// ── 승리 판정: (r,c)에서 4방향 5연속 확인 ──────────────────────────
function checkWin(sh, r, c, stone) {
  var n = BOARD.size, R0 = BOARD.startRow, C0 = BOARD.startCol;
  var vals = sh.getRange(R0, C0, n, n).getValues();

  function at(rr, cc) {
    var i = rr - R0, j = cc - C0;
    if (i < 0 || j < 0 || i >= n || j >= n) return '';
    return vals[i][j];
  }

  var dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (var d = 0; d < dirs.length; d++) {
    var dr = dirs[d][0], dc = dirs[d][1], count = 1;
    for (var s = -1; s <= 1; s += 2) {
      var rr = r + dr * s, cc = c + dc * s;
      while (at(rr, cc) === stone) { count++; rr += dr * s; cc += dc * s; }
    }
    if (count >= 5) return true;
  }
  return false;
}
