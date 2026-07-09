import { useState } from 'react';
import { AVA_EMOJIS } from '../storage.js';

export default function FriendsCard({ friends, onChange }) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(AVA_EMOJIS[0]);

  const add = () => {
    const n = name.trim();
    if (!n) return;
    onChange([...friends, { id: 'f' + Date.now(), name: n, emoji }]);
    setName('');
  };
  const remove = id => onChange(friends.filter(f => f.id !== id));

  return (
    <section className="card">
      <h3 className="card-title">👥 Друзья</h3>
      {friends.map(f => (
        <div key={f.id} className="list-row">
          <span className="list-ava">{f.emoji || '🙂'}</span>
          <span className="list-name">{f.name}</span>
          <button className="mini-btn danger" onClick={() => remove(f.id)}>✕</button>
        </div>
      ))}
      <div className="row" style={{ marginTop: 10 }}>
        <input
          className="field-input"
          style={{ flex: 1 }}
          maxLength={24}
          placeholder="Имя друга…"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
        />
        <button className="btn" onClick={add}>Добавить</button>
      </div>
      <div className="picker" style={{ marginTop: 10 }}>
        {AVA_EMOJIS.slice(0, 12).map(em => (
          <button
            key={em}
            className={'pick' + (emoji === em ? ' selected' : '')}
            onClick={() => setEmoji(em)}
            aria-label={'Аватар ' + em}
          >
            {em}
          </button>
        ))}
      </div>
      <p className="hint">Прототип: список локальный. Совместные стрики появятся с аккаунтами.</p>
    </section>
  );
}
