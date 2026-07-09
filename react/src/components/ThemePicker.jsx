import { THEMES } from '../storage.js';

const NAMES = {
  blue: 'Синяя', red: 'Красная', black: 'Чёрная', white: 'Светлая',
  yellow: 'Жёлтая', orange: 'Оранжевая', green: 'Зелёная', purple: 'Фиолетовая'
};

export default function ThemePicker({ theme, onChange }) {
  return (
    <section className="card">
      <h3 className="card-title">🎨 Цвет приложения</h3>
      <div className="theme-grid">
        {THEMES.map(t => (
          <button
            key={t.id}
            className={'theme-swatch' + (theme === t.id ? ' active' : '')}
            style={{ background: t.c }}
            onClick={() => onChange(t.id)}
            aria-label={'Тема: ' + NAMES[t.id]}
            title={NAMES[t.id]}
          />
        ))}
      </div>
      <p className="hint">Тема общая с основным приложением — хранится в тех же настройках.</p>
    </section>
  );
}
