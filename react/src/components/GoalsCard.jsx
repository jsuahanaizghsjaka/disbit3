import { useState } from 'react';

const clamp = v => Math.max(0, Math.min(100, v));

export default function GoalsCard({ goals, onChange }) {
  const [name, setName] = useState('');

  const add = () => {
    const n = name.trim();
    if (!n) return;
    onChange([...goals, { id: 'g' + Date.now(), name: n, icon: '🎯', deadline: null, progress: 0 }]);
    setName('');
  };
  const bump = (id, d) =>
    onChange(goals.map(g => (g.id === id ? { ...g, progress: clamp((g.progress || 0) + d) } : g)));
  const remove = id => onChange(goals.filter(g => g.id !== id));

  return (
    <section className="card">
      <h3 className="card-title">🎯 Большие цели</h3>
      {goals.length === 0 && <p className="hint">Долгие цели на месяцы — основа ежедневных привычек.</p>}
      {goals.map(g => (
        <div key={g.id} className="list-row" style={{ display: 'block' }}>
          <div className="row">
            <span>{g.icon}</span>
            <span className="list-name">{g.name}</span>
            <span className="g-pct">{g.progress || 0}%</span>
          </div>
          <div className="goal-bar">
            <div className="goal-fill" style={{ width: (g.progress || 0) + '%' }} />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="mini-btn" onClick={() => bump(g.id, -5)}>−5</button>
            <button className="mini-btn" onClick={() => bump(g.id, 5)}>+5</button>
            <button className="mini-btn danger" onClick={() => remove(g.id)}>удалить</button>
          </div>
        </div>
      ))}
      <div className="row" style={{ marginTop: 10 }}>
        <input
          className="field-input"
          style={{ flex: 1 }}
          maxLength={60}
          placeholder="Новая большая цель…"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
        />
        <button className="btn" onClick={add}>Добавить</button>
      </div>
    </section>
  );
}
