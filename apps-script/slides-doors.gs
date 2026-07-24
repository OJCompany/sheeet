/**
 * SLIIIDE — 운명의 문 (Doors of Fate)
 *
 * 구글 슬라이드가 게임판이 되는 복불복 서바이벌.
 * 참가자는 링크만 열고(로그인 불필요, "익명의 동물") 자기 아바타를
 * 문 앞으로 드래그하면 끝. 라운드마다 랜덤으로 꽝 문이 터지고,
 * 밟은 사람은 탈락 존으로 이동 — 탈락 역순이 곧 순위다.
 *
 * 아키텍처: 익명 편집자는 스크립트를 실행할 수 없으므로
 *   - 참가자 입력 = 도형(아바타) 드래그뿐
 *   - 호스트 사이드바가 2초마다 tick을 호출해 게임 루프를 돌린다
 *     (카운트다운 갱신 → 시간 종료 시 판정 → 연출 → 다음 라운드)
 *
 * 설치 (호스트 1회):
 *   1. 새 프레젠테이션 → 확장 프로그램 → Apps Script
 *   2. Code.gs에 이 파일 내용 붙여넣기
 *   3. 파일 추가(+) → HTML → 이름을 정확히 slides-doors-sidebar 로 생성,
 *      slides-doors-sidebar.html 내용 붙여넣기 → 저장
 *   4. (선택) 구글 드라이브에 "운명의문_아바타" 폴더를 만들고 repo의 img/ 안
 *      12지신 PNG 12장(01_쥐.png ~ 12_돼지.png)을 업로드 — 이미지 게임말 사용.
 *      폴더가 없으면 이모지 게임말로 자동 대체된다.
 *   5. 프레젠테이션 새로고침 → 메뉴 [🎮 운명의 문] → [보드 생성] (첫 실행 시 권한 승인)
 *   6. 공유: "링크가 있는 모든 사용자 — 편집자" 로 변경 후 링크 배포
 *   7. 참가자가 대기석 아바타를 게임장으로 끌어올리면 [컨트롤 열기] → [게임 시작]
 *
 * 룰:
 *   - 라운드마다 문 2~5개 등장, 25초 안에 아바타를 문 아래로 이동
 *   - 미선택 시 랜덤 문에 자동 배정 (문 안 고르고 버티기 없음)
 *   - 꽝 문(1~2개)이 랜덤으로 폭발 → 그 문 앞 전원 탈락
 *   - 전원이 꽝을 밟으면 기적의 무효 라운드 (탈락 없음)
 *   - 마지막 생존자가 우승. 같은 라운드 탈락자는 공동 순위.
 */

const DOF_KEY = 'DOF_STATE';
const DOF_TAG = 'DOF:';           // 도형 식별용 대체 텍스트(제목) 접두사
const DOF_ROUND_SEC = 25;         // 라운드 제한 시간
const DOF_REVEAL_MS = 5000;       // 폭발 연출 후 다음 라운드까지 대기
const DOF_MAX_ROUNDS = 15;        // 안전장치: 초과 시 생존자 공동 우승
const DOF_MAX_LOG = 9;

// 게임말: 12지신. 드라이브 폴더의 PNG(01_쥐 ~ 12_돼지)를 이름순으로 매칭한다.
const DOF_AVATARS = ['쥐', '소', '호랑이', '토끼', '용', '뱀', '말', '양', '원숭이', '닭', '개', '돼지'];
const DOF_AVATAR_EMOJI = ['🐭', '🐮', '🐯', '🐰', '🐲', '🐍', '🐴', '🐑', '🐵', '🐔', '🐶', '🐷']; // 이미지 없을 때 대체
const DOF_IMG_FOLDER = '운명의문_아바타'; // 드라이브에서 게임말 이미지를 찾을 폴더 이름

// 레이아웃 (기본 와이드 페이지 720×405pt 기준, 실제 크기에 맞춰 스케일)
const DOF_L = {
  bannerX: 10, bannerY: 8, bannerW: 545, bannerH: 38,
  clockX: 565, clockY: 8, clockW: 145, clockH: 38,
  doorTop: 60, doorH: 105, doorW: 88,
  doorAreaX: 10, doorAreaW: 545,   // 문 + 선택 존의 가로 범위
  floorBottom: 308,                 // 선택 존 세로 하한 (이 아래는 대기석/탈락 존)
  stripX: 10, stripY: 315, stripW: 545, stripH: 82,   // 대기석 → 탈락 존
  panelX: 565, panelY: 55, panelW: 145, panelH: 342,  // 우측: 순위표 + 로그
  avatar: 34, deadAvatar: 26,
};

const DOF_C = {
  bg: '#101426', strip: '#0D101F', floor: '#161C36',
  door: '#C9974C', doorText: '#3A2A10',
  boom: '#E53935', safe: '#43A047',
  banner: '#FFFFFF', panel: '#1B2240', panelText: '#D6DAF0',
};

// ---------- 메뉴 / 사이드바 ----------

function onOpen() {
  SlidesApp.getUi()
    .createMenu('🎮 운명의 문')
    .addItem('보드 생성', 'dofSetup')
    .addItem('컨트롤 열기', 'dofOpenSidebar')
    .addToUi();
}

function dofOpenSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('slides-doors-sidebar')
    .setTitle('🎮 운명의 문 — 호스트 컨트롤');
  SlidesApp.getUi().showSidebar(html);
}

// ---------- 사이드바 API (호스트 권한으로 실행) ----------

function dofSetup() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    dofBuildBoard_();
    dofSaveState_({ phase: 'LOBBY', round: 0, players: {}, log: [], deadCount: 0 });
    return dofStatus_('보드 생성 완료. 공유 설정(편집자) 후 링크를 배포하세요.');
  } finally {
    lock.releaseLock();
  }
}

function dofStart() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const st = dofLoadState_();
    if (!st || st.phase !== 'LOBBY') return dofStatus_('로비 상태가 아닙니다. 먼저 보드를 생성하세요.');

    const slide = dofSlide_();
    const joined = [];
    dofFindAll_(slide, 'avatar').forEach(el => {
      const cy = el.getTop() + el.getHeight() / 2;
      if (cy < DOF_L.stripY * dofScaleY_()) {
        joined.push(el);
      } else {
        el.remove(); // 대기석에 남은 아바타는 정리
      }
    });
    if (joined.length < 2) return dofStatus_('참가자가 2명 이상 필요합니다. (게임장으로 올라온 아바타: ' + joined.length + ')');

    st.players = {};
    joined.forEach(el => {
      st.players[el.getObjectId()] = {
        label: dofLabel_(el), alive: true, rank: 0,
      };
    });
    st.log = [];
    st.deadCount = 0;
    st.round = 0;
    dofLog_(st, '참가 확정: ' + joined.length + '명. 게임 시작!');
    dofStartRound_(st, slide);
    dofSaveState_(st);
    return dofStatus_('게임 시작 — ' + joined.length + '명 참전.');
  } finally {
    lock.releaseLock();
  }
}

function dofTick() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) return dofStatus_(''); // 이전 tick 진행 중이면 건너뜀
  try {
    const st = dofLoadState_();
    if (!st) return dofStatus_('보드가 없습니다. [보드 생성]을 누르세요.');
    const now = Date.now();
    const slide = dofSlide_();

    if (st.phase === 'ROUND') {
      const remain = Math.ceil((st.deadline - now) / 1000);
      if (remain <= 0) {
        dofJudge_(st, slide);
      } else {
        dofSetText_(slide, 'clock', '⏳ ' + remain + '초');
      }
      dofSaveState_(st);
    } else if (st.phase === 'REVEAL' && now >= st.revealUntil) {
      const alive = dofAlive_(st);
      if (alive.length <= 1 || st.round >= DOF_MAX_ROUNDS) {
        dofFinish_(st, slide);
      } else {
        dofStartRound_(st, slide);
      }
      dofSaveState_(st);
    }
    return dofStatus_('');
  } finally {
    lock.releaseLock();
  }
}

function dofJudgeNow() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const st = dofLoadState_();
    if (!st || st.phase !== 'ROUND') return dofStatus_('진행 중인 라운드가 없습니다.');
    dofJudge_(st, dofSlide_());
    dofSaveState_(st);
    return dofStatus_('강제 판정 완료.');
  } finally {
    lock.releaseLock();
  }
}

function dofReset() {
  return dofSetup();
}

// ---------- 게임 루프 내부 ----------

function dofStartRound_(st, slide) {
  st.round += 1;
  const alive = dofAlive_(st);
  const doors = alive.length >= 8 ? 5 : alive.length >= 5 ? 4 : alive.length >= 3 ? 3 : 2;
  const bombs = doors >= 5 ? 2 : 1;
  st.doors = doors;
  st.bombs = bombs;
  st.phase = 'ROUND';
  st.deadline = Date.now() + DOF_ROUND_SEC * 1000;

  dofFindAll_(slide, 'door').forEach(el => el.remove());
  const sx = dofScaleX_(), sy = dofScaleY_();
  const gap = (DOF_L.doorAreaW - doors * DOF_L.doorW) / (doors + 1);
  for (let i = 0; i < doors; i++) {
    const x = (DOF_L.doorAreaX + gap + i * (DOF_L.doorW + gap)) * sx;
    const door = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE,
      x, DOF_L.doorTop * sy, DOF_L.doorW * sx, DOF_L.doorH * sy);
    door.setTitle(DOF_TAG + 'door:' + i);
    door.getFill().setSolidFill(DOF_C.door);
    door.getBorder().setTransparent();
    dofStyleText_(door, '🚪\n' + (i + 1), 22, DOF_C.doorText, true);
    door.sendToBack(); // 아바타가 문 위에 올라와도 가려지지 않게
  }
  const floorEl = dofFindOne_(slide, 'floor');
  if (floorEl) floorEl.sendToBack();
  dofSetText_(slide, 'banner',
    '🎯 라운드 ' + st.round + ' — 문 ' + doors + '개 중 꽝 ' + bombs + '개! 아바타를 문 아래로!');
  dofSetText_(slide, 'clock', '⏳ ' + DOF_ROUND_SEC + '초');
}

function dofJudge_(st, slide) {
  const sx = dofScaleX_(), sy = dofScaleY_();
  const alive = dofAlive_(st);
  const gap = (DOF_L.doorAreaW - st.doors * DOF_L.doorW) / (st.doors + 1);

  // 1) 문 배정: 아바타 중심 x가 속한 문 기둥, 벗어나면 랜덤 배정
  const choice = {}; // objectId → doorIndex
  alive.forEach(id => {
    const el = slide.getPageElementById(id);
    if (!el) { choice[id] = -1; return; } // 아바타 실종 → 즉시 탈락 처리
    const cx = (el.getLeft() + el.getWidth() / 2) / sx;
    const cy = (el.getTop() + el.getHeight() / 2) / sy;
    let door = -1;
    if (cy >= DOF_L.doorTop && cy <= DOF_L.floorBottom) {
      for (let i = 0; i < st.doors; i++) {
        const x0 = DOF_L.doorAreaX + gap + i * (DOF_L.doorW + gap) - gap / 2;
        if (cx >= x0 && cx < x0 + DOF_L.doorW + gap) { door = i; break; }
      }
    }
    if (door < 0) {
      door = Math.floor(Math.random() * st.doors);
      dofLog_(st, dofPlayerLabel_(st, id) + ' 미선택 → 문' + (door + 1) + ' 강제 배정');
    }
    choice[id] = door;
  });

  // 2) 꽝 문 추첨
  const idx = [];
  for (let i = 0; i < st.doors; i++) idx.push(i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  const bombSet = {};
  idx.slice(0, st.bombs).forEach(i => { bombSet[i] = true; });

  // 3) 연출: 꽝 = 빨강 폭발, 통과 = 초록
  dofFindAll_(slide, 'door').forEach(el => {
    const i = Number(el.getTitle().split(':')[2]);
    const shape = el.asShape();
    if (bombSet[i]) {
      shape.getFill().setSolidFill(DOF_C.boom);
      dofStyleText_(shape, '💥\n꽝!', 22, '#FFFFFF', true);
    } else {
      shape.getFill().setSolidFill(DOF_C.safe);
      dofStyleText_(shape, '🌿\n통과', 22, '#FFFFFF', true);
    }
  });

  // 4) 탈락 판정 (아바타 실종자 포함)
  const victims = alive.filter(id => choice[id] === -1 || bombSet[choice[id]]);

  if (victims.length === alive.length) {
    dofLog_(st, 'R' + st.round + ': 전원 꽝!! 기적의 무효 라운드 🙃');
  } else if (victims.length > 0) {
    const rank = alive.length - victims.length + 1; // 동반 탈락은 공동 순위
    victims.forEach(id => {
      st.players[id].alive = false;
      st.players[id].rank = rank;
      const el = slide.getPageElementById(id);
      if (el) {
        el.setWidth(DOF_L.deadAvatar * sx);
        el.setHeight(DOF_L.deadAvatar * sy);
        el.setLeft((DOF_L.stripX + 8 + st.deadCount * (DOF_L.deadAvatar + 6)) * sx);
        el.setTop((DOF_L.stripY + 40) * sy);
      }
      st.deadCount += 1;
    });
    const names = victims.map(id => dofPlayerLabel_(st, id)).join(', ');
    const tag = victims.length > 1 ? '공동 ' + rank + '위' : rank + '위';
    dofLog_(st, 'R' + st.round + ': ' + names + ' 탈락 (' + tag + ')');
  } else {
    dofLog_(st, 'R' + st.round + ': 전원 생존! 👏');
  }

  dofSetText_(slide, 'clock', '💥 판정!');
  dofUpdateStandings_(st, slide);
  st.phase = 'REVEAL';
  st.revealUntil = Date.now() + DOF_REVEAL_MS;
}

function dofFinish_(st, slide) {
  const alive = dofAlive_(st);
  alive.forEach(id => { st.players[id].rank = 1; }); // 생존자 = 우승 (복수면 공동)
  const names = alive.map(id => dofPlayerLabel_(st, id)).join(', ');
  dofSetText_(slide, 'banner',
    alive.length ? '👑 우승: ' + names + ' — 축하합니다!' : '🏁 게임 종료!');
  dofSetText_(slide, 'clock', '🏁 종료');
  dofLog_(st, alive.length ? '우승 ' + names : '게임 종료');
  dofUpdateStandings_(st, slide);
  st.phase = 'DONE';
}

// ---------- 보드 렌더링 ----------

function dofBuildBoard_() {
  const pres = SlidesApp.getActivePresentation();
  const slide = pres.getSlides()[0];
  slide.getPageElements().forEach(el => el.remove());
  slide.getBackground().setSolidFill(DOF_C.bg);
  const sx = dofScaleX_(), sy = dofScaleY_();
  const L = DOF_L;

  // 선택 존 바닥 (문 아래 플레이 영역 가이드)
  const floor = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE,
    L.doorAreaX * sx, (L.doorTop - 5) * sy, L.doorAreaW * sx, (L.floorBottom - L.doorTop + 10) * sy);
  floor.setTitle(DOF_TAG + 'floor');
  floor.getFill().setSolidFill(DOF_C.floor);
  floor.getBorder().setTransparent();

  // 배너 + 카운트다운
  const banner = slide.insertTextBox('🎮 운명의 문 — 대기석 아바타를 하나 골라 게임장(가운데)으로 드래그하세요!',
    L.bannerX * sx, L.bannerY * sy, L.bannerW * sx, L.bannerH * sy);
  banner.setTitle(DOF_TAG + 'banner');
  dofStyleText_(banner, null, 14, DOF_C.banner, true);

  const clock = slide.insertTextBox('⏳ --',
    L.clockX * sx, L.clockY * sy, L.clockW * sx, L.clockH * sy);
  clock.setTitle(DOF_TAG + 'clock');
  dofStyleText_(clock, null, 16, '#FFD966', true);

  // 우측 패널: 순위표 + 로그
  const panel = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE,
    L.panelX * sx, L.panelY * sy, L.panelW * sx, L.panelH * sy);
  panel.getFill().setSolidFill(DOF_C.panel);
  panel.getBorder().setTransparent();
  const stand = slide.insertTextBox('🏆 순위표\n(게임 시작 전)',
    (L.panelX + 6) * sx, (L.panelY + 6) * sy, (L.panelW - 12) * sx, (L.panelH - 12) * sy);
  stand.setTitle(DOF_TAG + 'standings');
  dofStyleText_(stand, null, 9, DOF_C.panelText, false);

  // 대기석 (게임 시작 후 탈락 존으로 전환)
  const strip = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE,
    L.stripX * sx, L.stripY * sy, L.stripW * sx, L.stripH * sy);
  strip.setTitle(DOF_TAG + 'strip');
  strip.getFill().setSolidFill(DOF_C.strip);
  strip.getBorder().setTransparent();
  const stripLabel = slide.insertTextBox('🪑 대기석 → 참가하려면 아바타를 위로! (시작 후엔 탈락 존)',
    (L.stripX + 6) * sx, (L.stripY + 2) * sy, (L.stripW - 12) * sx, 16 * sy);
  stripLabel.setTitle(DOF_TAG + 'stripLabel');
  dofStyleText_(stripLabel, null, 8, '#8890B5', false);

  // 게임말 12개 (드라이브 이미지, 없으면 이모지 도형으로 대체)
  const blobs = dofAvatarBlobs_();
  DOF_AVATARS.forEach((name, i) => {
    const col = i % 6, row = Math.floor(i / 6);
    const x = (L.stripX + 14 + col * (L.avatar + 54)) * sx;
    const y = (L.stripY + 20 + row * (L.avatar - 4)) * sy;
    let av;
    if (blobs) {
      av = slide.insertImage(blobs[i], x, y, L.avatar * sx, L.avatar * sy);
    } else {
      av = slide.insertShape(SlidesApp.ShapeType.ELLIPSE, x, y, L.avatar * sx, L.avatar * sy);
      av.getFill().setSolidFill('#FFFFFF');
      av.getBorder().setTransparent();
      dofStyleText_(av, DOF_AVATAR_EMOJI[i], 16, '#000000', false);
    }
    av.setTitle(DOF_TAG + 'avatar:' + name);
  });
}

/**
 * 드라이브의 DOF_IMG_FOLDER 폴더에서 게임말 이미지를 이름순으로 가져온다.
 * 폴더가 없거나 12장 미만이면 null (이모지 게임말로 대체).
 */
function dofAvatarBlobs_() {
  try {
    const folders = DriveApp.getFoldersByName(DOF_IMG_FOLDER);
    if (!folders.hasNext()) return null;
    const files = folders.next().getFiles();
    const list = [];
    while (files.hasNext()) {
      const f = files.next();
      if (f.getMimeType().indexOf('image/') === 0) list.push(f);
    }
    if (list.length < DOF_AVATARS.length) return null;
    list.sort((a, b) => (a.getName() < b.getName() ? -1 : a.getName() > b.getName() ? 1 : 0));
    return list.slice(0, DOF_AVATARS.length).map(f => f.getBlob());
  } catch (e) {
    return null;
  }
}

function dofUpdateStandings_(st, slide) {
  const rows = Object.keys(st.players).map(id => st.players[id]);
  rows.sort((a, b) => (a.rank || 999) - (b.rank || 999));
  const lines = ['🏆 순위표'];
  rows.forEach(p => {
    lines.push((p.rank ? p.rank + '위' : '생존') + '  ' + p.label + (p.alive ? ' ✅' : ''));
  });
  lines.push('');
  lines.push('📜 로그');
  st.log.forEach(l => lines.push('· ' + l));
  dofSetText_(slide, 'standings', lines.join('\n'));
}

// ---------- 헬퍼 ----------

function dofSlide_() {
  return SlidesApp.getActivePresentation().getSlides()[0];
}

function dofScaleX_() {
  return SlidesApp.getActivePresentation().getPageWidth() / 720;
}

function dofScaleY_() {
  return SlidesApp.getActivePresentation().getPageHeight() / 405;
}

function dofFindAll_(slide, tag) {
  const prefix = DOF_TAG + tag;
  return slide.getPageElements().filter(el => {
    const t = el.getTitle();
    return t && t.indexOf(prefix) === 0;
  });
}

function dofFindOne_(slide, tag) {
  const list = dofFindAll_(slide, tag);
  return list.length ? list[0] : null;
}

function dofSetText_(slide, tag, text) {
  const el = dofFindOne_(slide, tag);
  if (el) el.asShape().getText().setText(text);
}

function dofStyleText_(shape, text, size, color, bold) {
  const tr = shape.getText();
  if (text !== null) tr.setText(text);
  tr.getTextStyle().setFontSize(size).setForegroundColor(color).setBold(!!bold);
  tr.getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
  shape.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
}

function dofLabel_(el) {
  // 게임말 이름은 제목 태그(DOF:avatar:쥐)에 담는다 — 이미지는 텍스트가 없으므로
  const prefix = DOF_TAG + 'avatar:';
  const t = el.getTitle() || '';
  if (t.indexOf(prefix) === 0 && t.length > prefix.length) {
    return t.substring(prefix.length);
  }
  try {
    const s = el.asShape().getText().asString().trim();
    return s || '❓';
  } catch (e) {
    return '❓';
  }
}

function dofPlayerLabel_(st, id) {
  return (st.players[id] && st.players[id].label) || '❓';
}

function dofAlive_(st) {
  return Object.keys(st.players).filter(id => st.players[id].alive);
}

function dofLog_(st, msg) {
  st.log.push(msg);
  if (st.log.length > DOF_MAX_LOG) st.log = st.log.slice(-DOF_MAX_LOG);
}

function dofLoadState_() {
  const raw = PropertiesService.getDocumentProperties().getProperty(DOF_KEY);
  return raw ? JSON.parse(raw) : null;
}

function dofSaveState_(st) {
  PropertiesService.getDocumentProperties().setProperty(DOF_KEY, JSON.stringify(st));
}

function dofStatus_(msg) {
  const st = dofLoadState_();
  if (!st) return { ok: false, msg: msg || '상태 없음 — [보드 생성]부터.' };
  const alive = dofAlive_(st).length;
  const total = Object.keys(st.players).length;
  return {
    ok: true,
    phase: st.phase,
    round: st.round,
    alive: alive,
    total: total,
    msg: msg || '',
    log: st.log || [],
  };
}
