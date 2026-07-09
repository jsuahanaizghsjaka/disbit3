/* Общие ключи и хелперы хранилища.
   Те же ключи, что и в vanilla-версии (frontend/script.js), —
   при работе с одного origin данные общие. */

export const KEYS = {
  habits:   'disbit_habits_v1',
  ledger:   'disbit_ledger_v1',
  profile:  'disbit_profile_v1',
  settings: 'disbit_settings_v1',
  friends:  'disbit_friends_v1',
  goals:    'disbit_goals_v1',
  rewards:  'disbit_rewards_v1',
  backlog:  'disbit_backlog_v1'
};

export const COLORS = ['#5B8DFF','#4ADE80','#38BDF8','#F472B6','#A78BFA','#F87171','#FBBF24','#E8722A'];
export const AVA_EMOJIS = ['😀','😎','🦊','🐻','🐼','🦁','🐯','🐸','🦉','🐨','🦄','🐢','🚀','🔥','⚡','🌟','🍀','🌊','🎧','🎮','🏔️','🌙','🍕','☕'];

export const THEMES = [
  { id: 'blue',   c: '#5B8DFF' },
  { id: 'red',    c: '#E06060' },
  { id: 'black',  c: '#2A2C31' },
  { id: 'white',  c: '#E9EDF3' },
  { id: 'yellow', c: '#D4A528' },
  { id: 'orange', c: '#E8722A' },
  { id: 'green',  c: '#3EBE7D' },
  { id: 'purple', c: '#9D7BFA' }
];

export function loadJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    if (Array.isArray(fallback)) return Array.isArray(v) ? v : fallback;
    return v && typeof v === 'object' ? { ...fallback, ...v } : fallback;
  } catch {
    return fallback;
  }
}
export function saveJson(key, v) {
  localStorage.setItem(key, JSON.stringify(v));
}

export const defaultProfile = {
  name: '', color: COLORS[0], createdAt: null,
  photo: null, emoji: null,
  motivation: { level: 50, text: '' }
};
export const defaultSettings = { showOffday: true, theme: 'blue' };

export function applyTheme(theme) {
  if (!theme || theme === 'blue') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
