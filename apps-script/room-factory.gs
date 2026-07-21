/**
 * SHEEET 방 공장 (Room Factory)
 *
 * 프론트엔드에서 "게임 + 인원수"를 받아 플레이어별 시트 파일을 생성하고
 * 링크 목록을 돌려주는 웹 API + 게임 진행 엔진.
 *
 * 아키텍처: 1인 1링크 — 링크 소유가 곧 신원. 플레이어마다 전용 파일을 만들고
 * 설치형 onEdit 트리거(호스트 권한)가 모든 판을 동기화·턴 강제한다.
 *
 * 설치 (호스트 1회):
 *   1. Apps Script 편집기에 이 코드로 전체 교체 → 저장
 *   2. testCreateOmokRoom 실행 1회 (권한 승인 + 동작 확인, 로그에 링크 출력)
 *   3. 배포 → 새 배포 → 유형: 웹 앱 → 실행: 나 / 액세스: 모든 사용자 → 배포
 *   4. 웹 앱 URL을 프론트엔드(.env)에 넣는다
 *
 * API:
 *   GET  <url>                       → 서비스 정보(핑)
 *   GET  <url>?game=omok&players=2   → 방 생성 (브라우저로 바로 테스트 가능)
 *   POST <url>  body: {"game":"omok","players":2}  (Content-Type: text/plain)
 *   응답: {ok, roomId, game, links:[{role, url}, ...]}
 *
 * 제약: Apps Script는 스크립트당 트리거 20개 한도 → 새 방에 자리가 없으면
 * 가장 오래된 방을 자동으로 닫는다(파일은 남고 진행만 멈춤).
 */

const PROPS = PropertiesService.getScriptProperties();

const SHEET_NAME = '오목';
const BOARD = { row: 3, col: 2, size: 15 }; // B3:P17 (2행은 배너)
// 우측 패널 — 시선 순서(위→아래)대로: ①닉네임 ②내 돌 ③현재 차례 ④상태 ⑤새 게임
const CELL = { nick: 'S2', you: 'S4', turn: 'S6', state: 'S8', reset: 'S10', banner: 'B2' };
const BLACK = '⚫';
const WHITE = '⚪';
const WOOD = '#E8C8A0';
const WOOD_LINE = '#8B6F47';
const WIN_GOLD = '#FFD966';
const FLASH_RED = '#E53935';
const NICK_YELLOW = '#FFF9C4';
const LAST_AMBER = '#FFE082';   // 마지막 수 하이라이트
const TURN_GREEN = '#C8E6C9';   // 내 차례 초록불
const TURN_GRAY = '#EEEEEE';    // 상대 차례
const BANNER_DEFAULT = '⚡ SHEEET 오목 — 빈 칸에 아무 글자나 입력하면 돌이 놓입니다';
const TRIGGER_LIMIT = 19; // 공식 한도 20에서 여유 1

// ---------- 게임 레지스트리 (새 게임은 여기에 추가) ----------

const GAMES = {
  omok: {
    name: '오목',
    minPlayers: 2,
    maxPlayers: 2,
    roles: ['⚫ 흑', '⚪ 백'],
    build: buildOmokRoom,
    onEdit: handleOmokMove,
  },
};

// ---------- HTTP 엔드포인트 ----------

function doGet(e) {
  return handleHttp((e && e.parameter) || {});
}

function doPost(e) {
  let params = {};
  try {
    params = JSON.parse(e.postData.contents);
  } catch (err) { /* 빈 바디 허용 */ }
  return handleHttp(params);
}

function handleHttp(params) {
  let out;
  try {
    if (!params.game) {
      out = { ok: true, service: 'SHEEET room factory', games: Object.keys(GAMES) };
    } else {
      out = createRoom(String(params.game), Number(params.players) || 0);
    }
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- 방 생성 ----------

function createRoom(game, players) {
  const spec = GAMES[game];
  if (!spec) throw new Error('없는 게임: ' + game);
  const n = Math.min(Math.max(players || spec.minPlayers, spec.minPlayers), spec.maxPlayers);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensureTriggerBudget(n);

    const roomId = Utilities.getUuid().slice(0, 8);
    const room = spec.build(roomId, n);
    room.game = game;
    room.open = true;
    room.created = Date.now();

    const rooms = loadJson('ROOMS');
    rooms[roomId] = room;
    saveJson('ROOMS', rooms);

    const index = loadJson('FILE_INDEX');
    room.fileIds.forEach(id => { index[id] = roomId; });
    saveJson('FILE_INDEX', index);

    room.fileIds.forEach(id =>
      ScriptApp.newTrigger('onMove').forSpreadsheet(id).onEdit().create());

    return {
      ok: true,
      roomId: roomId,
      game: spec.name,
      links: room.fileIds.map((id, i) => ({ role: spec.roles[i], url: room.urls[i] })),
    };
  } finally {
    lock.releaseLock();
  }
}

/** 트리거 한도 확보 — 부족하면 오래된 방부터 닫는다 */
function ensureTriggerBudget(needed) {
  const count = () =>
    ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'onMove').length;
  if (count() + needed <= TRIGGER_LIMIT) return;

  const rooms = loadJson('ROOMS');
  const oldestFirst = Object.keys(rooms)
    .filter(id => rooms[id].open)
    .sort((a, b) => rooms[a].created - rooms[b].created);
  for (const id of oldestFirst) {
    closeRoom(id, rooms);
    if (count() + needed <= TRIGGER_LIMIT) break;
  }
  saveJson('ROOMS', rooms);
  if (count() + needed > TRIGGER_LIMIT) throw new Error('동시 진행 방이 너무 많습니다');
}

function closeRoom(roomId, rooms) {
  const room = rooms[roomId];
  const ids = new Set(room.fileIds);
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'onMove' && ids.has(t.getTriggerSourceId()))
    .forEach(t => ScriptApp.deleteTrigger(t));
  const index = loadJson('FILE_INDEX');
  room.fileIds.forEach(id => { delete index[id]; });
  saveJson('FILE_INDEX', index);
  room.open = false;
}

// ---------- 게임 진행 (모든 방 공용 트리거) ----------

function onMove(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    e.range.setValue(e.oldValue || '');
    return;
  }
  try {
    const index = loadJson('FILE_INDEX');
    const roomId = index[e.source.getId()];
    if (!roomId) return;
    const rooms = loadJson('ROOMS');
    const room = rooms[roomId];
    if (!room || !room.open) return;
    GAMES[room.game].onEdit(e, room);
    saveJson('ROOMS', rooms);
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

// ---------- 오목 구현 ----------

function buildOmokRoom(roomId, n) {
  const files = [BLACK, WHITE].map(color => {
    const ss = SpreadsheetApp.create('SHEEET 오목 ' + roomId + ' — ' + (color === BLACK ? '흑' : '백'));
    const sheet = ss.getSheets()[0].setName(SHEET_NAME);
    drawOmokBoard(sheet, color);
    DriveApp.getFileById(ss.getId())
      .setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
    return { id: ss.getId(), url: ss.getUrl() };
  });
  return {
    fileIds: files.map(f => f.id),
    urls: files.map(f => f.url),
    turn: BLACK,
    over: false,
  };
}

function drawOmokBoard(sheet, color) {
  const board = sheet.getRange(BOARD.row, BOARD.col, BOARD.size, BOARD.size);
  board
    .setBackground(WOOD)
    .setBorder(true, true, true, true, true, true, WOOD_LINE, SpreadsheetApp.BorderStyle.SOLID)
    .setFontSize(16)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setColumnWidths(BOARD.col, BOARD.size, 34);
  sheet.setRowHeights(BOARD.row, BOARD.size, 34);

  // 상단 배너 (판 폭 전체 병합) — 모든 연출 메시지가 여기에 뜬다
  sheet.getRange('B2:P2').merge();
  sheet.setRowHeight(2, 34);
  sheet.getRange(CELL.banner)
    .setValue('👋 환영합니다! 오른쪽 위 노란 칸에 닉네임부터 입력하세요')
    .setFontWeight('bold').setFontSize(13)
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setBackground('#E8F5E9');

  // 우측 패널 — 시선 순서대로 배치
  sheet.getRange('R2').setValue('1️⃣ 내 닉네임 입력 →').setFontWeight('bold');
  sheet.getRange(CELL.nick)
    .setBackground(NICK_YELLOW)
    .setBorder(true, true, true, true, false, false, '#F9A825', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  sheet.getRange('R4').setValue('나는').setFontWeight('bold');
  sheet.getRange(CELL.you)
    .setValue(color + (color === BLACK ? ' 흑 (선공)' : ' 백'))
    .setFontWeight('bold').setFontSize(12);

  sheet.getRange('R6').setValue('현재 차례').setFontWeight('bold');
  sheet.getRange(CELL.turn)
    .setValue(BLACK).setFontSize(16).setHorizontalAlignment('center')
    .setBackground(color === BLACK ? TURN_GREEN : TURN_GRAY);

  sheet.getRange('R8').setValue('상태').setFontWeight('bold');
  sheet.getRange(CELL.state).setValue('👉 ⚫ 흑 님의 차례입니다');

  sheet.getRange('R10').setValue('새 게임').setFontWeight('bold');
  sheet.getRange(CELL.reset).insertCheckboxes();

  sheet.setColumnWidth(18, 130); // R열
  sheet.setColumnWidth(19, 140); // S열
}

function handleOmokMove(e, room) {
  const srcId = e.source.getId();
  const myColor = srcId === room.fileIds[0] ? BLACK : srcId === room.fileIds[1] ? WHITE : null;
  if (!myColor) return;

  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAME) return;

  const a1 = e.range.getA1Notation();
  if (a1 === CELL.reset) {
    if (e.value === 'TRUE') resetOmokRoom(room);
    return;
  }

  // 닉네임 등록 → 환영 연출 + 양쪽 판에 즉시 반영
  if (a1 === CELL.nick) {
    if (!room.names) room.names = {};
    const name = String(e.value || '').trim().slice(0, 12);
    room.names[myColor] = name;

    const banner = sheet.getRange(CELL.banner);
    banner.setValue('🎉 ' + (name || '플레이어') + ' 님, 입장했습니다!').setFontColor('#188038');
    e.range.setBackground('#A5D6A7');
    SpreadsheetApp.flush();
    Utilities.sleep(800);
    e.range.setBackground(NICK_YELLOW);
    banner.setValue(BANNER_DEFAULT).setFontColor('#000000');
    syncOmokPanels(room);
    return;
  }

  const r = e.range.getRow();
  const c = e.range.getColumn();
  const inBoard =
    r >= BOARD.row && r < BOARD.row + BOARD.size &&
    c >= BOARD.col && c < BOARD.col + BOARD.size;
  if (!inBoard || e.range.getNumRows() > 1 || e.range.getNumColumns() > 1) return;

  const hasStone = e.oldValue === BLACK || e.oldValue === WHITE;
  if (room.over || hasStone) {
    e.range.setValue(e.oldValue || '');
    return;
  }
  if (room.turn !== myColor) {
    e.range.setValue(e.oldValue || '');
    flashWrongTurn(sheet, room);
    return;
  }

  const otherId = myColor === BLACK ? room.fileIds[1] : room.fileIds[0];
  const other = SpreadsheetApp.openById(otherId).getSheetByName(SHEET_NAME);
  const boards = [sheet, other];
  e.range.setValue(myColor);
  other.getRange(r, c).setValue(myColor);

  // 마지막 수 하이라이트: 직전 수는 원래 색으로, 방금 수는 호박색으로
  if (room.last) {
    boards.forEach(s => s.getRange(room.last[0], room.last[1]).setBackground(WOOD));
  }
  boards.forEach(s => s.getRange(r, c).setBackground(LAST_AMBER));
  room.last = [r, c];

  const winLine = checkWin(sheet, r, c, myColor);
  if (winLine) {
    // 승리 연출: 다섯 돌이 금색으로 차례차례 물든다
    for (const [i, j] of winLine) {
      boards.forEach(s => s.getRange(BOARD.row + i, BOARD.col + j).setBackground(WIN_GOLD));
      SpreadsheetApp.flush();
      Utilities.sleep(150);
    }
    const winText = '🏆 ' + playerLabel(room, myColor) + ' 님 승리! 🎉';
    for (const s of boards) {
      s.getRange(CELL.state).setValue(winText);
      s.getRange(CELL.banner).setValue(winText).setFontColor('#F57F17');
    }
    room.over = true;
  } else {
    room.turn = myColor === BLACK ? WHITE : BLACK;
    syncOmokPanels(room);
  }
}

/** 닉네임이 있으면 "⚫ 해찬", 없으면 "⚫ 흑" */
function playerLabel(room, color) {
  const name = room.names && room.names[color];
  return color + ' ' + (name || (color === BLACK ? '흑' : '백'));
}

/** 양쪽 판의 차례·상태 표시 동기화 — 자기 차례인 판에는 초록불이 켜진다 */
function syncOmokPanels(room) {
  room.fileIds.forEach((id, i) => {
    const myColor = i === 0 ? BLACK : WHITE;
    const sheet = SpreadsheetApp.openById(id).getSheetByName(SHEET_NAME);
    sheet.getRange(CELL.turn)
      .setValue(room.turn)
      .setBackground(room.turn === myColor ? TURN_GREEN : TURN_GRAY);
    if (!room.over) {
      sheet.getRange(CELL.state).setValue(
        '👉 ' + playerLabel(room, room.turn) + ' 님의 차례입니다' +
        (room.turn === myColor ? ' (나!)' : ''));
    }
  });
}

/** 자기 차례가 아닐 때: 판 전체에 대형 ❌를 1초간 번쩍 */
function flashWrongTurn(sheet, room) {
  const a1s = [];
  for (let i = 0; i < BOARD.size; i++) {
    a1s.push(sheet.getRange(BOARD.row + i, BOARD.col + i).getA1Notation());
    if (BOARD.size - 1 - i !== i) {
      a1s.push(sheet.getRange(BOARD.row + i, BOARD.col + BOARD.size - 1 - i).getA1Notation());
    }
  }
  const cross = sheet.getRangeList(a1s);
  const banner = sheet.getRange(CELL.banner);

  banner.setValue('❌ 지금은 ' + playerLabel(room, room.turn) + ' 님 차례!')
    .setFontColor(FLASH_RED);
  cross.setBackground(FLASH_RED);
  SpreadsheetApp.flush();
  Utilities.sleep(900);
  cross.setBackground(WOOD);
  if (room.last) {
    sheet.getRange(room.last[0], room.last[1]).setBackground(LAST_AMBER);
  }
  banner.setValue(BANNER_DEFAULT).setFontColor('#000000');
}

function resetOmokRoom(room) {
  for (const id of room.fileIds) {
    const sheet = SpreadsheetApp.openById(id).getSheetByName(SHEET_NAME);
    sheet.getRange(BOARD.row, BOARD.col, BOARD.size, BOARD.size)
      .clearContent()
      .setBackground(WOOD);
    sheet.getRange(CELL.reset).setValue(false);
    sheet.getRange(CELL.banner).setValue(BANNER_DEFAULT).setFontColor('#000000');
  }
  room.turn = BLACK;
  room.over = false;
  room.last = null;
  syncOmokPanels(room); // 닉네임은 유지한 채 차례 표시 갱신
}

/** 방금 놓은 돌 기준 4방향 5목 검사 */
function checkWin(sheet, row, col, stone) {
  const vals = sheet.getRange(BOARD.row, BOARD.col, BOARD.size, BOARD.size).getValues();
  const rr = row - BOARD.row;
  const cc = col - BOARD.col;
  vals[rr][cc] = stone;

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

// ---------- 유틸 ----------

function loadJson(key) {
  return JSON.parse(PROPS.getProperty(key) || '{}');
}

function saveJson(key, obj) {
  PROPS.setProperty(key, JSON.stringify(obj));
}

/** 편집기에서 1회 실행: 권한 승인 + 방 생성 확인용 */
function testCreateOmokRoom() {
  const result = createRoom('omok', 2);
  Logger.log(JSON.stringify(result, null, 2));
}
