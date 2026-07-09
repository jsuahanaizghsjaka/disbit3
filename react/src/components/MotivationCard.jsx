export default function MotivationCard({ profile, onChange }) {
  const m = profile.motivation || { level: 50, text: '' };
  const set = patch => onChange({ ...profile, motivation: { ...m, ...patch } });

  return (
    <section className="card">
      <h3 className="card-title">⚡ Мотивация</h3>
      <div className="slider-row">
        <input
          type="range"
          className="slider"
          min={0}
          max={100}
          step={5}
          value={m.level}
          onChange={e => set({ level: Number(e.target.value) })}
          aria-label="Уровень мотивации"
        />
        <output>{m.level}%</output>
      </div>
      <label className="field-label" htmlFor="mot">Цели и желания</label>
      <textarea
        id="mot"
        className="field-textarea"
        maxLength={500}
        placeholder="Что тебя мотивирует? Ради чего всё это…"
        value={m.text}
        onChange={e => set({ text: e.target.value })}
      />
      <p className="hint">Сохраняется автоматически.</p>
    </section>
  );
}
