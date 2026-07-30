'use client';

import { useState } from 'react';
import QRCode from 'qrcode';

const GAMES = [
  { id: 'omok', name: '오목', emoji: '⚫', desc: '1:1 대전 · 다섯 개를 이으면 승리', players: 2, ready: true },
  {
    id: 'pixel', name: '픽셀 기억 그리기', emoji: '🖼️',
    desc: '단체전 · 암기하고 그려라 — 가장 똑같이 그린 사람이 승리',
    ready: true, configurable: true, opts: { players: [2, 6], rounds: true, difficulty: true },
  },
  {
    id: 'liar', name: '라이어 게임', emoji: '🎭',
    desc: '단체전 · 너만 모르는 제시어 — 토론하고 투표로 라이어를 찾아라',
    ready: true, configurable: true, opts: { players: [3, 8] },
  },
  {
    id: 'maze', name: '3D 미로 탈출', emoji: '🌀',
    desc: '1:1 경주 · 스프레드시트에서 1인칭 3D를 — 먼저 출구를 찾아라',
    players: 2, ready: true,
  },
  {
    id: 'horse', name: '경마', emoji: '🏇',
    desc: '전원 한 링크 · 말 1~5에 베팅하고 레이스를 지켜봐라',
    players: 1, ready: true,
  },
];

const DIFFICULTIES = [
  { id: 'easy', label: '쉬움 (8×8 · 3색)' },
  { id: 'normal', label: '보통 (10×10 · 4색)' },
  { id: 'hard', label: '어려움 (12×12 · 5색)' },
];

export default function Home() {
  const [creating, setCreating] = useState(false);
  const [room, setRoom] = useState(null);
  const [qrs, setQrs] = useState({});
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(null);
  const [configGame, setConfigGame] = useState(null);
  const [config, setConfig] = useState({ players: 4, rounds: 3, difficulty: 'normal' });

  function onCardClick(game) {
    if (game.configurable) {
      const [min, max] = game.opts.players;
      setConfig(c => ({ ...c, players: Math.min(Math.max(c.players, min), max) }));
      setConfigGame(configGame?.id === game.id ? null : game);
      setRoom(null);
      setError(null);
      return;
    }
    setConfigGame(null);
    createRoom(game);
  }

  function range(min, max) {
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }

  async function createRoom(game, opts) {
    setCreating(true);
    setError(null);
    setRoom(null);
    try {
      const res = await fetch('/api/room', {
        method: 'POST',
        body: JSON.stringify({ game: game.id, players: game.players, ...opts }),
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
            onClick={() => onCardClick(game)}
          >
            <span className="emoji">{game.emoji}</span>
            <h3>{game.name}</h3>
            <p>{game.desc}</p>
            {!game.ready && <span className="soon">준비 중</span>}
          </button>
        ))}
      </div>

      {configGame && (
        <section className="room config">
          <h2>{configGame.emoji} {configGame.name} — 방 설정</h2>
          <div className="options">
            <label>
              인원
              <select
                value={config.players}
                onChange={e => setConfig({ ...config, players: Number(e.target.value) })}
              >
                {range(...configGame.opts.players).map(n => <option key={n} value={n}>{n}명</option>)}
              </select>
            </label>
            {configGame.opts.rounds && (
              <label>
                라운드
                <select
                  value={config.rounds}
                  onChange={e => setConfig({ ...config, rounds: Number(e.target.value) })}
                >
                  {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}라운드</option>)}
                </select>
              </label>
            )}
            {configGame.opts.difficulty && (
              <label>
                난이도
                <select
                  value={config.difficulty}
                  onChange={e => setConfig({ ...config, difficulty: e.target.value })}
                >
                  {DIFFICULTIES.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
              </label>
            )}
            <button
              className="btn primary"
              disabled={creating}
              onClick={() => createRoom({ id: configGame.id, players: config.players }, {
                rounds: config.rounds, difficulty: config.difficulty,
              })}
            >
              방 만들기
            </button>
          </div>
        </section>
      )}

      {creating && <p className="status">🛠 게임방을 만드는 중… (플레이어 수에 따라 10~30초)</p>}
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
