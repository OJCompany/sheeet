/**
 * SLIIIDE — 퀴즈쇼 (Quiz Show)
 *
 * 구글 슬라이드가 퀴즈판이 되는 실시간 퀴즈 파티게임.
 * 참가자는 링크만 열고(로그인 불필요) 자기 아바타를 드래그해서
 *   1) 시작 시 카테고리 카드에 올려 투표하고 (다수결)
 *   2) 문제마다 정답이라 생각하는 보기 카드에 올린다.
 * 정답자는 +10점. 탈락 없이 누적 점수로 순위를 가린다.
 *
 * 아키텍처: 운명의 문과 동일 — 익명 편집자는 스크립트를 실행할 수 없으므로
 *   - 참가자 입력 = 도형(아바타) 드래그뿐
 *   - 호스트 사이드바가 2초마다 tick을 호출해 게임 루프를 돌린다
 *     (카운트다운 → 시간 종료 시 판정 → 연출 → 다음 문제)
 *
 * 설치 (호스트 1회):
 *   1. 새 프레젠테이션 → 확장 프로그램 → Apps Script
 *   2. Code.gs에 이 파일 내용 붙여넣기
 *   3. 파일 추가(+) → HTML → 이름을 정확히 slides-quiz-sidebar 로 생성,
 *      slides-quiz-sidebar.html 내용 붙여넣기 → 저장
 *   4. (선택) 드라이브 "운명의문_아바타" 폴더에 12지신 PNG 12장 업로드
 *   5. 프레젠테이션 새로고침 → 메뉴 [🧠 퀴즈쇼] → [보드 생성]
 *   6. 공유: "링크가 있는 모든 사용자 — 편집자" 로 변경 후 링크 배포
 *   7. 참가자가 대기석 아바타를 게임장으로 끌어올리면 [컨트롤 열기] → [게임 시작]
 *
 * 룰:
 *   - 게임 시작 → 카테고리 투표 20초 (아바타를 카테고리 카드에!)
 *   - 다수결로 카테고리 확정 (동표는 추첨)
 *   - 문제 7개, 각 25초. 아바타를 보기 카드 위로 → 정답 +10점
 *   - 시간 안에 카드 근처에 없으면 무응답(0점)
 *   - 답 확정(락인): 같은 카드 위에 ~4초 머물면 답으로 확정된다. 확정 후 남이
 *     내 말을 옮겨도 판정은 확정된 답 기준 → 훼방 방지. (슬라이드는 도형별
 *     편집 권한이 없어 물리적으로 못 움직이게 하는 건 불가능)
 *   - 최종 점수로 순위. 동점은 공동 순위.
 */

const QZ_KEY = 'QZ_STATE';
const QZ_TAG = 'QZ:';             // 도형 식별용 대체 텍스트(제목) 접두사
const QZ_VOTE_SEC = 20;           // 카테고리 투표 시간
const QZ_ROUND_SEC = 25;          // 문제당 제한 시간
const QZ_REVEAL_MS = 5000;        // 정답 공개 후 다음 문제까지 대기
const QZ_NUM_QUESTIONS = 7;       // 한 게임 문제 수 (은행보다 크면 은행 크기)
const QZ_SCORE = 10;              // 정답 점수
const QZ_MAX_LOG = 9;
// 답 확정(락인)에 필요한 연속 tick 수. 슬라이드는 도형별 권한이 없어 남이 내 말을
// 옮기는 걸 막을 수 없으므로, "카드 위에 ~4초(2 tick) 머문 위치"를 답으로 확정한다.
// 확정 후 누가 말을 치워도 판정은 확정된 답을 쓴다 (훼방 방지).
const QZ_LOCK_TICKS = 2;

// 게임말: 12지신. 운명의 문과 같은 드라이브 폴더를 쓴다.
const QZ_AVATARS = ['쥐', '소', '호랑이', '토끼', '용', '뱀', '말', '양', '원숭이', '닭', '개', '돼지'];
const QZ_AVATAR_EMOJI = ['🐭', '🐮', '🐯', '🐰', '🐲', '🐍', '🐴', '🐑', '🐵', '🐔', '🐶', '🐷'];
const QZ_IMG_FOLDER = '운명의문_아바타';

// 카테고리와 문제 은행. a = 정답 보기 인덱스(0~3). 보기는 렌더링 때 섞는다.
const QZ_BANK = {
  '넌센스': { emoji: '🤪', qs: [
    { q: '세상에서 가장 뜨거운 과일은?', c: ['천도복숭아', '용과', '파인애플', '불수감'], a: 0 },
    { q: '왕이 넘어지면?', c: ['퀸카', '킹콩', '잭팟', '콩킹'], a: 1 },
    { q: '소가 웃으면 나는 소리는?', c: ['음매', '소호호', '우하하', '핫소스'], a: 2 },
    { q: '바나나가 웃으면?', c: ['바나나우유', '스마일바나나', '노랑웃음', '바나나킥'], a: 3 },
    { q: '오리가 얼면?', c: ['언덕', '얼음오리', '오리빙수', '냉동오리'], a: 0 },
    { q: '눈이 녹으면 뭐가 될까? (넌센스)', c: ['물', '눈물', '봄', '슬러시'], a: 1 },
    { q: '세상에서 가장 억울한 도형은?', c: ['세모', '네모', '원통', '마름모'], a: 2 },
    { q: '싸움을 가장 잘하는 나라는?', c: ['미국', '스페인', '독일', '칠레'], a: 3 },
  ]},
  '상식': { emoji: '🧠', qs: [
    { q: '태양계에서 가장 큰 행성은?', c: ['목성', '토성', '지구', '화성'], a: 0 },
    { q: '물의 화학식은?', c: ['CO2', 'H2O', 'O2', 'NaCl'], a: 1 },
    { q: '훈민정음을 창제한 왕은?', c: ['태종', '정조', '세종대왕', '광개토대왕'], a: 2 },
    { q: '세계에서 면적이 가장 넓은 나라는?', c: ['중국', '미국', '캐나다', '러시아'], a: 3 },
    { q: '에펠탑이 있는 도시는?', c: ['파리', '런던', '로마', '베를린'], a: 0 },
    { q: '성인의 뼈 개수는 약 몇 개?', c: ['106개', '206개', '306개', '406개'], a: 1 },
    { q: '무지개의 색은 모두 몇 가지?', c: ['5가지', '6가지', '7가지', '8가지'], a: 2 },
    { q: '대한민국 국화(나라꽃)는?', c: ['장미', '벚꽃', '개나리', '무궁화'], a: 3 },
  ]},
  '속담·사자성어': { emoji: '📜', qs: [
    { q: '"낮말은 새가 듣고 밤말은 __가 듣는다"', c: ['쥐', '개', '고양이', '뱀'], a: 0 },
    { q: '"등잔 밑이 ___"', c: ['밝다', '어둡다', '뜨겁다', '좁다'], a: 1 },
    { q: '서로 처지를 바꿔 생각한다는 사자성어는?', c: ['이심전심', '동병상련', '역지사지', '유유상종'], a: 2 },
    { q: '"낫 놓고 __자도 모른다"', c: ['니은', '디귿', '리을', '기역'], a: 3 },
    { q: '일석이조와 같은 뜻의 속담은?', c: ['꿩 먹고 알 먹기', '누워서 떡 먹기', '티끌 모아 태산', '우물 안 개구리'], a: 0 },
    { q: '"가는 말이 고와야 __ 말이 곱다"', c: ['하는', '오는', '듣는', '주는'], a: 1 },
    { q: '매우 위태로운 상황을 뜻하는 사자성어는?', c: ['금상첨화', '어부지리', '풍전등화', '청출어람'], a: 2 },
    { q: '"호랑이도 제 말 하면 ___"', c: ['운다', '숨는다', '웃는다', '온다'], a: 3 },
  ]},
  '음식': { emoji: '🍜', qs: [
    { q: '김치의 주재료는?', c: ['배추', '무', '오이', '파'], a: 0 },
    { q: '비빔밥에 들어가는 대표 장은?', c: ['된장', '고추장', '간장', '쌈장'], a: 1 },
    { q: '피자의 고향은 어느 나라?', c: ['미국', '프랑스', '이탈리아', '스페인'], a: 2 },
    { q: '초밥(스시)의 나라는?', c: ['중국', '태국', '베트남', '일본'], a: 3 },
    { q: '삼계탕에 들어가는 고기는?', c: ['닭', '소', '돼지', '오리'], a: 0 },
    { q: '크루아상 하면 떠오르는 나라는?', c: ['독일', '프랑스', '영국', '터키'], a: 1 },
    { q: '팥빙수의 주 토핑은?', c: ['콩', '깨', '팥', '밤'], a: 2 },
    { q: '떡볶이의 주재료는?', c: ['어묵', '라면', '만두', '떡'], a: 3 },
  ]},
};
const QZ_CATS = Object.keys(QZ_BANK);

// 레이아웃 (기본 와이드 페이지 720×405pt 기준, 실제 크기에 맞춰 스케일)
const QZ_L = {
  bannerX: 10, bannerY: 8, bannerW: 545, bannerH: 38,
  clockX: 565, clockY: 8, clockW: 145, clockH: 38,
  arenaX: 10, arenaY: 52, arenaW: 545, arenaBottom: 308,
  qX: 22, qY: 58, qW: 521, qH: 46,
  cardW: 250, cardH: 72, cardX0: 25, cardX1: 292, cardY0: 112, cardY1: 212,
  stripX: 10, stripY: 315, stripW: 545, stripH: 82,
  panelX: 565, panelY: 55, panelW: 145, panelH: 342,
  avatar: 34,
};

// 아기자기 파스텔 팔레트: 크림 배경 + 하늘색 게임장 + 핑크/바나나 카드
const QZ_C = {
  bg: '#FFF8EF', strip: '#FFEFD9', floor: '#EAF7FF',
  floorBorder: '#BFE3F7', card: '#FFFFFF', cardBorder: '#FFC7D9', cardText: '#5C4033',
  correct: '#9EE6A8', correctText: '#1E5B34', wrong: '#F1E7E0', vote: '#FFF6CC',
  banner: '#5C4033', muted: '#C09A6B',
  panel: '#FFF0F6', panelBorder: '#F6C9DD', panelText: '#7A4A5E',
  accent: '#FF9EB5', gold: '#FF8A3D',
};

// 둥글둥글한 무료 한글 폰트 (Slides 기본 제공). 없으면 자동 폴백된다.
const QZ_FONT = 'Jua';

// ---------- 메뉴 / 사이드바 ----------

function onOpen() {
  SlidesApp.getUi()
    .createMenu('🧠 퀴즈쇼')
    .addItem('보드 생성', 'qzSetup')
    .addItem('컨트롤 열기', 'qzOpenSidebar')
    .addToUi();
  // 판이 없으면 자동 생성 — 로그인한 사람이 열기만 해도 게임판이 깔린다.
  // 상태 키가 있으면(=이미 게임판 존재) 건너뛰므로 진행 중 게임을 초기화하지 않는다.
  try {
    if (!PropertiesService.getDocumentProperties().getProperty(QZ_KEY)) qzSetup();
  } catch (e) { /* 단순 트리거 권한 제약 시 메뉴 [보드 생성]으로 폴백 */ }
}

function qzOpenSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('slides-quiz-sidebar')
    .setTitle('🧠 퀴즈쇼 — 호스트 컨트롤');
  SlidesApp.getUi().showSidebar(html);
}

// ---------- 사이드바 API ----------

function qzSetup() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    qzBuildBoard_();
    qzSaveState_({ phase: 'LOBBY', qNo: 0, players: {}, log: [] });
    return qzStatus_('보드 생성 완료. 공유 설정(편집자) 후 링크를 배포하세요.');
  } finally {
    lock.releaseLock();
  }
}

function qzStart() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const st = qzLoadState_();
    if (!st || st.phase !== 'LOBBY') return qzStatus_('로비 상태가 아닙니다. 먼저 보드를 생성하세요.');

    const slide = qzSlide_();
    const sy = qzScaleY_();
    const joined = [];
    const bench = [];
    qzFindAll_(slide, 'avatar').forEach(el => {
      const cy = el.getTop() + el.getHeight() / 2;
      if (cy < QZ_L.stripY * sy) joined.push(el);
      else bench.push(el);
    });
    if (joined.length < 2) return qzStatus_('참가자가 2명 이상 필요합니다. (게임장으로 올라온 아바타: ' + joined.length + ')');
    bench.forEach(el => el.remove()); // 시작이 확정된 뒤에만 대기석 정리 (실패 시 아바타 보존)

    st.players = {};
    joined.forEach(el => {
      st.players[el.getObjectId()] = { label: qzLabel_(el), score: 0, rank: 0 };
    });
    st.log = [];
    st.qNo = 0;
    qzLog_(st, '참가 확정: ' + joined.length + '명. 카테고리 투표!');
    qzStartVote_(st, slide);
    qzSaveState_(st);
    return qzStatus_('카테고리 투표 시작 — ' + joined.length + '명 참전.');
  } finally {
    lock.releaseLock();
  }
}

function qzTick() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) return qzStatus_(''); // 이전 tick 진행 중이면 건너뜀
  try {
    const st = qzLoadState_();
    if (!st) return qzStatus_('보드가 없습니다. [보드 생성]을 누르세요.');
    const now = Date.now();
    const slide = qzSlide_();

    if (st.phase === 'VOTE' || st.phase === 'QUESTION') {
      const remain = Math.ceil((st.deadline - now) / 1000);
      if (remain <= 0) {
        if (st.phase === 'VOTE') qzJudgeVote_(st, slide);
        else qzJudgeQuestion_(st, slide);
      } else {
        qzTrackPicks_(st, slide);
        const total = Object.keys(st.players).length;
        const answered = Object.keys(st.players).filter(id => st.players[id].lp != null).length;
        qzSetText_(slide, 'clock', '⏳ ' + remain + '초 · ✋ ' + answered + '/' + total);
      }
      qzSaveState_(st);
    } else if (st.phase === 'REVEAL' && now >= st.revealUntil) {
      if (st.qNo >= st.order.length) {
        qzFinish_(st, slide);
      } else {
        qzStartQuestion_(st, slide);
      }
      qzSaveState_(st);
    }
    return qzStatus_('');
  } finally {
    lock.releaseLock();
  }
}

function qzJudgeNow() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const st = qzLoadState_();
    if (!st || (st.phase !== 'VOTE' && st.phase !== 'QUESTION')) {
      return qzStatus_('진행 중인 투표/문제가 없습니다.');
    }
    const slide = qzSlide_();
    if (st.phase === 'VOTE') qzJudgeVote_(st, slide);
    else qzJudgeQuestion_(st, slide);
    qzSaveState_(st);
    return qzStatus_('강제 판정 완료.');
  } finally {
    lock.releaseLock();
  }
}

function qzReset() {
  return qzSetup();
}

// ---------- 게임 루프 내부 ----------

function qzStartVote_(st, slide) {
  st.phase = 'VOTE';
  st.deadline = Date.now() + QZ_VOTE_SEC * 1000;
  qzResetLocks_(st);
  qzRenderCards_(slide, QZ_CATS.map(cat => QZ_BANK[cat].emoji + ' ' + cat), QZ_C.vote);
  qzSetText_(slide, 'question', '🗳️ 어떤 퀴즈로 할까요? 아바타를 원하는 카테고리 카드 위로!');
  qzSetText_(slide, 'banner', '카테고리 투표 — 다수결로 결정!');
  qzSetText_(slide, 'clock', '⏳ ' + QZ_VOTE_SEC + '초');
  qzUpdateStandings_(st, slide);
}

function qzJudgeVote_(st, slide) {
  const picks = qzFinalPicks_(st, slide); // objectId → cardIndex(-1 무응답)
  const tally = [0, 0, 0, 0];
  Object.keys(picks).forEach(id => { if (picks[id] >= 0) tally[picks[id]] += 1; });
  const max = Math.max.apply(null, tally);
  const top = [];
  tally.forEach((n, i) => { if (n === max && max > 0) top.push(i); });
  const winIdx = top.length ? top[Math.floor(Math.random() * top.length)] : Math.floor(Math.random() * QZ_CATS.length);
  st.cat = QZ_CATS[winIdx];

  // 문제 순서 셔플
  const n = QZ_BANK[st.cat].qs.length;
  const order = [];
  for (let i = 0; i < n; i++) order.push(i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }
  st.order = order.slice(0, Math.min(QZ_NUM_QUESTIONS, n));
  st.qNo = 0;

  const detail = QZ_CATS.map((c, i) => c + ' ' + tally[i] + '표').join(', ');
  qzLog_(st, '투표 결과: ' + detail);
  qzLog_(st, '카테고리 확정: ' + st.cat + (top.length > 1 ? ' (동표 추첨)' : ''));

  // 당선 카드 하이라이트 연출
  qzFindAll_(slide, 'card').forEach(el => {
    const i = Number(el.getTitle().split(':')[2]);
    const shape = el.asShape();
    shape.getFill().setSolidFill(i === winIdx ? QZ_C.correct : QZ_C.wrong);
  });
  qzSetText_(slide, 'question', '✅ 카테고리 확정: ' + QZ_BANK[st.cat].emoji + ' ' + st.cat + ' — 곧 1번 문제!');
  qzSetText_(slide, 'clock', '🗳️ 확정!');
  qzUpdateStandings_(st, slide);
  st.phase = 'REVEAL';
  st.revealUntil = Date.now() + QZ_REVEAL_MS;
}

function qzStartQuestion_(st, slide) {
  st.qNo += 1;
  const q = QZ_BANK[st.cat].qs[st.order[st.qNo - 1]];

  // 보기 셔플 + 정답 카드 추적
  const idx = [0, 1, 2, 3];
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  st.correctCard = idx.indexOf(q.a);
  st.choices = idx.map(i => q.c[i]);

  st.phase = 'QUESTION';
  st.deadline = Date.now() + QZ_ROUND_SEC * 1000;
  qzResetLocks_(st);

  const marks = ['①', '②', '③', '④'];
  qzRenderCards_(slide, st.choices.map((c, i) => marks[i] + ' ' + c), QZ_C.card);
  qzSetText_(slide, 'question', 'Q' + st.qNo + '. ' + q.q);
  qzSetText_(slide, 'banner',
    QZ_BANK[st.cat].emoji + ' ' + st.cat + ' — 문제 ' + st.qNo + '/' + st.order.length + ' · 정답 카드 위로!');
  qzSetText_(slide, 'clock', '⏳ ' + QZ_ROUND_SEC + '초');
}

function qzJudgeQuestion_(st, slide) {
  const picks = qzFinalPicks_(st, slide);
  const marks = ['①', '②', '③', '④'];
  const winners = [];
  Object.keys(st.players).forEach(id => {
    if (picks[id] === st.correctCard) {
      st.players[id].score += QZ_SCORE;
      winners.push(qzPlayerLabel_(st, id));
    }
  });

  // 연출: 정답 카드 초록, 오답 카드 어둡게
  qzFindAll_(slide, 'card').forEach(el => {
    const i = Number(el.getTitle().split(':')[2]);
    const shape = el.asShape();
    if (i === st.correctCard) {
      shape.getFill().setSolidFill(QZ_C.correct);
      qzStyleText_(shape, '✅ ' + marks[i] + ' ' + st.choices[i], 13, QZ_C.correctText, true);
    } else {
      shape.getFill().setSolidFill(QZ_C.wrong);
    }
  });

  qzLog_(st, 'Q' + st.qNo + ' 정답 ' + marks[st.correctCard] + ' — ' +
    (winners.length ? winners.join(', ') + ' +' + QZ_SCORE : '정답자 없음 😱'));
  qzSetText_(slide, 'clock', '💡 정답 공개!');
  qzUpdateStandings_(st, slide);
  st.phase = 'REVEAL';
  st.revealUntil = Date.now() + QZ_REVEAL_MS;
}

function qzFinish_(st, slide) {
  qzRank_(st);
  const rows = Object.keys(st.players).map(id => st.players[id]);
  rows.sort((a, b) => a.rank - b.rank);
  const tops = rows.filter(p => p.rank === 1).map(p => p.label).join(', ');
  qzSetText_(slide, 'banner', '👑 우승: ' + tops + ' (' + rows[0].score + '점) — 축하합니다!');
  qzSetText_(slide, 'question', '🏁 퀴즈 종료! 우측 리더보드에서 최종 순위를 확인하세요.');
  qzSetText_(slide, 'clock', '🏁 종료');
  qzLog_(st, '우승 ' + tops + ' (' + rows[0].score + '점)');
  qzUpdateStandings_(st, slide);
  st.phase = 'DONE';
}

// 라운드 시작 시 락인 상태 초기화. cp=직전 tick의 위치, cs=연속 유지 tick 수, lp=확정된 답.
function qzResetLocks_(st) {
  Object.keys(st.players).forEach(id => {
    const p = st.players[id];
    p.cp = null; p.cs = 0; p.lp = null;
  });
}

/**
 * 매 tick 호출: 같은 카드 위에 QZ_LOCK_TICKS번 연속 머문 위치를 답으로 확정(lp).
 * 슬라이드는 도형별 편집 제한이 불가능하므로, 확정된 답을 판정에 쓰는 것으로
 * "남이 내 말을 옮기는" 훼방을 무력화한다. 답을 바꾸려면 새 카드에 다시 ~4초 머물면 된다.
 */
function qzTrackPicks_(st, slide) {
  const picks = qzPicks_(st, slide);
  Object.keys(st.players).forEach(id => {
    const p = st.players[id];
    const cur = picks[id];
    if (cur === p.cp) { p.cs = (p.cs || 0) + 1; } else { p.cp = cur; p.cs = 1; }
    if (p.cs >= QZ_LOCK_TICKS && cur >= 0) p.lp = cur;
  });
}

/**
 * 판정용 최종 답: 확정된 답(lp)이 있으면 그것을, 없으면 마감 순간의 위치를 쓴다.
 * (막판에 남이 말을 치워도 lp가 있으면 영향 없음)
 */
function qzFinalPicks_(st, slide) {
  qzTrackPicks_(st, slide); // 마감 직전 위치도 한 번 더 집계 (연속 유지 중이면 확정됨)
  const picks = qzPicks_(st, slide);
  const out = {};
  Object.keys(st.players).forEach(id => {
    const p = st.players[id];
    out[id] = (p.lp != null) ? p.lp : picks[id];
  });
  return out;
}

/**
 * 아바타 → 선택 카드 매핑. 게임장 안 아바타는 가장 가까운 카드 중심으로 배정,
 * 게임장 밖(대기석 등)은 -1 (무응답).
 */
function qzPicks_(st, slide) {
  const sx = qzScaleX_(), sy = qzScaleY_();
  const centers = qzCardCenters_();
  const picks = {};
  Object.keys(st.players).forEach(id => {
    const el = slide.getPageElementById(id);
    if (!el) { picks[id] = -1; return; }
    const cx = (el.getLeft() + el.getWidth() / 2) / sx;
    const cy = (el.getTop() + el.getHeight() / 2) / sy;
    if (cy < QZ_L.arenaY || cy > QZ_L.arenaBottom) { picks[id] = -1; return; }
    let best = -1, bestD = Infinity;
    centers.forEach((c, i) => {
      const d = (cx - c[0]) * (cx - c[0]) + (cy - c[1]) * (cy - c[1]);
      if (d < bestD) { bestD = d; best = i; }
    });
    picks[id] = best;
  });
  return picks;
}

function qzCardCenters_() {
  const L = QZ_L;
  return [
    [L.cardX0 + L.cardW / 2, L.cardY0 + L.cardH / 2],
    [L.cardX1 + L.cardW / 2, L.cardY0 + L.cardH / 2],
    [L.cardX0 + L.cardW / 2, L.cardY1 + L.cardH / 2],
    [L.cardX1 + L.cardW / 2, L.cardY1 + L.cardH / 2],
  ];
}

// 2×2 선택 카드를 (재)생성한다. labels.length = 4.
function qzRenderCards_(slide, labels, fill) {
  qzFindAll_(slide, 'card').forEach(el => el.remove());
  const sx = qzScaleX_(), sy = qzScaleY_();
  const L = QZ_L;
  const pos = [
    [L.cardX0, L.cardY0], [L.cardX1, L.cardY0],
    [L.cardX0, L.cardY1], [L.cardX1, L.cardY1],
  ];
  labels.forEach((label, i) => {
    const card = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE,
      pos[i][0] * sx, pos[i][1] * sy, L.cardW * sx, L.cardH * sy);
    card.setTitle(QZ_TAG + 'card:' + i);
    card.getFill().setSolidFill(fill);
    card.getBorder().setWeight(1.5);
    card.getBorder().getLineFill().setSolidFill(QZ_C.cardBorder);
    qzStyleText_(card, label, 13, QZ_C.cardText, true);
    card.sendToBack(); // 아바타가 카드 위에 올라와도 가려지지 않게
  });
  const floorEl = qzFindOne_(slide, 'floor');
  if (floorEl) floorEl.sendToBack();
}

// ---------- 보드 렌더링 ----------

function qzBuildBoard_() {
  const pres = SlidesApp.getActivePresentation();
  const slide = pres.getSlides()[0];
  slide.getPageElements().forEach(el => el.remove());
  slide.getBackground().setSolidFill(QZ_C.bg);
  const sx = qzScaleX_(), sy = qzScaleY_();
  const L = QZ_L;

  // 게임장 바닥
  const floor = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE,
    L.arenaX * sx, (L.arenaY - 5) * sy, L.arenaW * sx, (L.arenaBottom - L.arenaY + 10) * sy);
  floor.setTitle(QZ_TAG + 'floor');
  floor.getFill().setSolidFill(QZ_C.floor);
  floor.getBorder().setWeight(1);
  floor.getBorder().getLineFill().setSolidFill(QZ_C.floorBorder);

  // 문제 텍스트
  const qbox = slide.insertTextBox('✨ 게임을 시작하면 여기에 문제가 나와요 ✨',
    L.qX * sx, L.qY * sy, L.qW * sx, L.qH * sy);
  qbox.setTitle(QZ_TAG + 'question');
  qzStyleText_(qbox, null, 13, QZ_C.banner, true);

  // 배너 + 카운트다운
  const brand = slide.insertTextBox('🎪 SLIIIDE 퀴즈쇼',
    L.bannerX * sx, L.bannerY * sy, 145 * sx, L.bannerH * sy);
  qzStyleText_(brand, null, 11, QZ_C.gold, true);
  brand.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.START);

  const banner = slide.insertTextBox('🎈 친구를 골라 가운데 게임장으로 드래그하세요!',
    (L.bannerX + 150) * sx, L.bannerY * sy, (L.bannerW - 150) * sx, L.bannerH * sy);
  banner.setTitle(QZ_TAG + 'banner');
  qzStyleText_(banner, null, 12, QZ_C.banner, true);
  banner.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.START);

  const clockCard = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE,
    L.clockX * sx, L.clockY * sy, L.clockW * sx, L.clockH * sy);
  clockCard.getFill().setSolidFill(QZ_C.panel);
  clockCard.getBorder().setWeight(1);
  clockCard.getBorder().getLineFill().setSolidFill(QZ_C.panelBorder);

  const clock = slide.insertTextBox('⏳  --',
    L.clockX * sx, L.clockY * sy, L.clockW * sx, L.clockH * sy);
  clock.setTitle(QZ_TAG + 'clock');
  qzStyleText_(clock, null, 15, QZ_C.gold, true);

  // 우측 패널: 점수판 + 로그
  const panel = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE,
    L.panelX * sx, L.panelY * sy, L.panelW * sx, L.panelH * sy);
  panel.getFill().setSolidFill(QZ_C.panel);
  panel.getBorder().setWeight(1);
  panel.getBorder().getLineFill().setSolidFill(QZ_C.panelBorder);
  const stand = slide.insertTextBox('SCOREBOARD\n\n게임 시작 전',
    (L.panelX + 11) * sx, (L.panelY + 10) * sy, (L.panelW - 22) * sx, (L.panelH - 20) * sy);
  stand.setTitle(QZ_TAG + 'standings');
  qzStyleText_(stand, null, 9, QZ_C.panelText, false);
  stand.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.START);

  // 대기석
  const strip = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE,
    L.stripX * sx, L.stripY * sy, L.stripW * sx, L.stripH * sy);
  strip.setTitle(QZ_TAG + 'strip');
  strip.getFill().setSolidFill(QZ_C.strip);
  strip.getBorder().setWeight(1);
  strip.getBorder().getLineFill().setSolidFill(QZ_C.panelBorder);
  const stripLabel = slide.insertTextBox('🧸 WAITING LOUNGE   ·   참가할 캐릭터를 위로 옮겨주세요',
    (L.stripX + 12) * sx, (L.stripY + 3) * sy, (L.stripW - 24) * sx, 16 * sy);
  stripLabel.setTitle(QZ_TAG + 'stripLabel');
  qzStyleText_(stripLabel, null, 8, QZ_C.muted, true);
  stripLabel.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.START);

  // 게임말 12개 (드라이브 이미지, 없으면 이모지 도형으로 대체)
  const blobs = qzAvatarBlobs_();
  QZ_AVATARS.forEach((name, i) => {
    const col = i % 6, row = Math.floor(i / 6);
    const x = (L.stripX + 14 + col * (L.avatar + 54)) * sx;
    const y = (L.stripY + 20 + row * (L.avatar - 4)) * sy;
    let av;
    if (blobs) {
      av = slide.insertImage(blobs[i], x, y, L.avatar * sx, L.avatar * sy);
    } else {
      av = slide.insertShape(SlidesApp.ShapeType.ELLIPSE, x, y, L.avatar * sx, L.avatar * sy);
      av.getFill().setSolidFill('#FFFFFF');
      av.getBorder().setWeight(1);
      av.getBorder().getLineFill().setSolidFill(QZ_C.cardBorder);
      qzStyleText_(av, QZ_AVATAR_EMOJI[i], 16, '#000000', false);
    }
    av.setTitle(QZ_TAG + 'avatar:' + name);
  });
}

function qzAvatarBlobs_() {
  try {
    const folders = DriveApp.getFoldersByName(QZ_IMG_FOLDER);
    if (!folders.hasNext()) return null;
    const files = folders.next().getFiles();
    const list = [];
    while (files.hasNext()) {
      const f = files.next();
      if (f.getMimeType().indexOf('image/') === 0) list.push(f);
    }
    if (list.length < QZ_AVATARS.length) return null;
    list.sort((a, b) => (a.getName() < b.getName() ? -1 : a.getName() > b.getName() ? 1 : 0));
    return list.slice(0, QZ_AVATARS.length).map(f => f.getBlob());
  } catch (e) {
    return null;
  }
}

// 점수 내림차순으로 순위 계산 (동점 = 공동 순위)
function qzRank_(st) {
  const rows = Object.keys(st.players).map(id => st.players[id]);
  rows.sort((a, b) => b.score - a.score);
  let rank = 0, prev = null;
  rows.forEach((p, i) => {
    if (p.score !== prev) { rank = i + 1; prev = p.score; }
    p.rank = rank;
  });
}

function qzUpdateStandings_(st, slide) {
  qzRank_(st);
  const rows = Object.keys(st.players).map(id => st.players[id]);
  rows.sort((a, b) => a.rank - b.rank);
  const lines = ['SCOREBOARD', '────────────'];
  rows.forEach(p => {
    lines.push(p.rank + '위  ' + p.label + '  ' + p.score + '점');
  });
  lines.push('');
  lines.push('GAME LOG');
  st.log.forEach(l => lines.push('· ' + l));
  qzSetText_(slide, 'standings', lines.join('\n'));
}

// ---------- 헬퍼 ----------

function qzSlide_() {
  return SlidesApp.getActivePresentation().getSlides()[0];
}

function qzScaleX_() {
  return SlidesApp.getActivePresentation().getPageWidth() / 720;
}

function qzScaleY_() {
  return SlidesApp.getActivePresentation().getPageHeight() / 405;
}

function qzFindAll_(slide, tag) {
  const prefix = QZ_TAG + tag;
  return slide.getPageElements().filter(el => {
    const t = el.getTitle();
    return t && t.indexOf(prefix) === 0;
  });
}

function qzFindOne_(slide, tag) {
  const list = qzFindAll_(slide, tag);
  return list.length ? list[0] : null;
}

function qzSetText_(slide, tag, text) {
  const el = qzFindOne_(slide, tag);
  if (el) el.asShape().getText().setText(text);
}

function qzStyleText_(shape, text, size, color, bold) {
  const tr = shape.getText();
  if (text !== null) tr.setText(text);
  tr.getTextStyle().setFontFamily(QZ_FONT).setFontSize(size).setForegroundColor(color).setBold(!!bold);
  tr.getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
  shape.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
}

function qzLabel_(el) {
  const prefix = QZ_TAG + 'avatar:';
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

function qzPlayerLabel_(st, id) {
  return (st.players[id] && st.players[id].label) || '❓';
}

function qzLog_(st, msg) {
  st.log.push(msg);
  if (st.log.length > QZ_MAX_LOG) st.log = st.log.slice(-QZ_MAX_LOG);
}

function qzLoadState_() {
  const raw = PropertiesService.getDocumentProperties().getProperty(QZ_KEY);
  return raw ? JSON.parse(raw) : null;
}

function qzSaveState_(st) {
  PropertiesService.getDocumentProperties().setProperty(QZ_KEY, JSON.stringify(st));
}

function qzStatus_(msg) {
  const st = qzLoadState_();
  if (!st) return { ok: false, msg: msg || '상태 없음 — [보드 생성]부터.' };
  return {
    ok: true,
    phase: st.phase,
    qNo: st.qNo || 0,
    qTotal: (st.order && st.order.length) || 0,
    cat: st.cat || '',
    total: Object.keys(st.players).length,
    msg: msg || '',
    log: st.log || [],
  };
}
