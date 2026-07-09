import { useRef } from 'react';
import Avatar from './Avatar.jsx';
import { AVA_EMOJIS, COLORS } from '../storage.js';

// уменьшаем фото до 256px, чтобы поместилось в localStorage
function shrinkPhoto(file, cb) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const s = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    URL.revokeObjectURL(url);
    cb(canvas.toDataURL('image/jpeg', 0.82));
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

export default function ProfileCard({ profile, onChange }) {
  const fileRef = useRef(null);

  return (
    <section className="card">
      <div className="hero">
        <Avatar profile={profile} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="hero-name">{profile.name?.trim() || 'Без имени'}</div>
          <div className="hero-sub">аватар: фото, эмодзи или монограмма</div>
        </div>
      </div>

      <label className="field-label" htmlFor="name">Имя</label>
      <input
        id="name"
        className="field-input"
        maxLength={24}
        placeholder="Как тебя зовут?"
        value={profile.name}
        onChange={e => onChange({ ...profile, name: e.target.value })}
      />

      <span className="field-label">Фотография</span>
      <div className="row">
        <button className="btn ghost" onClick={() => fileRef.current?.click()}>
          Загрузить фото
        </button>
        {profile.photo && (
          <button className="btn ghost" onClick={() => onChange({ ...profile, photo: null })}>
            Убрать фото
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) shrinkPhoto(f, photo => onChange({ ...profile, photo, emoji: null }));
            e.target.value = '';
          }}
        />
      </div>

      <span className="field-label">Или эмодзи из каталога</span>
      <div className="picker">
        {AVA_EMOJIS.map(em => (
          <button
            key={em}
            className={'pick' + (profile.emoji === em ? ' selected' : '')}
            onClick={() => onChange({ ...profile, emoji: em, photo: null })}
            aria-label={'Эмодзи ' + em}
          >
            {em}
          </button>
        ))}
      </div>

      <span className="field-label">Цвет монограммы</span>
      <div className="picker">
        {COLORS.map(c => (
          <button
            key={c}
            className={'pick color' + (profile.color === c ? ' selected' : '')}
            style={{ background: c }}
            onClick={() => onChange({ ...profile, color: c })}
            aria-label={'Цвет ' + c}
          />
        ))}
      </div>
    </section>
  );
}
