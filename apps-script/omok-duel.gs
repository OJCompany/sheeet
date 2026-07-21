/**
 * SHEEET 오목 — 1인 1링크 대전판 (턴 완전 강제)
 *
 * 원리: 익명 사용자는 신원 식별이 불가능하므로, "링크 소유 = 신원"으로 만든다.
 * 흑 전용 파일과 백 전용 파일을 따로 생성해 각자 자기 링크만 받는다.
 * 상대 파일 링크가 없으면 상대 돌을 놓는 것이 물리적으로 불가능하다.
 * 스크립트(호스트 권한)가 두 판을 동기화한다.
 *
 * 설치 (호스트 1회):
 *   1. 아무 시트에서 확장 프로그램 → Apps Script → 이 코드로 전체 교체 → 저장
 *   2. createOmokRoom 실행 (Drive 권한 포함 승인 1회)
 *   3. 현재 시트 A1:B2에 흑 링크·백 링크가 생성됨 → 각 플레이어에게 자기 것만 전달
 *
 * 참가자는 로그인·승인 없이 자기 판의 빈 칸에 아무 글자나 입력하면 착수된다.
 * 자기 차례가 아니면 입력이 지워지고 "상대 차례입니다"가 표시된다.
 */

const SHEET_NAME = '오목';
const BOARD = { row: 3, col: 2, size: 15 };                       // B3:P17
const CELL = { you: 'S2', turn: 'S4', state: 'S6', reset: 'S8' }; // 우측 패널
const BLACK = '⚫';
const WHITE = '⚪';
const WOOD = '#E8C8A0';
const WOOD_LINE = '#8B6F47';
const WIN_GOLD = '#FFD966';
const PROPS = PropertiesService.getScriptProperties();

/** 방 생성 — 호스트가 편집기에서 실행. 흑/백 파일 2개를 만들고 링크를 마스터 시트에 기록 */
function createOmokRoom() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'onMove')
    .forEach(t => ScriptApp.deleteTrigger(t));

  const black = buildClientFile(BLACK);
  const white = buildClientFile(WHITE);

  PROPS.setProperty('ROOM', JSON.stringify({
    blackId: black.id, whiteId: white.id, turn: BLACK, over: false,
  }));

  ScriptApp.newTrigger('onMove').forSpreadsheet(black.id).onEdit().create();
  ScriptApp.newTrigger('onMove').forSpreadsheet(white.id).onEdit().create();

  const master = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  master.getRange('A1').setValue('⚫ 흑 플레이어 링크 (흑에게만 전달)').setFontWeight('bold');
  master.getRange('B1').setValue(black.url);
  master.getRange('A2').setValue('⚪ 백 플레이어 링크 (백에게만 전달)').setFontWeight('bold');
  master.getRange('B2').setValue(white.url);
  master.autoResizeColumn(1);
}

/** 플레이어 전용 파일 생성: 게임판 + 링크 공유(편집) 설정 */
function buildClientFile(color) {
  const ss = SpreadsheetApp.create('SHEEET 오목 — ' + (color === BLACK ? '흑' : '백'));
  const sheet = ss.getSheets()[0].setName(SHEET_NAME);
  drawBoard(sheet, color);
  DriveApp.getFileById(ss.getId())
    .setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
  return { id: ss.getId(), url: ss.getUrl() };
}

function drawBoard(sheet, color) {
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
    .setValue('SHEEET 오목 — 빈 칸에 아무 글자나 입력하면 돌이 놓입니다')
    .setFontWeight('bold');

  sheet.getRange(CELL.you)
    .setValue('당신은 ' + color + (color === BLACK ? ' (흑, 선공)' : ' (백)'))
    .setFontWeight('bold').setFontSize(12);
  sheet.getRange('R4').setValue('현재 차례').setFontWeight('bold');
  sheet.getRange(CELL.turn).setValue(BLACK).setFontSize(16).setHorizontalAlignment('center');
  sheet.getRange('R6').setValue('상태').setFontWeight('bold');
  sheet.getRange(CELL.state).setValue('진행중');
  sheet.getRange('R8').setValue('새 게임').setFontWeight('bold');
  sheet.getRange(CELL.reset).insertCheckboxes();
  sheet.setColumnWidth(18, 80); // R열
}

/** 설치형 트리거 — 흑/백 파일 어느 쪽의 편집이든 호스트 권한으로 처리 */
function onMove(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    e.range.setValue(e.oldValue || '');
    return;
  }
  try {
    handleMove(e);
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

function handleMove(e) {
  const room = JSON.parse(PROPS.getProperty('ROOM') || 'null');
  if (!room) return;

  const srcId = e.source.getId();
  const myColor = srcId === room.blackId ? BLACK : srcId === room.whiteId ? WHITE : null;
  if (!myColor) return;

  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAME) return;

  // 새 게임 체크박스 — 어느 쪽에서 눌러도 양쪽 판 리셋
  if (e.range.getA1Notation() === CELL.reset) {
    if (e.value === 'TRUE') resetRoom(room);
    return;
  }

  // 게임판 밖 또는 다중 셀 편집(붙여넣기)은 무시
  const r = e.range.getRow();
  const c = e.range.getColumn();
  const inBoard =
    r >= BOARD.row && r < BOARD.row + BOARD.size &&
    c >= BOARD.col && c < BOARD.col + BOARD.size;
  if (!inBoard || e.range.getNumRows() > 1 || e.range.getNumColumns() > 1) return;

  const hasStone = e.oldValue === BLACK || e.oldValue === WHITE;

  // 종료됨 / 이미 돌 있음 / 내 차례 아님 → 입력 되돌리기
  if (room.over || hasStone) {
    e.range.setValue(e.oldValue || '');
    return;
  }
  if (room.turn !== myColor) {
    e.range.setValue(e.oldValue || '');
    sheet.getRange(CELL.state).setValue('✋ 상대 차례입니다');
    return;
  }

  // 착수 — 내 판과 상대 판 모두에 반영
  const otherId = myColor === BLACK ? room.whiteId : room.blackId;
  const other = SpreadsheetApp.openById(otherId).getSheetByName(SHEET_NAME);
  e.range.setValue(myColor);
  other.getRange(r, c).setValue(myColor);

  const winLine = checkWin(sheet, r, c, myColor);
  if (winLine) {
    for (const s of [sheet, other]) {
      winLine.forEach(([i, j]) =>
        s.getRange(BOARD.row + i, BOARD.col + j).setBackground(WIN_GOLD));
      s.getRange(CELL.state).setValue(myColor + ' 승리! 🎉');
    }
    room.over = true;
  } else {
    room.turn = myColor === BLACK ? WHITE : BLACK;
    for (const s of [sheet, other]) {
      s.getRange(CELL.turn).setValue(room.turn);
      s.getRange(CELL.state).setValue('진행중');
    }
  }
  PROPS.setProperty('ROOM', JSON.stringify(room));
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

function resetRoom(room) {
  for (const id of [room.blackId, room.whiteId]) {
    const sheet = SpreadsheetApp.openById(id).getSheetByName(SHEET_NAME);
    sheet.getRange(BOARD.row, BOARD.col, BOARD.size, BOARD.size)
      .clearContent()
      .setBackground(WOOD);
    sheet.getRange(CELL.turn).setValue(BLACK);
    sheet.getRange(CELL.state).setValue('진행중');
    sheet.getRange(CELL.reset).setValue(false);
  }
  room.turn = BLACK;
  room.over = false;
  PROPS.setProperty('ROOM', JSON.stringify(room));
}
