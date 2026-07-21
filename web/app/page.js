'use client';

import { useState } from 'react';
import QRCode from 'qrcode';

const GAMES = [
  { id: 'omok', name: '오목', emoji: '⚫', desc: '1:1 대전 · 다섯 개를 이으면 승리', players: 2, ready: true },
  { id: 'liar', name: '라이어 게임', emoji: '🎭', desc: '단체전 · 너만 모르는 제시어', ready: false },
  { id: 'maze', name: '3D 미로 탈출', emoji: '🌀', desc: '1:1 경주 · 스프레드시트에서 3D를', ready: false },
  { id: 'battleship', name: '해전', emoji: '🚢', desc: '1:1 · 숨겨진 함대를 격침하라', ready: false },
];

export default function Home() {
  const [creating, setCreating] = useState(false);
  const [room, setRoom] = useState(null);
  const [qrs, setQrs] = useState({});
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(null);

  async function createRoom(game) {
    setCreating(true);
    setError(null);
    setRoom(null);
    try {
      const res = await fetch('/api/room', {
        method: 'POST',
        body: JSON.stringify({ game: game.id, players: game.players }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '방 생성에 실패했습니다');
      const q = {};
      for (const link of data.links) {
        q[link.url] = await QRCode.toDataURL(link.url, { width: 300, margin: 1 });
      }
      setQrs(q);
      setRoom(data);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setCreating(false);
    }
  }

  async function copy(url) {
    await navigator.clipboard.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <main className="wrap">
      <span className="logo">SHEEET</span>
      <p className="tagline">
        설치도, 가입도, 앱도 없다. <b>링크를 열면 그 시트가 곧 게임방이다.</b>
      </p>

      <div className="grid">
        {GAMES.map(game => (
          <button
            key={game.id}
            className="card"
            disabled={!game.ready || creating}
            onClick={() => createRoom(game)}
          >
            <span className="emoji">{game.emoji}</span>
            <h3>{game.name}</h3>
            <p>{game.desc}</p>
            {!game.ready && <span className="soon">준비 중</span>}
          </button>
        ))}
      </div>

      {creating && <p className="status">🛠 게임방을 만드는 중… (5~10초)</p>}
      {error && <p className="error">⚠️ {error}</p>}

      {room && (
        <section className="room">
          <h2>🎉 {room.game} 방이 열렸습니다</h2>
          <p className="hint">
            각 플레이어에게 <b>자기 링크만</b> 보내세요. 링크가 곧 플레이어 자리입니다.
          </p>
          <div className="links">
            {room.links.map(link => (
              <div className="link-card" key={link.url}>
                <div className="role">{link.role}</div>
                {qrs[link.url] && <img src={qrs[link.url]} alt={link.role + ' QR'} />}
                <div className="btns">
                  <button className="btn primary" onClick={() => copy(link.url)}>
                    {copied === link.url ? '복사됨 ✓' : '링크 복사'}
                  </button>
                  <a className="btn" href={link.url} target="_blank" rel="noreferrer">
                    입장
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
