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
    roleLabel: i => (i === 0 ? '⚫ 흑' : '⚪ 백'),
    build: buildOmokRoom,
    onEdit: handleOmokMove,
  },
  pixel: {
    name: '픽셀 기억 그리기',
    minPlayers: 2,
    maxPlayers: 6,
    roleLabel: i => '🎨 플레이어 ' + (i + 1),
    build: buildPixelRoom,
    onEdit: handlePixelEdit,
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
      out = createRoom(String(params.game), Number(params.players) || 0, {
        rounds: Number(params.rounds) || 0,
        difficulty: String(params.difficulty || ''),
      });
    }
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- 방 생성 ----------

function createRoom(game, players, opts) {
  const spec = GAMES[game];
  if (!spec) throw new Error('없는 게임: ' + game);
  const n = Math.min(Math.max(players || spec.minPlayers, spec.minPlayers), spec.maxPlayers);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensureTriggerBudget(n);

    const roomId = Utilities.getUuid().slice(0, 8);
    const room = spec.build(roomId, n, opts || {});
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
      links: room.fileIds.map((id, i) => ({ role: spec.roleLabel(i), url: room.urls[i] })),
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
  let afterUnlock = null;
  try {
    const index = loadJson('FILE_INDEX');
    const roomId = index[e.source.getId()];
    if (!roomId) return;
    const rooms = loadJson('ROOMS');
    const room = rooms[roomId];
    if (!room || !room.open) return;
    // 핸들러가 함수를 반환하면 잠금 해제 후 실행 (라운드 연출 같은 장시간 작업용)
    afterUnlock = GAMES[room.game].onEdit(e, room, roomId);
    saveJson('ROOMS', rooms);
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
  if (typeof afterUnlock === 'function') afterUnlock();
}

/** 방 상태를 잠금 하에 짧게 갱신 (장시간 실행 중 세이브포인트용) */
function updateRoom(roomId, mutate) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const rooms = loadJson('ROOMS');
    if (rooms[roomId]) {
      mutate(rooms[roomId]);
      saveJson('ROOMS', rooms);
    }
    return rooms[roomId];
  } finally {
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

// ---------- 픽셀 기억 그리기 ----------
// 흐름: 라운드 시작 → 정답 10초 공개 → 지우고 60초 그리기(숫자 입력=색칠)
//       → 전원 그림 갤러리 20초 → 정답 공개 + 픽셀 일치율 채점 → 1등 +1점

const PX = {
  sheet: '픽셀',
  grid: { row: 5, col: 3 }, // C5부터 (한 칸 바깥은 검정 액자 프레임)
  frame: '#212121',
  colors: { 1: '#E53935', 2: '#1E88E5', 3: '#FDD835', 4: '#43A047', 5: '#8E24AA' },
  colorNames: '1=빨강 2=파랑 3=노랑 4=초록 5=보라',
  memorizeMs: 10000,
  drawMs: 60000,
  galleryMs: 20000,
};

const PX_DIFFS = {
  easy: { size: 8, colors: 3, label: '쉬움 (8×8·3색)' },
  normal: { size: 10, colors: 4, label: '보통 (10×10·4색)' },
  hard: { size: 12, colors: 5, label: '어려움 (12×12·5색)' },
};

// 도트 그림 데이터: '0'=빈칸, 숫자=팔레트 색
const PX_ART = {
  easy: [
    { name: '하트', rows: [
      '01100110', '11111111', '11111111', '11111111',
      '01111110', '00111100', '00011000', '00000000'] },
    { name: '스마일', rows: [
      '00333300', '03333330', '33233233', '33333333',
      '31333313', '33111133', '03333330', '00333300'] },
    { name: '버섯', rows: [
      '00111100', '01101110', '11111011', '11111111',
      '00333300', '00333300', '00333300', '00000000'] },
  ],
  normal: [
    { name: '집', rows: [
      '0000110000', '0001111000', '0011111100', '0111111110', '3333333333',
      '3223333223', '3223333223', '3333113333', '3333113333', '4444444444'] },
    { name: '사과나무', rows: [
      '0004444000', '0044444400', '0441444140', '4444414444', '0444444440',
      '0044444400', '0000330000', '0000330000', '0000330000', '4444444444'] },
    { name: '별', rows: [
      '0000330000', '0000330000', '0003333000', '3333333333', '0333333330',
      '0033333300', '0033333300', '0333003330', '0330000330', '3300000033'] },
  ],
  hard: [
    { name: '로켓', rows: [
      '000001100000', '000011110000', '000012210000', '000022220000',
      '000025520000', '000025520000', '000022220000', '001222222100',
      '011222222110', '011033330110', '000033330000', '000003300000'] },
    { name: '고양이', rows: [
      '033000000330', '331300003133', '311333333113', '333333333333',
      '333333333333', '332233332233', '332233332233', '333331133333',
      '533333333335', '553333333355', '033333333330', '003333333300'] },
    { name: '꽃', rows: [
      '000001100000', '000111111000', '001133331100', '001333333100',
      '001133331100', '000111111000', '000004400000', '004004400400',
      '044404404440', '000444444000', '000044440000', '444444444444'] },
  ],
};

function pxCells(size) {
  // 우측 패널은 액자 바로 옆 한 열 — 라벨 아래에 값이 오는 세로 배치라
  // 옆 칸이 차 있어도 글자가 절대 잘리지 않는다.
  const pcol = PX.grid.col + size + 3;
  return {
    pcol: pcol,
    banner: { row: 2, col: 2, width: size + 2 },
    legend: { row: 3, col: PX.grid.col },
    nickLabel: { row: 5, col: pcol }, nick: { row: 6, col: pcol },
    roundLabel: { row: 8, col: pcol }, round: { row: 9, col: pcol },
    scoreLabel: { row: 11, col: pcol }, score: { row: 12, col: pcol },
    startLabel: { row: 14, col: pcol }, start: { row: 15, col: pcol },
    stateLabel: { row: 17, col: pcol }, state: { row: 18, col: pcol },
    // 갤러리는 패널(18행)보다 아래에서 시작
    galleryRow: Math.max(PX.grid.row + size + 3, 21),
  };
}

/** 그리기 영역 한 칸 바깥의 검정 액자 프레임 — 테두리 링만 칠한다 (안쪽 캔버스 침범 금지) */
function pxPaintFrame(sheet, size) {
  const top = PX.grid.row - 1;
  const left = PX.grid.col - 1;
  const w = size + 2;
  sheet.getRange(top, left, 1, w).setBackground(PX.frame);                  // 위
  sheet.getRange(top + size + 1, left, 1, w).setBackground(PX.frame);      // 아래
  sheet.getRange(top + 1, left, size, 1).setBackground(PX.frame);          // 왼쪽
  sheet.getRange(top + 1, left + size + 1, size, 1).setBackground(PX.frame); // 오른쪽
}

/** 우측 패널 라벨·배경 복구 — 플레이어가 실수로 칠하거나 지워도 라운드마다 원상복귀 */
function pxFixPanel(sheet, c) {
  const labels = [
    [c.nickLabel, '1️⃣ 내 닉네임 →'],
    [c.roundLabel, '라운드'],
    [c.scoreLabel, '내 점수'],
    [c.startLabel, '라운드 시작'],
    [c.stateLabel, '상태'],
  ];
  labels.forEach(([p, txt]) =>
    sheet.getRange(p.row, p.col).setValue(txt).setFontWeight('bold').setBackground('#FFFFFF'));
  [c.round, c.score, c.state].forEach(p =>
    sheet.getRange(p.row, p.col).setBackground('#FFFFFF'));
  sheet.getRange(c.nick.row, c.nick.col).setBackground(NICK_YELLOW);
}

function buildPixelRoom(roomId, n, opts) {
  const diffKey = PX_DIFFS[opts.difficulty] ? opts.difficulty : 'normal';
  const rounds = Math.min(Math.max(opts.rounds || 3, 1), 5);
  const files = [];
  for (let i = 0; i < n; i++) {
    const ss = SpreadsheetApp.create('SHEEET 픽셀 ' + roomId + ' — P' + (i + 1));
    const sheet = ss.getSheets()[0].setName(PX.sheet);
    drawPixelBoard(sheet, i, diffKey, rounds, n);
    DriveApp.getFileById(ss.getId())
      .setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
    files.push({ id: ss.getId(), url: ss.getUrl() });
  }
  return {
    fileIds: files.map(f => f.id),
    urls: files.map(f => f.url),
    diffKey: diffKey,
    rounds: rounds,
    round: 0,
    phase: 'idle',
    scores: new Array(n).fill(0),
    usedArt: [],
    names: {},
  };
}

function drawPixelBoard(sheet, idx, diffKey, rounds, n) {
  const diff = PX_DIFFS[diffKey];
  const size = diff.size;
  const c = pxCells(size);

  // 새 시트는 기본 26열이라 큰 판(갤러리 2열)이 잘린다 — 필요한 만큼 확장
  const needCols = c.pcol + 2 + size + 3;
  if (sheet.getMaxColumns() < needCols) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), needCols - sheet.getMaxColumns());
  }
  const needRows = c.galleryRow + Math.ceil(6 / 2) * (size + 3) + 10;
  if (sheet.getMaxRows() < needRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), needRows - sheet.getMaxRows());
  }

  // 팔레트 조건부 서식: 숫자를 치면 그 색으로 칠해지고 숫자는 숨겨진다
  const region = sheet.getRange(1, 1, 80, 40);
  const rules = [];
  for (let v = 1; v <= 5; v++) {
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(String(v))
      .setBackground(PX.colors[v])
      .setFontColor(PX.colors[v])
      .setRanges([region])
      .build());
  }
  sheet.setConditionalFormatRules(rules);

  // 배너 + 팔레트 안내
  sheet.getRange(c.banner.row, c.banner.col, 1, c.banner.width).merge();
  sheet.setRowHeight(2, 34);
  sheet.getRange(c.banner.row, c.banner.col)
    .setValue('👋 닉네임 입력 후, 아무나 [라운드 시작]을 체크하면 게임이 시작됩니다')
    .setFontWeight('bold').setFontSize(12)
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setBackground('#E8F5E9');
  // 팔레트 견본: 이 칸들을 복사해 붙여넣거나, 채우기 색으로 직접 칠한다
  for (let v = 1; v <= diff.colors; v++) {
    sheet.getRange(c.legend.row, PX.grid.col + v - 1).setBackground(PX.colors[v]);
  }
  sheet.setRowHeight(c.legend.row, 24);
  sheet.getRange(c.legend.row, PX.grid.col + diff.colors + 1)
    .setValue('← 팔레트! 칸을 복사해 붙여넣기(Cmd+C/V)하거나 채우기(🖌)로 칠하세요. 숫자 1~' + diff.colors + ' 입력도 OK')
    .setFontSize(10).setFontColor('#555555');

  // 검정 액자 프레임 + 그리기 판 (프레임 안쪽이 그리는 영역)
  pxPaintFrame(sheet, size);
  const grid = sheet.getRange(PX.grid.row, PX.grid.col, size, size);
  grid.setBackground('#FFFFFF')
    .setBorder(true, true, true, true, true, true, '#BBBBBB', SpreadsheetApp.BorderStyle.SOLID)
    .setHorizontalAlignment('center');
  sheet.setColumnWidths(PX.grid.col - 1, size + 2, 30);
  sheet.setRowHeights(PX.grid.row - 1, size + 2, 30);

  // 우측 패널 (시선 순서) — 라벨은 pxFixPanel이 관리 (라운드마다 자동 복구됨)
  pxFixPanel(sheet, c);
  sheet.getRange(c.nick.row, c.nick.col)
    .setBorder(true, true, true, true, false, false, '#F9A825', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sheet.getRange(c.round.row, c.round.col).setValue('0 / ' + rounds);
  sheet.getRange(c.score.row, c.score.col).setValue(0);
  sheet.getRange(c.start.row, c.start.col).insertCheckboxes();
  sheet.getRange(c.state.row, c.state.col).setValue('대기 중');
  // 셀 크기: 캔버스·갤러리 전부 동일한 30px 정사각 (채점 때 그림이 달라 보이지 않게)
  sheet.setColumnWidths(c.pcol + 2, size + 2, 30);              // 오른쪽 갤러리 블록
  sheet.setRowHeights(c.galleryRow, 3 * (size + 3) + 4, 30);    // 갤러리 행 전체
  sheet.setColumnWidth(c.pcol, 150);                            // 패널 열은 넓게
}

/** 그리기 판의 셀 테두리를 다시 그린다 — 붙여넣기 색칠이 테두리를 지우기 때문 */
function pxRepaintGridBorders(sheet, size) {
  sheet.getRange(PX.grid.row, PX.grid.col, size, size)
    .setBorder(true, true, true, true, true, true, '#BBBBBB', SpreadsheetApp.BorderStyle.SOLID);
}

function handlePixelEdit(e, room, roomId) {
  const srcIdx = room.fileIds.indexOf(e.source.getId());
  if (srcIdx < 0) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== PX.sheet) return;

  const size = PX_DIFFS[room.diffKey].size;
  const c = pxCells(size);
  const r = e.range.getRow();
  const col = e.range.getColumn();

  // 닉네임
  if (r === c.nick.row && col === c.nick.col) {
    room.names[srcIdx] = String(e.value || '').trim().slice(0, 12);
    const banner = sheet.getRange(c.banner.row, c.banner.col);
    banner.setValue('🎉 ' + (room.names[srcIdx] || '플레이어') + ' 님, 입장했습니다!')
      .setFontColor('#188038');
    SpreadsheetApp.flush();
    Utilities.sleep(600);
    banner.setFontColor('#000000');
    return;
  }

  // 라운드 시작 체크박스
  if (r === c.start.row && col === c.start.col && e.value === 'TRUE') {
    e.range.setValue(false);
    if (room.phase !== 'idle') return;
    if (room.round >= room.rounds) {
      sheet.getRange(c.banner.row, c.banner.col).setValue('🏁 게임이 끝났습니다! 새 방을 만들어 주세요');
      return;
    }
    room.phase = 'running'; // 저장은 onMove 바깥 래퍼가 수행
    return () => runPixelRound(roomId, JSON.parse(JSON.stringify(room)));
  }
}

/** 한 라운드 전체 연출 — 잠금 없이 장시간 실행, 상태 갱신은 updateRoom으로 */
function runPixelRound(roomId, room) {
  const diff = PX_DIFFS[room.diffKey];
  const size = diff.size;
  const c = pxCells(size);
  const roundNo = room.round + 1;

  const sheets = room.fileIds.map(id =>
    SpreadsheetApp.openById(id).getSheetByName(PX.sheet));
  const setAll = (fn) => sheets.forEach((s, i) => fn(s, i));
  const bannerAll = (msg, colr) => setAll(s => {
    s.getRange(c.banner.row, c.banner.col).setValue(msg).setFontColor(colr || '#000000');
  });

  try {
    // 그림 선택 (라운드 간 중복 방지)
    const pool = PX_ART[room.diffKey].map((_, i) => i).filter(i => room.usedArt.indexOf(i) < 0);
    const artIdx = pool.length ? pool[Math.floor(Math.random() * pool.length)]
                               : Math.floor(Math.random() * PX_ART[room.diffKey].length);
    room.usedArt.push(artIdx);
    const art = PX_ART[room.diffKey][artIdx];
    const answer = art.rows.map(row => row.split('').map(d => (d === '0' ? '' : d)));
    const answerBg = answer.map(r => r.map(d => (d ? PX.colors[Number(d)] : '#FFFFFF')));

    // 1) 라운드 준비: 지난 갤러리 청소 + 패널 복구 + 프레임 재도색 → 정답 공개 10초
    const n = room.fileIds.length;
    const galRows = Math.ceil(n / 2) * (size + 3) + 2;
    const galCols = (c.pcol + 2 + size) - (PX.grid.col - 1) + 1;
    setAll(s => {
      s.getRange(c.galleryRow, PX.grid.col - 1, galRows, galCols)
        .clearContent()
        .setBackground('#FFFFFF')
        .setBorder(false, false, false, false, false, false);
      pxFixPanel(s, c);
      pxPaintFrame(s, size);
      s.getRange(c.round.row, c.round.col).setValue(roundNo + ' / ' + room.rounds);
      s.getRange(c.state.row, c.state.col).setValue('👀 암기!');
      s.getRange(PX.grid.row, PX.grid.col, size, size).clearContent().setBackgrounds(answerBg);
    });
    bannerAll('👀 라운드 ' + roundNo + ' — 이 그림을 10초 동안 기억하세요!', '#D84315');
    SpreadsheetApp.flush();
    Utilities.sleep(PX.memorizeMs);

    // 2) 지우고 60초 그리기 (테두리·프레임 재도색 — 붙여넣기가 지워놨을 수 있음)
    setAll(s => {
      s.getRange(PX.grid.row, PX.grid.col, size, size).clearContent().setBackground('#FFFFFF');
      pxRepaintGridBorders(s, size);
      pxPaintFrame(s, size);
      s.getRange(c.state.row, c.state.col).setValue('🎨 그리는 중');
    });
    bannerAll('🖌 60초! 팔레트 칸을 복사해 붙여넣거나, 채우기 색으로 칠해 그리세요! (숫자 입력도 OK)', '#1565C0');
    SpreadsheetApp.flush();
    Utilities.sleep(PX.drawMs - 15000);
    bannerAll('⏰ 15초 남았습니다!', '#D84315');
    SpreadsheetApp.flush();
    Utilities.sleep(15000);

    // 3) 그림 수거 + 갤러리 20초
    const fresh = updateRoom(roomId, () => {}); // 닉네임 최신화
    if (fresh && fresh.names) room.names = fresh.names;
    // 수거: 숫자 입력과 채우기 색 둘 다 인정 (숫자 우선, 색은 팔레트 최근접 매칭)
    const drawings = sheets.map(s => {
      const rng = s.getRange(PX.grid.row, PX.grid.col, size, size);
      const vals = rng.getValues();
      const bgs = rng.getBackgrounds();
      return vals.map((row, i) =>
        row.map((v, j) => pxCellIndex(v, bgs[i][j], diff.colors)));
    });

    setAll(s => {
      drawings.forEach((d, p) => {
        const pos = pxGalleryPos(c, size, p);
        // 제목을 그림 폭만큼 병합 — 긴 닉네임도 안 잘린다
        s.getRange(pos.gr, pos.gc, 1, size).breakApart().merge();
        s.getRange(pos.gr, pos.gc).setValue('🎨 ' + pxName(room, p)).setFontWeight('bold');
        const bgGrid = d.map(r => r.map(x => (x ? PX.colors[Number(x)] : '#FFFFFF')));
        s.getRange(pos.gr + 1, pos.gc, size, size).clearContent().setBackgrounds(bgGrid)
          .setBorder(true, true, true, true, true, true, '#DDDDDD', SpreadsheetApp.BorderStyle.SOLID);
      });
      s.getRange(c.state.row, c.state.col).setValue('👀 감상 타임');
    });
    bannerAll('👀 다들 어떻게 그렸을까? 20초간 감상하세요… 누가 1등일까요?', '#6A1B9A');
    SpreadsheetApp.flush();
    Utilities.sleep(PX.galleryMs);

    // 4) 정답 공개 + 채점
    // 채점: 정답 픽셀과 그린 픽셀의 합집합 기준 일치율 (빈 판 = 0%)
    const results = drawings.map((d, p) => {
      let match = 0;
      let denom = 0;
      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
          const a = answer[i][j] || '';
          const v = d[i][j] || '';
          if (a || v) {
            denom++;
            if (a === v) match++;
          }
        }
      }
      return { p: p, pct: denom ? Math.round((match / denom) * 100) : 0 };
    });
    const best = Math.max.apply(null, results.map(x => x.pct));
    results.forEach(x => { if (x.pct === best) room.scores[x.p]++; });
    const winners = results.filter(x => x.pct === best).map(x => pxName(room, x.p)).join(', ');

    setAll((s, i) => {
      s.getRange(PX.grid.row, PX.grid.col, size, size).clearContent().setBackgrounds(answerBg);
      pxRepaintGridBorders(s, size);
      pxPaintFrame(s, size);
      s.getRange(c.score.row, c.score.col).setValue(room.scores[i]);
      s.getRange(c.state.row, c.state.col).setValue(results[i].pct + '% 일치');
      // 갤러리 제목에 일치율 부착 — 순위는 각 그림 옆에서 확인
      results.forEach(x => {
        const pos = pxGalleryPos(c, size, x.p);
        const crown = x.pct === best ? ' 🏆' : '';
        s.getRange(pos.gr, pos.gc).setValue('🎨 ' + pxName(room, x.p) + ' — ' + x.pct + '%' + crown);
      });
    });
    bannerAll('🏆 정답은 「' + art.name + '」! 1등: ' + winners + ' (' + best + '%)', '#F57F17');
    SpreadsheetApp.flush();
    Utilities.sleep(8000);

    // 5) 다음 라운드 or 최종 결과
    room.round = roundNo;
    if (roundNo >= room.rounds) {
      const top = Math.max.apply(null, room.scores);
      const champs = room.scores.map((v, i) => v === top ? pxName(room, i) : null)
        .filter(Boolean).join(', ');
      bannerAll('👑 최종 우승: ' + champs + ' (' + top + '점)! 🎉', '#F57F17');
      setAll(s => s.getRange(c.state.row, c.state.col).setValue('게임 종료'));
    } else {
      bannerAll('☕ 라운드 ' + roundNo + ' 종료! 준비되면 아무나 [라운드 시작]을 체크하세요', '#188038');
      setAll(s => s.getRange(c.state.row, c.state.col).setValue('대기 중'));
    }
  } finally {
    updateRoom(roomId, rm => {
      rm.phase = 'idle';
      rm.round = room.round;
      rm.scores = room.scores;
      rm.usedArt = room.usedArt;
    });
    SpreadsheetApp.flush();
  }
}

function pxName(room, i) {
  return (room.names && room.names[i]) || '플레이어' + (i + 1);
}

/** p번째 플레이어의 갤러리 위치 — 왼쪽 열은 캔버스 아래, 오른쪽 열은 패널 열 건너편 */
function pxGalleryPos(c, size, p) {
  return {
    gr: c.galleryRow + Math.floor(p / 2) * (size + 3),
    gc: p % 2 === 0 ? PX.grid.col : c.pcol + 2,
  };
}

/** 셀 하나를 팔레트 번호로 정규화: 숫자 입력 우선, 아니면 배경색 최근접 매칭 */
function pxCellIndex(value, bg, maxColors) {
  const v = String(value == null ? '' : value).trim();
  if (/^[1-5]$/.test(v) && Number(v) <= maxColors) return v;
  return pxColorToIndex(bg, maxColors);
}

/** 배경색 hex를 가장 가까운 팔레트 번호로 변환 (흰색·무색 = 빈칸) */
function pxColorToIndex(hex, maxColors) {
  if (!hex) return '';
  const h = String(hex).toLowerCase();
  if (h === '#ffffff' || h === 'white') return '';
  const toRgb = x => [
    parseInt(x.slice(1, 3), 16),
    parseInt(x.slice(3, 5), 16),
    parseInt(x.slice(5, 7), 16),
  ];
  let target;
  try {
    target = toRgb(h);
  } catch (err) {
    return '';
  }
  if (target.some(isNaN)) return '';
  // 아주 어두운 색(액자 검정 등)은 빈칸 취급 — 팔레트에 검정 계열이 없으므로
  if (Math.max(target[0], target[1], target[2]) < 80) return '';

  let best = '';
  let bestD = Infinity;
  const candidates = { '': '#ffffff' };
  for (let v = 1; v <= maxColors; v++) candidates[String(v)] = PX.colors[v].toLowerCase();
  for (const k in candidates) {
    const c = toRgb(candidates[k]);
    const d2 = Math.pow(c[0] - target[0], 2) + Math.pow(c[1] - target[1], 2) + Math.pow(c[2] - target[2], 2);
    if (d2 < bestD) { bestD = d2; best = k; }
  }
  return best;
}
