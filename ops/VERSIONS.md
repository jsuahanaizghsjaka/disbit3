# Disbit — таблица версий

Одна строка на каждый выкатанный билд. Правило: перед выкаткой ставим git-тег
на коммит и добавляем строку сюда. Данные ниже взяты из отчётов в `ops/` и
`RELEASE-FOUNDATION-REPORT.md`; пустая ячейка значит, что значение нигде не записано.

| Дата | Что | Версия / versionCode | Коммит | Тег | Источник |
|---|---|---|---|---|---|
| 2026-10-25 | Сервер production + staging | — | `d487aab` | — | RELEASE-FOUNDATION-REPORT.md |
| 2026-10-25 | Android APK/AAB | 1.0.4 / 5 | `d487aab` | — | RELEASE-FOUNDATION-REPORT.md |
| 2026-10-27 | Android APK (Galaxy A22) | 1.0.6 / 7 | `e65ec69` | — | plans/DISBIT-PERFORMANCE-AUDIT-AND-SPEC.md |
| 2026-11-07 | Сервер production + staging | — | `2c975b7` | `server-2026-11-07` | ops/INTRO-SKIP-GOOGLE-2026-11-07.md |
| не выпущен | Android (в `android/app/build.gradle`) | 1.0.7 / 8 | — | — | build.gradle |

## Как ставить тег

### Сверка production 13 ноября 2026

`/srv/disbit/current` и `/api/ready` сообщают прежний идентификатор
`777ff1012f6b98e7897edde2c5b364d5b69124ce`. Этого объекта в текущей истории Git нет.
Содержимое `frontend/`, `backend/` (без node_modules и .env), `scripts/`,
`package.json` и `package-lock.json` на production сравнено с архивом тега
`server-2026-11-07` (`2c975b7d4651f53a9634900a7973ae8308e56270`): различий нет.
Это подтверждение совпадения перечисленных файлов, а не наличия старого коммита
в текущем репозитории. Тег не перемещался; production не переустанавливался.

- Сервер: `git tag server-ГГГГ-ММ-ДД <коммит>`
- Android: `git tag android-<versionName>-<versionCode> <коммит>`
- iOS: `git tag ios-<version>-<build> <коммит>`
- После: `git push origin --tags`
