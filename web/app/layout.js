import './globals.css';

export const metadata = {
  metadataBase: new URL('https://sheeet-zeta.vercel.app'),
  title: 'SHEEET — 링크를 열면 그 시트가 곧 게임방',
  description:
    '설치도, 가입도, 앱도 없다. 오목·픽셀 그리기·라이어 게임·3D 미로·경마·퀴즈쇼 — 구글 스프레드시트에서 바로 시작하는 멀티플레이 게임.',
  openGraph: {
    title: 'SHEEET — 링크를 열면 그 시트가 곧 게임방',
    description:
      '설치도, 가입도, 앱도 없다. 링크 하나로 친구와 바로 시작하는 스프레드시트 게임 7종.',
    url: 'https://sheeet-zeta.vercel.app',
    siteName: 'SHEEET',
    locale: 'ko_KR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SHEEET — 링크를 열면 그 시트가 곧 게임방',
    description: '설치도, 가입도, 앱도 없다. 링크 하나로 시작하는 스프레드시트 게임 7종.',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
