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
  horse: {
    name: '경마',
    minPlayers: 1,
    maxPlayers: 1, // 파일 1개를 전원이 공유
    roleLabel: () => '🏇 전원 입장 링크',
    build: buildHorseRoom,
    onEdit: handleHorseEdit,
  },
  liar: {
    name: '라이어 게임',
    minPlayers: 3,
    maxPlayers: 8,
    roleLabel: i => '🎭 플레이어 ' + (i + 1),
    build: buildLiarRoom,
    onEdit: handleLiarEdit,
  },
  maze: {
    name: '3D 미로 탈출',
    minPlayers: 2,
    maxPlayers: 2,
    roleLabel: i => '🌀 플레이어 ' + (i + 1),
    build: buildMazeRoom,
    onEdit: handleMazeEdit,
  },
  // 슬라이드 게임 — 시트가 아니라 구글 슬라이드 템플릿을 복제해서 방을 만든다.
  // 템플릿(스크립트 설치 완료본)의 파일 ID를 스크립트 속성에 등록해야 한다.
  quiz: {
    name: '퀴즈쇼',
    slides: true,
    templateProp: 'QUIZ_TEMPLATE_ID',
    roleLabel: () => '🧠 전원 입장 링크',
  },
  // doors(운명의 문)는 폐기 결정으로 제외 — 코드는 slides-doors.gs에 보존
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
    if (params.debug === 'values' && params.fileId && params.range) {
      // 개발 검증용 — 키 없이는 차단 (라이어 제시어 등 비밀 셀 유출 방지)
      if (params.key !== 'sheeet-qa-7f3a') throw new Error('debug key required');
      const dbgSs = SpreadsheetApp.openById(String(params.fileId));
      const dbgSheet = params.sheetName
        ? dbgSs.getSheetByName(String(params.sheetName))
        : dbgSs.getSheets()[0];
      out = {
        ok: true,
        sheet: dbgSheet.getName(),
        maxCols: dbgSheet.getMaxColumns(),
        maxRows: dbgSheet.getMaxRows(),
        values: dbgSheet.getRange(String(params.range)).getDisplayValues(),
      };
    } else if (params.ads === 'list') {
      out = { ok: true, ads: adsList() };
    } else if (params.admin === 'setprop' && params.prop && params.value) {
      // 호스트 전용 설정 등록 (키 게이트 + 허용 목록) — 슬라이드 템플릿 ID 등록용
      if (params.key !== 'sheeet-qa-7f3a') throw new Error('admin key required');
      const allowed = ['QUIZ_TEMPLATE_ID', 'DOORS_TEMPLATE_ID'];
      if (allowed.indexOf(String(params.prop)) < 0) throw new Error('허용되지 않은 속성');
      PropertiesService.getScriptProperties()
        .setProperty(String(params.prop), String(params.value));
      out = { ok: true, set: params.prop };
    } else if (!params.game) {
      out = { ok: true, service: 'SHEEET room factory', version: 'v11', games: Object.keys(GAMES) };
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

// ---------- 셀 광고판 (The Million Dollar Sheet) ----------
// 광고 장부도 시트다: 호스트 드라이브의 "SHEEET 광고판 장부"에 한 줄 적으면
// 랜딩 페이지의 셀 광고판에 게재된다. 게재 열이 TRUE인 행만 노출.

function adsList() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('ADS_SHEET_ID');
  if (!id) {
    const ss = SpreadsheetApp.create('SHEEET 광고판 장부');
    const sh = ss.getSheets()[0].setName('광고');
    sh.getRange(1, 1, 1, 6)
      .setValues([['이름', '이모지', '색상(hex)', '링크', '칸수', '게재(TRUE만 노출)']])
      .setFontWeight('bold');
    sh.getRange(2, 1, 2, 6).setValues([
      ['SHEEET — 시트가 곧 게임방', '🎮', '#188038', 'https://sheeet-zeta.vercel.app', 10, true],
      ['이 칸, 당신의 광고 자리', '💰', '#F9A825', 'mailto:wjdgocks777@gmail.com?subject=SHEEET 셀 광고 문의', 6, true],
    ]);
    sh.setColumnWidths(1, 6, 150);
    id = ss.getId();
    props.setProperty('ADS_SHEET_ID', id);
  }
  const rows = SpreadsheetApp.openById(id).getSheetByName('광고')
    .getDataRange().getValues().slice(1);
  return rows
    .filter(r => r[0] && (r[5] === true || String(r[5]).toLowerCase() === 'true'))
    .map(r => ({
      name: String(r[0]).slice(0, 60),
      emoji: String(r[1] || '⬜').slice(0, 8),
      color: /^#[0-9A-Fa-f]{6}$/.test(String(r[2])) ? String(r[2]) : '#CFD8DC',
      url: /^(https?:\/\/|mailto:)/.test(String(r[3])) ? String(r[3]) : '',
      cells: Math.min(Math.max(Number(r[4]) || 1, 1), 60),
    }));
}

// ---------- 방 생성 ----------

function createRoom(game, players, opts) {
  const spec = GAMES[game];
  if (!spec) throw new Error('없는 게임: ' + game);
  if (spec.slides) return createSlidesRoom(spec);
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

/** 슬라이드 게임 방 — 스크립트가 설치된 템플릿 프레젠테이션을 복제해서 연다.
 *  전원이 같은 링크 하나로 입장하고, 게임 루프는 호스트의 사이드바가 돌리므로
 *  시트 게임과 달리 트리거·방 상태 저장이 필요 없다. */
function createSlidesRoom(spec) {
  const templateId = PropertiesService.getScriptProperties().getProperty(spec.templateProp);
  if (!templateId) {
    throw new Error(
      spec.name + ' 템플릿이 등록되지 않았습니다 — 스크립트 속성 ' +
      spec.templateProp + '에 템플릿 프레젠테이션 파일 ID를 넣어주세요 (SETUP.md §9)');
  }
  // 빈 템플릿이어도 OK — 방(복제본)을 로그인 사용자가 처음 열면 onOpen이 판을 자동 생성한다.
  const roomId = Utilities.getUuid().slice(0, 8);
  const copy = DriveApp.getFileById(templateId)
    .makeCopy('SLIIIDE ' + spec.name + ' ' + roomId);
  copy.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
  return {
    ok: true,
    roomId: roomId,
    game: spec.name,
    links: [{
      role: spec.roleLabel(0),
      url: 'https://docs.google.com/presentation/d/' + copy.getId() + '/edit',
    }],
    hint: '전원이 같은 링크로 입장합니다. 구글에 로그인한 사람이 처음 열면 게임판이 자동으로 차려집니다(수십 초). 게임 시작은 그 사람이 상단 게임 메뉴에서 — 첫 실행 때 권한 승인 창이 한 번 뜹니다.',
  };
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
  galleryMs: 10000, // 감상 타임 — 남의 그림에 관심은 10초면 충분하다
};

// 난이도별 시간: 판이 클수록 외울 것도 그릴 것도 많다
const PX_DIFFS = {
  easy: { size: 8, colors: 3, memorizeMs: 8000, drawMs: 40000, label: '쉬움 (8×8·3색)' },
  normal: { size: 10, colors: 4, memorizeMs: 10000, drawMs: 60000, label: '보통 (10×10·4색)' },
  hard: { size: 12, colors: 5, memorizeMs: 15000, drawMs: 90000, label: '어려움 (12×12·5색)' },
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
    // 배너는 패널 직전까지 넓게 (긴 한글 문구가 잘리지 않게)
    banner: { row: 2, col: 2, width: pcol - 3 },
    timer: { row: 2, col: pcol }, // 배너 옆 남는 공간 = 실시간 카운트다운
    legend: { row: 3, col: PX.grid.col },
    nickLabel: { row: 5, col: pcol }, nick: { row: 6, col: pcol },
    roundLabel: { row: 8, col: pcol }, round: { row: 9, col: pcol },
    scoreLabel: { row: 11, col: pcol }, score: { row: 12, col: pcol },
    startLabel: { row: 14, col: pcol }, start: { row: 15, col: pcol },
    stateLabel: { row: 17, col: pcol }, state: { row: 18, col: pcol },
    doneLabel: { row: 20, col: pcol }, done: { row: 21, col: pcol },
    // 갤러리는 패널(21행)보다 아래에서 시작
    galleryRow: Math.max(PX.grid.row + size + 3, 24),
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
    [c.nickLabel, '1️⃣ 내 닉네임 ↓'],
    [c.roundLabel, '라운드'],
    [c.scoreLabel, '내 점수'],
    [c.startLabel, '라운드 시작 ↓'],
    [c.stateLabel, '상태'],
    [c.doneLabel, '✅ 다 그렸으면 ↓'],
  ];
  labels.forEach(([p, txt]) =>
    sheet.getRange(p.row, p.col).setValue(txt)
      .setFontWeight('bold').setBackground('#FFFFFF').setFontColor('#000000'));
  [c.round, c.score, c.state, c.done].forEach(p =>
    sheet.getRange(p.row, p.col).setBackground('#FFFFFF').setFontColor('#000000'));
  sheet.getRange(c.nick.row, c.nick.col).setBackground(NICK_YELLOW).setFontColor('#000000');
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

  // 팔레트 조건부 서식(숫자 입력=색칠, 숫자 숨김)은 캔버스 안쪽에만 적용.
  // 시트 전체에 걸면 패널의 점수 숫자(1~5점)까지 색으로 가려지는 사고가 난다.
  const canvas = sheet.getRange(PX.grid.row, PX.grid.col, size, size);
  const rules = [];
  for (let v = 1; v <= 5; v++) {
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(String(v))
      .setBackground(PX.colors[v])
      .setFontColor(PX.colors[v])
      .setRanges([canvas])
      .build());
  }
  sheet.setConditionalFormatRules(rules);

  // 배너 + 팔레트 안내
  sheet.getRange(c.banner.row, c.banner.col, 1, c.banner.width).merge();
  sheet.setRowHeight(2, 46);
  sheet.getRange(c.banner.row, c.banner.col)
    .setValue('👋 닉네임 입력 → 아무나 [라운드 시작] 체크!')
    .setFontWeight('bold').setFontSize(12)
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setWrap(true) // 긴 문구는 두 줄로 — 잘리지 않는다
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
  sheet.getRange(c.done.row, c.done.col).insertCheckboxes();
  sheet.getRange(c.timer.row, c.timer.col)
    .setFontSize(16).setFontWeight('bold').setFontColor('#D84315');
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

  // "다 그렸어요" 확정 체크 — 그리기 시간에만 유효, 전원 체크 시 즉시 다음 단계
  if (r === c.done.row && col === c.done.col) {
    if (e.value !== 'TRUE') return;
    if (room.phase !== 'draw') {
      e.range.setValue(false);
      return;
    }
    if (!room.doneFlags) room.doneFlags = room.fileIds.map(() => false);
    room.doneFlags[srcIdx] = true;
    sheet.getRange(c.state.row, c.state.col).setValue('✅ 제출 완료!');
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
  const setTimerAll = txt => setAll(s =>
    s.getRange(c.timer.row, c.timer.col).setValue(txt));

  /**
   * 조용한 타이머 — 평소에는 숫자를 표시하지 않는다.
   * (시트 갱신 왕복이 0.5~1초라 초 단위 카운트가 씹혀 보이는 문제 → 아예 안 세는 걸로)
   * 남은 시간 10초·5초 시점에만 빨간 경고를 띄운다. checkAllDone이면 전원 제출 시 조기 종료.
   */
  const countdown = (ms, checkAllDone) => {
    const end = Date.now() + ms;
    let warned10 = false;
    let warned5 = false;
    while (true) {
      const left = end - Date.now();
      if (left <= 0) break;

      if (!warned10 && left <= 10500) {
        warned10 = true;
        setAll(s => s.getRange(c.timer.row, c.timer.col)
          .setValue('⏰ ' + Math.ceil(left / 1000) + '초!')
          .setFontColor('#FFFFFF').setBackground(FLASH_RED).setFontSize(20));
        if (checkAllDone) bannerAll('⏰ 곧 끝납니다! 서두르세요!', FLASH_RED);
        SpreadsheetApp.flush();
      } else if (warned10 && !warned5 && left <= 5500) {
        warned5 = true;
        setTimerAll('⏰ ' + Math.ceil(left / 1000) + '초!');
        SpreadsheetApp.flush();
      }

      // 다음 경계(10초 전·5초 전·종료)까지 자되, done 폴링 때문에 최대 5초 단위로 끊는다
      const boundary = left > 10500 ? left - 10000 : left > 5500 ? left - 5000 : left;
      Utilities.sleep(Math.max(500, Math.min(checkAllDone ? 5000 : boundary, boundary)));

      if (checkAllDone) {
        const fr = updateRoom(roomId, () => {});
        if (fr && fr.doneFlags && fr.doneFlags.length && fr.doneFlags.every(Boolean)) {
          bannerAll('🙌 전원 제출 완료! 바로 넘어갑니다', '#188038');
          SpreadsheetApp.flush();
          Utilities.sleep(1200);
          break;
        }
      }
    }
    // 타이머 스타일 원상복귀
    setAll(s => s.getRange(c.timer.row, c.timer.col)
      .setValue('').setFontColor('#D84315').setBackground('#FFFFFF').setFontSize(16));
  };

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
    bannerAll('👀 라운드 ' + roundNo + ' — 이 그림을 ' + Math.round(diff.memorizeMs / 1000) + '초 동안 기억하세요!', '#D84315');
    countdown(diff.memorizeMs, false);

    // 2) 지우고 60초 그리기 (테두리·프레임 재도색 — 붙여넣기가 지워놨을 수 있음)
    setAll(s => {
      s.getRange(PX.grid.row, PX.grid.col, size, size).clearContent().setBackground('#FFFFFF');
      pxRepaintGridBorders(s, size);
      pxPaintFrame(s, size);
      s.getRange(c.state.row, c.state.col).setValue('🎨 그리는 중');
    });
    setAll(s => s.getRange(c.done.row, c.done.col).setValue(false));
    updateRoom(roomId, rm => {
      rm.phase = 'draw';
      rm.doneFlags = room.fileIds.map(() => false);
    });
    bannerAll('🖌 ' + Math.round(diff.drawMs / 1000) + '초! 기억대로 그리세요. 다 그리면 [다 그렸으면] 체크 — 전원 체크하면 바로 채점', '#1565C0');
    countdown(diff.drawMs, true);
    updateRoom(roomId, rm => { rm.phase = 'running'; });

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
    bannerAll('👀 다들 어떻게 그렸을까? 누가 1등일까요?', '#6A1B9A');
    countdown(PX.galleryMs, false);

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

// ---------- 경마 ----------
// 링크 1개를 전원이 공유한다(베팅은 공개 정보라 비밀 분리가 필요 없다).
// 베팅 표에 닉네임+말 번호를 적고 [레이스 시작] 체크 → 랜덤 레이스 애니메이션 → 적중자 발표.

const HR = {
  sheet: '경마',
  laneRow: 4,        // 1번 말 레인 행 (5개 연속)
  trackCol: 3,       // C열 = 출발선
  trackLen: 21,      // 달리는 칸 수 (마지막 오프셋 = 결승)
  betRow: 13,        // 베팅 입력 시작 행
  betMax: 12,
  start: { row: 12, col: 10 },  // J12 체크박스 (라벨은 J11) — 베팅 안내문과 겹치지 않게
  banner: { row: 2, col: 2, width: 22 },
  laneColors: ['#EAF6EA', '#DFF0DF'],
  gold: '#FFD966',
};
const HR_NUMS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

function buildHorseRoom(roomId, n) {
  const ss = SpreadsheetApp.create('SHEEET 경마 ' + roomId);
  const sheet = ss.getSheets()[0].setName(HR.sheet);
  drawHorseBoard(sheet);
  DriveApp.getFileById(ss.getId())
    .setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
  return { fileIds: [ss.getId()], urls: [ss.getUrl()], phase: 'idle' };
}

function drawHorseBoard(sheet) {
  const finishCol = HR.trackCol + HR.trackLen;
  const needCols = finishCol + 4;
  if (sheet.getMaxColumns() < needCols) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), needCols - sheet.getMaxColumns());
  }

  // 배너
  sheet.getRange(HR.banner.row, HR.banner.col, 1, HR.banner.width).merge();
  sheet.setRowHeight(2, 46);
  sheet.getRange(HR.banner.row, HR.banner.col)
    .setValue('🏇 베팅 표에 닉네임과 말 번호(1~5)를 적고, [레이스 시작]을 체크하세요!')
    .setFontWeight('bold').setFontSize(12)
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setWrap(true).setBackground('#FFF8E1');

  // 트랙 (5레인)
  hrResetTrack(sheet);
  sheet.setColumnWidth(2, 40);
  sheet.setColumnWidths(HR.trackCol, HR.trackLen + 1, 27);
  sheet.setRowHeights(HR.laneRow, 5, 32);

  // 베팅 표 (안내문은 짧게 — 오른쪽 시작 라벨과 겹치지 않는 길이)
  sheet.getRange(11, 3).setValue('💰 베팅하세요 ↓').setFontWeight('bold');
  sheet.getRange(12, 3).setValue('닉네임').setFontWeight('bold');
  sheet.getRange(12, 4).setValue('말 번호').setFontWeight('bold');
  sheet.getRange(HR.betRow, 3, HR.betMax, 2)
    .setBackground(NICK_YELLOW)
    .setBorder(true, true, true, true, true, true, '#F9A825', SpreadsheetApp.BorderStyle.SOLID);
  sheet.setColumnWidth(3, 110);
  sheet.setColumnWidth(4, 70);

  // 시작 체크박스 — HR.start 좌표 그대로 사용 (라벨은 한 칸 위)
  sheet.getRange(HR.start.row - 1, HR.start.col)
    .setValue('🏁 레이스 시작 ↓').setFontWeight('bold');
  sheet.getRange(HR.start.row, HR.start.col).insertCheckboxes();
}

/** 트랙을 출발 상태로 다시 그린다 */
function hrResetTrack(sheet) {
  const finishCol = HR.trackCol + HR.trackLen;
  for (let i = 0; i < 5; i++) {
    const row = HR.laneRow + i;
    sheet.getRange(row, 2).setValue(HR_NUMS[i]).setFontSize(14)
      .setHorizontalAlignment('center');
    sheet.getRange(row, HR.trackCol, 1, HR.trackLen)
      .clearContent().setBackground(HR.laneColors[i % 2]);
    sheet.getRange(row, HR.trackCol).setValue('🏇').setFontSize(16)
      .setHorizontalAlignment('center');
    sheet.getRange(row, finishCol).setValue('🏁').setBackground('#37474F')
      .setFontSize(14).setHorizontalAlignment('center');
  }
}

function handleHorseEdit(e, room, roomId) {
  const sheet = e.range.getSheet();
  if (sheet.getName() !== HR.sheet) return;
  if (e.range.getRow() === HR.start.row && e.range.getColumn() === HR.start.col
      && e.value === 'TRUE') {
    e.range.setValue(false);
    if (room.phase !== 'idle') return;
    room.phase = 'racing';
    return () => runHorseRace(roomId, JSON.parse(JSON.stringify(room)));
  }
}

function runHorseRace(roomId, room) {
  const sheet = SpreadsheetApp.openById(room.fileIds[0]).getSheetByName(HR.sheet);
  const banner = msg => sheet.getRange(HR.banner.row, HR.banner.col).setValue(msg);
  try {
    // 베팅 수거
    const rows = sheet.getRange(HR.betRow, 3, HR.betMax, 2).getValues();
    const bets = [];
    rows.forEach(r => {
      const name = String(r[0] || '').trim().slice(0, 12);
      const horse = Number(r[1]);
      if (name && horse >= 1 && horse <= 5) bets.push({ name: name, horse: horse });
    });

    hrResetTrack(sheet);
    banner('📣 ' + (bets.length ? bets.length + '명 베팅 완료! ' : '베팅 없이 관전 레이스! ') + '준비…');
    SpreadsheetApp.flush();
    Utilities.sleep(1500);
    banner('🏇 출발!!!');
    SpreadsheetApp.flush();

    // 레이스 루프
    const pos = [0, 0, 0, 0, 0];
    let winner = -1;
    for (let tick = 0; tick < 45 && winner < 0; tick++) {
      for (let i = 0; i < 5; i++) {
        if (pos[i] >= HR.trackLen - 1) continue;
        const step = Math.random() < 0.15 ? 0 : Math.random() < 0.7 ? 1 : 2;
        const prev = pos[i];
        pos[i] = Math.min(pos[i] + step, HR.trackLen - 1);
        if (pos[i] !== prev) {
          const row = HR.laneRow + i;
          sheet.getRange(row, HR.trackCol + prev).setValue('');
          sheet.getRange(row, HR.trackCol + pos[i]).setValue('🏇').setFontSize(16)
            .setHorizontalAlignment('center');
        }
      }
      const leaders = [];
      for (let i = 0; i < 5; i++) if (pos[i] >= HR.trackLen - 1) leaders.push(i);
      if (leaders.length) winner = leaders[Math.floor(Math.random() * leaders.length)];
      SpreadsheetApp.flush();
      Utilities.sleep(700);
    }
    if (winner < 0) winner = pos.indexOf(Math.max.apply(null, pos)); // 안전장치

    // 우승 연출 + 적중자 발표
    const row = HR.laneRow + winner;
    for (let k = 0; k < 3; k++) {
      sheet.getRange(row, HR.trackCol, 1, HR.trackLen).setBackground(HR.gold);
      SpreadsheetApp.flush();
      Utilities.sleep(350);
      sheet.getRange(row, HR.trackCol, 1, HR.trackLen).setBackground(HR.laneColors[winner % 2]);
      SpreadsheetApp.flush();
      Utilities.sleep(250);
    }
    sheet.getRange(row, HR.trackCol, 1, HR.trackLen).setBackground(HR.gold);

    const hits = bets.filter(b => b.horse === winner + 1).map(b => b.name);
    banner('🏆 ' + HR_NUMS[winner] + ' 번 말 우승! ' +
      (bets.length === 0 ? '' : hits.length ? '💰 적중: ' + hits.join(', ') + '!' : '적중자 없음 😭') +
      ' — 다시 하려면 [레이스 시작] 체크');
    // 베팅 표 결과 표시: 적중 행 금색, 나머지 회색
    rows.forEach((r, idx) => {
      const name = String(r[0] || '').trim();
      const horse = Number(r[1]);
      if (!name || !(horse >= 1 && horse <= 5)) return;
      sheet.getRange(HR.betRow + idx, 3, 1, 2)
        .setBackground(horse === winner + 1 ? HR.gold : '#ECEFF1');
    });
  } finally {
    updateRoom(roomId, rm => { rm.phase = 'idle'; });
    SpreadsheetApp.flush();
  }
}

// ---------- 라이어 게임 ----------
// 1인 1링크의 비밀 유지력을 활용: 전원이 제시어를 보지만 라이어 한 명만 정체 카드를 본다.

const LIAR_WORDS = [
  // 음식
  { cat: '음식', word: '김치찌개' },
  { cat: '음식', word: '삼겹살' },
  { cat: '음식', word: '라면' },
  { cat: '음식', word: '떡볶이' },
  { cat: '음식', word: '치킨' },

  // 동물
  { cat: '동물', word: '강아지' },
  { cat: '동물', word: '고양이' },
  { cat: '동물', word: '호랑이' },
  { cat: '동물', word: '코끼리' },
  { cat: '동물', word: '토끼' },

  // 장소
  { cat: '장소', word: '찜질방' },
  { cat: '장소', word: '병원' },
  { cat: '장소', word: '노래방' },
  { cat: '장소', word: '시장' },
  { cat: '장소', word: '학교' },

  // 직업
  { cat: '직업', word: '의사' },
  { cat: '직업', word: '선생님' },
  { cat: '직업', word: '경찰' },
  { cat: '직업', word: '요리사' },
  { cat: '직업', word: '소방관' },

  // 물건
  { cat: '물건', word: '우산' },
  { cat: '물건', word: '냉장고' },
  { cat: '물건', word: '칫솔' },
  { cat: '물건', word: '거울' },
  { cat: '물건', word: '베개' },

  // 스포츠
  { cat: '스포츠', word: '축구' },
  { cat: '스포츠', word: '야구' },
  { cat: '스포츠', word: '농구' },
  { cat: '스포츠', word: '수영' },
  { cat: '스포츠', word: '탁구' },

  // 탈것
  { cat: '탈것', word: '버스' },
  { cat: '탈것', word: '지하철' },
  { cat: '탈것', word: '자전거' },
  { cat: '탈것', word: '비행기' },
  { cat: '탈것', word: '택시' },

  // 과일
  { cat: '과일', word: '사과' },
  { cat: '과일', word: '바나나' },
  { cat: '과일', word: '수박' },
  { cat: '과일', word: '딸기' },
  { cat: '과일', word: '포도' },
];

const LR = {
  sheet: '라이어',
  banner: { row: 2, col: 2, width: 12 },     // B2:M2
  card: { row: 4, col: 2, rows: 4, cols: 8 }, // 제시어 카드 (B4:I7 병합)
  rosterRow: 10, rosterCol: 2,                // 참가자 명단
  pcol: 11,                                   // 우측 패널 (K열)
};

function buildLiarRoom(roomId, n) {
  const files = [];
  for (let i = 0; i < n; i++) {
    const ss = SpreadsheetApp.create('SHEEET 라이어 ' + roomId + ' — P' + (i + 1));
    const sheet = ss.getSheets()[0].setName(LR.sheet);
    drawLiarBoard(sheet, i, n);
    DriveApp.getFileById(ss.getId())
      .setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
    files.push({ id: ss.getId(), url: ss.getUrl() });
  }
  return {
    fileIds: files.map(f => f.id),
    urls: files.map(f => f.url),
    phase: 'idle',
    names: {},
    votes: {},
    usedWords: [],
  };
}

function lrCells() {
  const p = LR.pcol;
  return {
    nickLabel: { row: 4, col: p }, nick: { row: 5, col: p },
    startLabel: { row: 7, col: p }, start: { row: 8, col: p },
    voteLabel: { row: 10, col: p }, vote: { row: 11, col: p },
    stateLabel: { row: 13, col: p }, state: { row: 14, col: p },
  };
}

function drawLiarBoard(sheet, idx, n) {
  const c = lrCells();
  sheet.getRange(LR.banner.row, LR.banner.col, 1, LR.banner.width).merge();
  sheet.setRowHeight(2, 46);
  sheet.getRange(LR.banner.row, LR.banner.col)
    .setValue('🎭 닉네임 입력 → 전원 모이면 아무나 [게임 시작] 체크!')
    .setFontWeight('bold').setFontSize(12)
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setWrap(true).setBackground('#F3E5F5');

  // 제시어 카드
  sheet.getRange(LR.card.row, LR.card.col, LR.card.rows, LR.card.cols).merge();
  sheet.getRange(LR.card.row, LR.card.col)
    .setValue('🃏 게임이 시작되면 여기에 제시어가 뜹니다\n(다른 사람에게 화면을 보여주지 마세요!)')
    .setFontSize(16).setFontWeight('bold').setWrap(true)
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setBackground('#263238').setFontColor('#ECEFF1');
  sheet.setRowHeights(LR.card.row, LR.card.rows, 34);

  // 참가자 명단
  sheet.getRange(LR.rosterRow - 1, LR.rosterCol).setValue('👥 참가자 (투표는 번호로!)')
    .setFontWeight('bold');
  for (let i = 0; i < n; i++) {
    sheet.getRange(LR.rosterRow + i, LR.rosterCol)
      .setValue((i + 1) + '. 플레이어' + (i + 1) + (i === idx ? '  ← 나' : ''));
  }

  // 우측 패널 (세로 배치)
  const put = (pos, txt) => sheet.getRange(pos.row, pos.col)
    .setValue(txt).setFontWeight('bold');
  put(c.nickLabel, '1️⃣ 내 닉네임 ↓');
  sheet.getRange(c.nick.row, c.nick.col).setBackground(NICK_YELLOW)
    .setBorder(true, true, true, true, false, false, '#F9A825', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  put(c.startLabel, '게임 시작 ↓');
  sheet.getRange(c.start.row, c.start.col).insertCheckboxes();
  put(c.voteLabel, '🗳 라이어 투표 (번호) ↓');
  sheet.getRange(c.vote.row, c.vote.col).setBackground('#E3F2FD')
    .setBorder(true, true, true, true, false, false, '#1E88E5', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  put(c.stateLabel, '상태');
  sheet.getRange(c.state.row, c.state.col).setValue('대기 중');
  sheet.setColumnWidth(LR.pcol, 170);
  sheet.setColumnWidth(LR.rosterCol, 160);
}

function handleLiarEdit(e, room, roomId) {
  const srcIdx = room.fileIds.indexOf(e.source.getId());
  if (srcIdx < 0) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== LR.sheet) return;
  const c = lrCells();
  const r = e.range.getRow();
  const col = e.range.getColumn();

  // 닉네임 → 전원 명단 갱신
  if (r === c.nick.row && col === c.nick.col) {
    room.names[srcIdx] = String(e.value || '').trim().slice(0, 12);
    lrSyncRoster(room);
    return;
  }

  // 게임 시작 (새 라운드 겸용)
  if (r === c.start.row && col === c.start.col && e.value === 'TRUE') {
    e.range.setValue(false);
    if (room.phase === 'discuss') return; // 진행 중엔 무시
    lrDealRound(room);
    return;
  }

  // 투표
  if (r === c.vote.row && col === c.vote.col) {
    if (room.phase !== 'discuss') {
      e.range.setValue('');
      return;
    }
    const v = Number(String(e.value || '').trim());
    const n = room.fileIds.length;
    if (!(v >= 1 && v <= n)) {
      e.range.setValue('');
      sheet.getRange(c.state.row, c.state.col).setValue('⚠️ 1~' + n + ' 번호만!');
      return;
    }
    room.votes[srcIdx] = v;
    const cnt = Object.keys(room.votes).length;
    lrEachSheet(room, s => s.getRange(c.state.row, c.state.col)
      .setValue('🗳 투표 ' + cnt + ' / ' + n));
    if (cnt >= n) lrReveal(room);
    return;
  }
}

function lrName(room, i) {
  return (room.names && room.names[i]) || '플레이어' + (i + 1);
}

function lrEachSheet(room, fn) {
  room.fileIds.forEach((id, i) =>
    fn(SpreadsheetApp.openById(id).getSheetByName(LR.sheet), i));
}

function lrSyncRoster(room) {
  const n = room.fileIds.length;
  lrEachSheet(room, (s, me) => {
    for (let i = 0; i < n; i++) {
      s.getRange(LR.rosterRow + i, LR.rosterCol)
        .setValue((i + 1) + '. ' + lrName(room, i) + (i === me ? '  ← 나' : ''));
    }
  });
}

/** 새 라운드: 제시어 뽑고 라이어 지정, 각자 비밀 카드 배포 */
function lrDealRound(room) {
  const pool = LIAR_WORDS.map((_, i) => i).filter(i => room.usedWords.indexOf(i) < 0);
  const wIdx = pool.length ? pool[Math.floor(Math.random() * pool.length)]
                           : Math.floor(Math.random() * LIAR_WORDS.length);
  room.usedWords.push(wIdx);
  const pick = LIAR_WORDS[wIdx];
  room.liar = Math.floor(Math.random() * room.fileIds.length);
  room.votes = {};
  room.phase = 'discuss';
  room.word = pick.word;
  room.cat = pick.cat;

  const c = lrCells();
  lrEachSheet(room, (s, i) => {
    const card = s.getRange(LR.card.row, LR.card.col);
    if (i === room.liar) {
      card.setValue('🤫 당신이 라이어입니다!\n카테고리: ' + pick.cat + '\n들키지 말고 아는 척 하세요')
        .setBackground('#B71C1C').setFontColor('#FFFFFF');
    } else {
      card.setValue('카테고리: ' + pick.cat + '\n제시어: 「' + pick.word + '」\n라이어에게 들키지 마세요')
        .setBackground('#1B5E20').setFontColor('#FFFFFF');
    }
    s.getRange(LR.banner.row, LR.banner.col)
      .setValue('🎭 말로 돌아가며 제시어를 설명하세요! 라이어를 찾았다면 [투표] 칸에 번호 입력')
      .setFontColor('#6A1B9A');
    s.getRange(c.vote.row, c.vote.col).setValue('');
    s.getRange(c.state.row, c.state.col).setValue('🗳 투표 0 / ' + room.fileIds.length);
  });
  lrSyncRoster(room);
}

/** 전원 투표 완료 → 개표 + 정체 공개 */
function lrReveal(room) {
  const n = room.fileIds.length;
  const tally = new Array(n).fill(0);
  Object.keys(room.votes).forEach(k => { tally[room.votes[k] - 1]++; });
  const top = Math.max.apply(null, tally);
  const accusedList = tally.map((v, i) => (v === top ? i : -1)).filter(i => i >= 0);
  // 동률이면 라이어가 빠져나간다
  const citizensWin = accusedList.length === 1 && accusedList[0] === room.liar;

  const lines = tally.map((v, i) => (i + 1) + '. ' + lrName(room, i) + ' — ' + v + '표').join('  ·  ');
  const c = lrCells();
  lrEachSheet(room, s => {
    s.getRange(LR.card.row, LR.card.col)
      .setValue('🎭 라이어는 ' + (room.liar + 1) + '번 「' + lrName(room, room.liar) + '」!\n제시어: ' +
        room.cat + ' — 「' + room.word + '」\n' +
        (citizensWin ? '🎉 시민 승리! 라이어를 잡았습니다' : '😈 라이어 승리! 다들 속았습니다'))
      .setBackground(citizensWin ? '#1B5E20' : '#B71C1C').setFontColor('#FFFFFF');
    s.getRange(LR.banner.row, LR.banner.col)
      .setValue('개표: ' + lines + '  — 다시 하려면 [게임 시작] 체크')
      .setFontColor('#000000');
    s.getRange(c.state.row, c.state.col).setValue(citizensWin ? '시민 승' : '라이어 승');
  });
  room.phase = 'done';
}

// ---------- 3D 미로 탈출 ----------
// 같은 미로, 같은 출발점에서 각자 1인칭 시점으로 헤매다 먼저 출구에 닿으면 승리.
// 뷰는 깊이 3단 원근 렌더링: 셀 배경색만으로 복도·벽·갈림길을 그린다.

const MZ = {
  sheet: '미로',
  size: 13, // 홀수 격자 (1=벽, 0=통로)
  view: { row: 4, col: 3, w: 12, h: 9 }, // 뷰포트 C4:N12
  pcol: 17, // 우측 패널 열
  banner: { row: 2, col: 2, width: 14 },
};
const MZ_C = {
  dark: '#0A0A12',
  face: ['#8A97B8', '#67748F', '#49536B', '#333B4E'], // 깊이별 정면 벽
  side: ['#5C6786', '#454F6E', '#323A55', '#232940'], // 깊이별 측면 벽
  open: '#131623', // 옆으로 뚫린 갈림길
  ceil: ['#2A2F45', '#232738', '#1C1F2D', '#161824'],
  floor: ['#454C6B', '#383E59', '#2C3147', '#212536'],
  exit: '#FFD54F',
};
const MZ_DIRS = [[-1, 0], [0, 1], [1, 0], [0, -1]]; // 북 동 남 서
const MZ_DIRNAME = ['북 ⬆️', '동 ➡️', '남 ⬇️', '서 ⬅️'];
const MZ_X = [0, 2, 4, 5]; // 깊이별 가로 인셋
const MZ_Y = [0, 1, 2, 3]; // 깊이별 세로 인셋

/** 재귀 백트래커 미로 생성 → '1'/'0' 문자열 행 배열 */
function mzGen(size) {
  const g = [];
  for (let r = 0; r < size; r++) g.push(new Array(size).fill(1));
  const stack = [[1, 1]];
  g[1][1] = 0;
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const cand = [];
    for (const d of MZ_DIRS) {
      const nr = cur[0] + d[0] * 2;
      const nc = cur[1] + d[1] * 2;
      if (nr > 0 && nr < size - 1 && nc > 0 && nc < size - 1 && g[nr][nc] === 1) {
        cand.push([nr, nc, cur[0] + d[0], cur[1] + d[1]]);
      }
    }
    if (!cand.length) { stack.pop(); continue; }
    const pick = cand[Math.floor(Math.random() * cand.length)];
    g[pick[2]][pick[3]] = 0;
    g[pick[0]][pick[1]] = 0;
    stack.push([pick[0], pick[1]]);
  }
  return g.map(row => row.join(''));
}

function mzWall(maze, r, c) {
  if (r < 0 || c < 0 || r >= maze.length || c >= maze.length) return true;
  return maze[r].charAt(c) === '1';
}

/** 1인칭 뷰 색상 그리드 (h×w) */
function mzRenderView(maze, p, exit) {
  const w = MZ.view.w;
  const h = MZ.view.h;
  const g = [];
  for (let r = 0; r < h; r++) g.push(new Array(w).fill(MZ_C.dark));
  const fill = (r0, r1, c0, c1, color) => {
    for (let r = r0; r <= r1 && r < h; r++) {
      for (let c = c0; c <= c1 && c < w; c++) if (r >= 0 && c >= 0) g[r][c] = color;
    }
  };
  const dir = MZ_DIRS[p.dir];
  const left = MZ_DIRS[(p.dir + 3) % 4];
  const right = MZ_DIRS[(p.dir + 1) % 4];

  for (let d = 0; d < 3; d++) {
    const cr = p.r + dir[0] * d;
    const cc = p.c + dir[1] * d;
    // 천장·바닥 띠
    fill(MZ_Y[d], MZ_Y[d + 1] - 1, MZ_X[d], w - 1 - MZ_X[d], MZ_C.ceil[d]);
    fill(h - MZ_Y[d + 1] + 1 - 1, h - 1 - MZ_Y[d], MZ_X[d], w - 1 - MZ_X[d], MZ_C.floor[d]);
    // 좌우 벽/갈림길 띠
    const rowTop = MZ_Y[d];
    const rowBot = h - 1 - MZ_Y[d];
    const lOpen = !mzWall(maze, cr + left[0], cc + left[1]);
    const rOpen = !mzWall(maze, cr + right[0], cc + right[1]);
    fill(rowTop, rowBot, MZ_X[d], MZ_X[d + 1] - 1, lOpen ? MZ_C.open : MZ_C.side[d]);
    fill(rowTop, rowBot, w - MZ_X[d + 1], w - 1 - MZ_X[d], rOpen ? MZ_C.open : MZ_C.side[d]);
    // 전방 확인
    const fr = cr + dir[0];
    const fc = cc + dir[1];
    const centerT = MZ_Y[d + 1];
    const centerB = h - 1 - MZ_Y[d + 1];
    const centerL = MZ_X[d + 1];
    const centerR = w - 1 - MZ_X[d + 1];
    if (fr === exit[0] && fc === exit[1]) {
      fill(centerT, centerB, centerL, centerR, MZ_C.exit);
      return g;
    }
    if (mzWall(maze, fr, fc)) {
      fill(centerT, centerB, centerL, centerR, MZ_C.face[d]);
      return g;
    }
  }
  // 3칸 이상 뚫린 복도 — 저 끝은 어둠
  fill(MZ_Y[3], MZ.view.h - 1 - MZ_Y[3], MZ_X[3], MZ.view.w - 1 - MZ_X[3], MZ_C.dark);
  return g;
}

function mzCells() {
  const p = MZ.pcol;
  return {
    nickLabel: { row: 4, col: p }, nick: { row: 5, col: p },
    moveLabel: { row: 7, col: p }, move: { row: 8, col: p },
    meLabel: { row: 10, col: p }, me: { row: 11, col: p },
    oppLabel: { row: 13, col: p }, opp: { row: 14, col: p },
    stateLabel: { row: 16, col: p }, state: { row: 17, col: p },
  };
}

function buildMazeRoom(roomId, n) {
  const maze = mzGen(MZ.size);
  const exit = [MZ.size - 2, MZ.size - 2];
  const files = [];
  for (let i = 0; i < 2; i++) {
    const ss = SpreadsheetApp.create('SHEEET 미로 ' + roomId + ' — P' + (i + 1));
    const sheet = ss.getSheets()[0].setName(MZ.sheet);
    drawMazeBoard(sheet);
    DriveApp.getFileById(ss.getId())
      .setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
    files.push({ id: ss.getId(), url: ss.getUrl() });
  }
  const room = {
    fileIds: files.map(f => f.id),
    urls: files.map(f => f.url),
    maze: maze,
    exit: exit,
    p: [{ r: 1, c: 1, dir: 2, steps: 0 }, { r: 1, c: 1, dir: 2, steps: 0 }],
    names: {},
    over: false,
  };
  // 초기 시점 렌더
  files.forEach((f, i) => {
    const sheet = SpreadsheetApp.openById(f.id).getSheetByName(MZ.sheet);
    mzPaintView(sheet, mzRenderView(maze, room.p[i], exit));
    mzStatus(sheet, room, i);
  });
  return room;
}

function drawMazeBoard(sheet) {
  const c = mzCells();
  sheet.getRange(MZ.banner.row, MZ.banner.col, 1, MZ.banner.width).merge();
  sheet.setRowHeight(2, 46);
  sheet.getRange(MZ.banner.row, MZ.banner.col)
    .setValue('🌀 이동 칸에 w(전진)·a(좌회전)·d(우회전)·s(후진)를 입력! 노란 문(출구)을 먼저 찾으면 승리')
    .setFontWeight('bold').setFontSize(12)
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setWrap(true).setBackground('#E8EAF6');
  sheet.getRange(3, MZ.view.col)
    .setValue('👀 아래가 당신의 눈입니다 — 노란색이 보이면 출구가 코앞!')
    .setFontSize(10).setFontColor('#555555');

  // 뷰포트
  sheet.getRange(MZ.view.row, MZ.view.col, MZ.view.h, MZ.view.w).setBackground(MZ_C.dark);
  sheet.setColumnWidths(MZ.view.col, MZ.view.w, 34);
  sheet.setRowHeights(MZ.view.row, MZ.view.h, 34);
  // 뷰포트 테두리 프레임
  sheet.getRange(MZ.view.row - 1, MZ.view.col - 1, MZ.view.h + 2, MZ.view.w + 2)
    .setBorder(true, true, true, true, false, false, '#000000', SpreadsheetApp.BorderStyle.SOLID_THICK);

  const put = (pos, txt) => sheet.getRange(pos.row, pos.col)
    .setValue(txt).setFontWeight('bold');
  put(c.nickLabel, '1️⃣ 내 닉네임 ↓');
  sheet.getRange(c.nick.row, c.nick.col).setBackground(NICK_YELLOW)
    .setBorder(true, true, true, true, false, false, '#F9A825', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  put(c.moveLabel, '🕹 이동 입력 (w/a/s/d) ↓');
  sheet.getRange(c.move.row, c.move.col).setBackground('#E8F5E9').setFontSize(16)
    .setBorder(true, true, true, true, false, false, '#43A047', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  put(c.meLabel, '🧭 나');
  put(c.oppLabel, '🏃 상대');
  sheet.getRange(c.opp.row, c.opp.col).setValue('0걸음');
  put(c.stateLabel, '상태');
  sheet.getRange(c.state.row, c.state.col).setValue('탈출 경쟁 중!');
  sheet.setColumnWidth(MZ.pcol, 190);
}

function mzPaintView(sheet, colors) {
  sheet.getRange(MZ.view.row, MZ.view.col, MZ.view.h, MZ.view.w).setBackgrounds(colors);
}

function mzStatus(sheet, room, i) {
  const c = mzCells();
  const me = room.p[i];
  sheet.getRange(c.me.row, c.me.col)
    .setValue(MZ_DIRNAME[me.dir] + ' · ' + me.steps + '걸음');
}

function handleMazeEdit(e, room, roomId) {
  const srcIdx = room.fileIds.indexOf(e.source.getId());
  if (srcIdx < 0) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== MZ.sheet) return;
  const c = mzCells();
  const r = e.range.getRow();
  const col = e.range.getColumn();

  if (r === c.nick.row && col === c.nick.col) {
    room.names[srcIdx] = String(e.value || '').trim().slice(0, 12);
    return;
  }

  if (r === c.move.row && col === c.move.col) {
    const raw = String(e.value || '').trim().toLowerCase().charAt(0);
    e.range.setValue('');
    if (room.over) return;
    const cmd = { w: 'w', a: 'a', s: 's', d: 'd', 'ㅈ': 'w', 'ㅁ': 'a', 'ㄴ': 's', 'ㅇ': 'd' }[raw];
    if (!cmd) return;

    const me = room.p[srcIdx];
    let bumped = false;
    if (cmd === 'a') me.dir = (me.dir + 3) % 4;
    else if (cmd === 'd') me.dir = (me.dir + 1) % 4;
    else {
      const sign = cmd === 'w' ? 1 : -1;
      const nr = me.r + MZ_DIRS[me.dir][0] * sign;
      const nc = me.c + MZ_DIRS[me.dir][1] * sign;
      if (!mzWall(room.maze, nr, nc)) {
        me.r = nr;
        me.c = nc;
        me.steps++;
      } else {
        bumped = true;
        sheet.getRange(MZ.banner.row, MZ.banner.col).setValue('🧱 쿵! 벽입니다 — 다른 방향으로!')
          .setFontColor(FLASH_RED);
      }
    }
    // 벽 충돌이 아니면 배너를 기본 안내로 복구 (쿵! 메시지가 눌러붙지 않게)
    if (!bumped) {
      sheet.getRange(MZ.banner.row, MZ.banner.col)
        .setValue('🌀 이동 칸에 w(전진)·a(좌회전)·d(우회전)·s(후진)를 입력! 노란 문(출구)을 먼저 찾으면 승리')
        .setFontColor('#000000');
    }

    // 탈출 판정
    if (me.r === room.exit[0] && me.c === room.exit[1]) {
      room.over = true;
      const winner = lrName(room, srcIdx); // 이름 규칙 동일해서 재사용
      room.fileIds.forEach((id, i) => {
        const s = SpreadsheetApp.openById(id).getSheetByName(MZ.sheet);
        s.getRange(MZ.banner.row, MZ.banner.col)
          .setValue('🏁 ' + winner + ' 님이 ' + me.steps + '걸음 만에 탈출! ' +
            (i === srcIdx ? '🏆 승리!' : '패배… 다음 방에서 설욕전!'))
          .setFontColor(i === srcIdx ? '#188038' : FLASH_RED);
        s.getRange(c.state.row, c.state.col).setValue(i === srcIdx ? '🏆 탈출 성공' : '패배');
      });
      // 승자 뷰: 출구 통과 연출
      const g = [];
      for (let row = 0; row < MZ.view.h; row++) g.push(new Array(MZ.view.w).fill(MZ_C.exit));
      mzPaintView(sheet, g);
      return;
    }

    mzPaintView(sheet, mzRenderView(room.maze, me, room.exit));
    mzStatus(sheet, room, srcIdx);
    // 상대 파일에 진행도 표시
    const other = 1 - srcIdx;
    SpreadsheetApp.openById(room.fileIds[other]).getSheetByName(MZ.sheet)
      .getRange(c.opp.row, c.opp.col).setValue(me.steps + '걸음');
    return;
  }
}
