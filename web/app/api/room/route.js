export async function POST(req) {
  const { game, players, rounds, difficulty } = await req.json();
  const base = process.env.FACTORY_URL;
  if (!base) {
    return Response.json({ ok: false, error: 'FACTORY_URL 환경변수가 없습니다' }, { status: 500 });
  }
  const url =
    base +
    '?game=' + encodeURIComponent(game || '') +
    '&players=' + encodeURIComponent(players || '') +
    '&rounds=' + encodeURIComponent(rounds || '') +
    '&difficulty=' + encodeURIComponent(difficulty || '');

  // 구글이 가끔 JSON 대신 일시 장애 HTML을 돌려준다 — 조용히 한 번 더 시도
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(15000) });
      const text = await res.text();
      try {
        return Response.json(JSON.parse(text));
      } catch (parseErr) { /* HTML 응답 — 재시도 */ }
    } catch (netErr) { /* 네트워크 오류 — 재시도 */ }
  }
  return Response.json(
    { ok: false, error: '방 공장이 잠시 붐비고 있어요 — 몇 초 뒤 다시 눌러주세요 🙏' },
    { status: 502 },
  );
}
