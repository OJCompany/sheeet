export async function GET() {
  const base = process.env.FACTORY_URL;
  if (!base) {
    return Response.json({ ok: false, error: 'FACTORY_URL 환경변수가 없습니다' }, { status: 500 });
  }
  try {
    const res = await fetch(base + '?ads=list', {
      redirect: 'follow',
      next: { revalidate: 60 }, // 광고 장부는 1분 캐시
    });
    const data = await res.json();
    return Response.json(data);
  } catch (err) {
    return Response.json({ ok: false, error: '광고판 조회 실패: ' + String(err) }, { status: 502 });
  }
}
