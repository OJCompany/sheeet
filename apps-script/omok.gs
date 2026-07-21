/**
 * SHEEET 오목 (1:1 대전)
 *
 * 설치 (호스트 1회):
 *   1. 구글 시트 → 확장 프로그램 → Apps Script → 이 코드 붙여넣기 → 저장
 *   2. 편집기에서 setupOmok 함수 실행 (권한 승인 1회)
 *   3. 시트를 "링크가 있는 모든 사용자 - 편집자"로 공유
 *
 * 참가자는 아무 승인 없이 빈 칸에 아무 글자나 입력하면 돌이 놓인다.
 * (onEdit 단순 트리거 + LockService만 사용 — 참가자 측 권한 요청 없음)
 */

const SHEET_NAME = '오목';
const BOARD = { row: 3, col: 2, size: 15 };            // B3:P17
const CELL = { turn: 'S4', state: 'S6', reset: 'S8', lastMove: 'Z1' }; // 우측 패널 + 마지막 착수 시각
// 익명 편집자는 식별이 불가능해 같은 사람의 연속 착수를 완전히 막을 수 없다.
// 대신 착수 후 일정 시간 모든 입력을 거부해 "한 명이 두 번 연달아 두는" 사고를 차단한다.
const COOLDOWN_MS = 2500;
const BLACK = '⚫';
const WHITE = '⚪';
const WOOD = '#E8C8A0';
const WOOD_LINE = '#8B6F47';
const WIN_GOLD = '#FFD966';

/** 게임판 최초 생성 — 호스트가 편집기에서 1회 실행 */
function setupOmok() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 설치형 onEdit 트리거 등록 (중복 방지 후 재생성).
  // 단순 트리거는 익명 편집자에게 실행되지 않으므로 반드시 설치형이어야 한다.
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'onOmokEdit')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onOmokEdit').forSpreadsheet(ss).onEdit().create();

  const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  sheet.clear();
  sheet.clearFormats();

  const board = sheet.getRange(BOARD.row, BOARD.col, BOARD.size, BOARD.size);
  board
    .setBackground(WOOD)
    .setBorder(true, true, true, true, true, true, WOOD_LINE, SpreadsheetApp.BorderStyle.SOLID)
    .setFontSize(16)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setColumnWidths(BOARD.col, BOARD.size, 34);
  sheet.setRowHeights(BOARD.row, BOARD.size, 34);

  sheet.getRange('B2')
    .setValue('SHEEET 오목 — 빈 칸에 아무 글자나 입력하면 자기 차례의 돌이 놓입니다')
    .setFontWeight('bold');

  sheet.getRange('R4').setValue('현재 차례').setFontWeight('bold');
  sheet.getRange(CELL.turn).setValue(BLACK).setFontSize(16).setHorizontalAlignment('center');
  sheet.getRange('R6').setValue('상태').setFontWeight('bold');
  sheet.getRange(CELL.state).setValue('진행중');
  sheet.getRange('R8').setValue('새 게임').setFontWeight('bold');
  sheet.getRange(CELL.reset).insertCheckboxes();
  sheet.getRange('R10').setValue('⏳ 돌을 놓은 직후 2.5초는 입력이 무시됩니다 (연속 착수 방지)')
    .setFontSize(9).setFontColor('#888888');
  sheet.setColumnWidth(18, 80); // R열
}

/** 설치형 트리거 핸들러 — 모든 편집자(익명 포함)의 입력을 호스트 권한으로 처리 */
function onOmokEdit(e) {
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAME) return;

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
  } catch (err) {
    // 잠금 실패(동시 입력 폭주) — 입력 되돌리고 종료
    e.range.setValue(e.oldValue || '');
    return;
  }
  try {
    handleEdit(e, sheet);
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

function handleEdit(e, sheet) {
  // 새 게임 체크박스
  if (e.range.getA1Notation() === CELL.reset) {
    if (e.value === 'TRUE') resetBoard(sheet);
    return;
  }

  // 게임판 밖 또는 다중 셀 편집(붙여넣기)은 무시
  const r = e.range.getRow();
  const c = e.range.getColumn();
  const inBoard =
    r >= BOARD.row && r < BOARD.row + BOARD.size &&
    c >= BOARD.col && c < BOARD.col + BOARD.size;
  if (!inBoard || e.range.getNumRows() > 1 || e.range.getNumColumns() > 1) return;

  // 게임 종료 후, 또는 이미 돌이 있는 칸 → 입력 되돌리기
  const gameOver = sheet.getRange(CELL.state).getValue() !== '진행중';
  if (gameOver || e.oldValue === BLACK || e.oldValue === WHITE) {
    e.range.setValue(e.oldValue || '');
    return;
  }

  // 쿨다운: 직전 착수 후 COOLDOWN_MS 안의 입력은 전부 거부
  const lastMoveCell = sheet.getRange(CELL.lastMove);
  const lastMove = Number(lastMoveCell.getValue()) || 0;
  if (Date.now() - lastMove < COOLDOWN_MS) {
    e.range.setValue(e.oldValue || '');
    return;
  }

  // 착수
  const stone = sheet.getRange(CELL.turn).getValue();
  e.range.setValue(stone);
  lastMoveCell.setValue(Date.now());

  const winLine = checkWin(sheet, r, c, stone);
  if (winLine) {
    winLine.forEach(([i, j]) =>
      sheet.getRange(BOARD.row + i, BOARD.col + j).setBackground(WIN_GOLD));
    sheet.getRange(CELL.state).setValue(stone + ' 승리! 🎉');
  } else {
    sheet.getRange(CELL.turn).setValue(stone === BLACK ? WHITE : BLACK);
  }
}

/** 방금 놓은 돌 기준 4방향 5목 검사. 이기면 돌 좌표 배열, 아니면 null */
function checkWin(sheet, row, col, stone) {
  const vals = sheet.getRange(BOARD.row, BOARD.col, BOARD.size, BOARD.size).getValues();
  const rr = row - BOARD.row;
  const cc = col - BOARD.col;
  vals[rr][cc] = stone; // setValue 직후 getValues에 반영 안 됐을 수 있음

  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    const line = [[rr, cc]];
    for (const sign of [1, -1]) {
      let i = rr + dr * sign;
      let j = cc + dc * sign;
      while (i >= 0 && i < BOARD.size && j >= 0 && j < BOARD.size && vals[i][j] === stone) {
        line.push([i, j]);
        i += dr * sign;
        j += dc * sign;
      }
    }
    if (line.length >= 5) return line;
  }
  return null;
}

function resetBoard(sheet) {
  sheet.getRange(BOARD.row, BOARD.col, BOARD.size, BOARD.size)
    .clearContent()
    .setBackground(WOOD);
  sheet.getRange(CELL.turn).setValue(BLACK);
  sheet.getRange(CELL.state).setValue('진행중');
  sheet.getRange(CELL.reset).setValue(false);
  sheet.getRange(CELL.lastMove).clearContent();
}
