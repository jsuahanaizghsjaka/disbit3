# Хостинг бэкенда disbit

Репо уже готово: `Dockerfile` в корне (бэкенд + фронт статикой),
`DB_PATH` для volume, HTTPS даёт сам хостинг. Осталось нажать кнопки.

## Вариант А — Railway (основной, ~5 минут)

Деплой прямо из локальной папки, GitHub не нужен:

```powershell
npm i -g @railway/cli
cd "C:\Users\Sinon\OneDrive\Рабочий стол\Claude-Cowork\disbit3"
railway login                 # откроет браузер
railway init                  # New Project → имя: disbit
railway up                    # соберёт Dockerfile и задеплоит
```

Дальше в браузере (railway.app → проект disbit → сервис):

1. **Volume** (иначе база сотрётся при редеплое!): правый клик по сервису →
   **Attach Volume** → mount path: `/data`.
2. **Variables** → добавить: `DB_PATH` = `/data/disbit.db`.
3. **Settings → Networking → Generate Domain** → получишь
   `https://disbit-production-XXXX.up.railway.app`.
4. Проверка: открой `https://<домен>/api/health` → `{"ok":true,...,"auth":true}`.
   Открой сам домен — приложение с рабочей регистрацией (фронт раздаётся сервером).

Обновления потом: снова `railway up` из папки.

💳 Railway: пробные $5, дальше Hobby ~5$/мес; нужна зарубежная карта.
Если карты нет → вариант Б.

## Вариант Б — Amvera (РФ, рубли)

1. amvera.ru → регистрация → «Создать проект» → тип **Приложение**, среда
   **Docker** (у нас свой Dockerfile).
2. Доставка кода: git push в их репозиторий (они покажут remote) или загрузка
   файлов в веб-интерфейсе.
3. В конфигурации: порт **3000**, persistent-хранилище смонтировать в `/data`,
   переменная `DB_PATH=/data/disbit.db`.
4. Домен выдают вида `disbit-<login>.amvera.io` с HTTPS.

## После деплоя — связать Vercel-фронт с сервером

В `frontend/script.js` вверху:

```js
const API_HOST = 'https://<твой-домен-бэкенда>';
```

и передеплоить Vercel (скажи мне «задеплой» + домен — сделаю; в этот раз
БЕЗ отключения API). Тогда disbit.vercel.app получит рабочую регистрацию.
Либо проще: забыть про Vercel и жить на домене бэкенда — там фронт+API
вместе, ничего настраивать не надо.

## Проверка после (2 мин)

- `/api/health` → ok
- регистрация нового аккаунта с телефона → привычка → вход с компа → привычка на месте
- redeploy (`railway up`) → данные НЕ пропали (volume работает)
