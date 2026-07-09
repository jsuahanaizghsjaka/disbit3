import { useEffect, useState } from 'react';
import { KEYS, loadJson, saveJson, defaultProfile, defaultSettings, applyTheme } from './storage.js';
import ProfileCard from './components/ProfileCard.jsx';
import MotivationCard from './components/MotivationCard.jsx';
import GoalsCard from './components/GoalsCard.jsx';
import FriendsCard from './components/FriendsCard.jsx';
import ThemePicker from './components/ThemePicker.jsx';

export default function App() {
  const [profile, setProfile] = useState(() => loadJson(KEYS.profile, defaultProfile));
  const [settings, setSettings] = useState(() => loadJson(KEYS.settings, defaultSettings));
  const [goals, setGoals] = useState(() => loadJson(KEYS.goals, []));
  const [friends, setFriends] = useState(() => loadJson(KEYS.friends, []));

  // персист + применение темы
  useEffect(() => { saveJson(KEYS.profile, profile); }, [profile]);
  useEffect(() => { saveJson(KEYS.settings, settings); applyTheme(settings.theme); }, [settings]);
  useEffect(() => { saveJson(KEYS.goals, goals); }, [goals]);
  useEffect(() => { saveJson(KEYS.friends, friends); }, [friends]);

  return (
    <div className="app">
      <div className="logo">dis<span>bit</span></div>
      <p className="subtitle">Профиль · React-версия (данные — те же ключи localStorage, что и у прототипа)</p>

      <ProfileCard profile={profile} onChange={setProfile} />
      <MotivationCard profile={profile} onChange={setProfile} />
      <GoalsCard goals={goals} onChange={setGoals} />
      <FriendsCard friends={friends} onChange={setFriends} />
      <ThemePicker
        theme={settings.theme}
        onChange={theme => setSettings(s => ({ ...s, theme }))}
      />
    </div>
  );
}
