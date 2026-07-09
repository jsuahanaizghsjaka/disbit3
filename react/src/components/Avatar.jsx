// Аватар: фото → эмодзи → монограмма (как в vanilla-версии)
export default function Avatar({ profile, size = 72 }) {
  const style = { width: size, height: size };
  if (profile.photo) {
    return (
      <div className="avatar" style={{ ...style, background: 'transparent' }}>
        <img src={profile.photo} alt="Аватар" />
      </div>
    );
  }
  if (profile.emoji) {
    return <div className="avatar emoji" style={style}>{profile.emoji}</div>;
  }
  const letter = (profile.name || '').trim()[0] || '?';
  return (
    <div className="avatar" style={{ ...style, background: profile.color }}>
      {letter}
    </div>
  );
}
