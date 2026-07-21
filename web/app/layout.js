import './globals.css';

export const metadata = {
  title: 'SHEEET — 링크를 열면 그 시트가 곧 게임방',
  description: '설치도, 가입도, 앱도 없다. 구글 스프레드시트에서 바로 시작하는 멀티플레이 게임.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
