# disbit — React-профиль

Заготовка для будущего переезда фронтенда на React. Сейчас здесь
реализован **экран профиля**: аватар (фото / эмодзи / монограмма),
мотивация с ползунком, большие цели, друзья и смена темы приложения.

## Запуск

```bash
cd react
npm install
npm run dev          # http://localhost:5173
```

## Как это связано с основным приложением

- Дизайн-токены и темы — те же, что в `frontend/style.css` (v0.4).
- Данные пишутся в те же ключи `localStorage` (`disbit_profile_v1`,
  `disbit_settings_v1`, `disbit_goals_v1`, `disbit_friends_v1`).

> ⚠️ Нюанс: localStorage привязан к origin. Vite-дев-сервер (`:5173`)
> и открытый напрямую `frontend/index.html` — разные origin, поэтому
> данные у них разные. Общие данные будут, когда React-сборка
> (`npm run build`) станет раздаваться бэкендом с того же порта —
> прокси `/api` в `vite.config.js` уже настроен на `localhost:3000`.

## Структура

```
src/
  App.jsx                — сборка экрана профиля
  storage.js             — ключи localStorage, темы, палитры
  styles.css             — токены дизайн-системы (копия v0.4)
  components/
    Avatar.jsx           — фото → эмодзи → монограмма
    ProfileCard.jsx      — имя + загрузка фото + каталог эмодзи + цвет
    MotivationCard.jsx   — ползунок мотивации + цели/желания
    GoalsCard.jsx        — большие цели с прогрессом
    FriendsCard.jsx      — друзья (локальный список)
    ThemePicker.jsx      — 8 тем приложения
```
