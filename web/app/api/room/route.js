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
  try {
    const res = await fetch(url, { redirect: 'follow', cache: 'no-store' });
    const data = await res.json();
    return Response.json(data);
  } catch (err) {
    return Response.json({ ok: false, error: '방 공장 호출 실패: ' + String(err) }, { status: 502 });
  }
}
