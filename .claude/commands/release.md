---
description: Подготовить выпуск Disbit — сервер и/или Android, без публикации без разрешения
---
Подготовь выпуск: $ARGUMENTS (по умолчанию — сервер и Android).

1. Убедись, что дерево отслеживаемых файлов чистое и тесты зелёные (`npm test`, затронутые браузерные сценарии).
2. Android: подними `versionCode` на 1 и `versionName` в `android/app/build.gradle`, закоммить отдельным коммитом.
3. Покажи Актану, что войдёт в выпуск (`git log` от коммита на production — его SHA в `https://disbit.ru/api/health`), и спроси подтверждение.
4. Только после явного «да»: сервер — `.\ops\publish-release.ps1`, APK — `.\ops\release-android.ps1`. Секреты и пароли вводит Актан сам.
5. После выпуска: проверь `/api/health` (release = новый SHA), добавь строку в `ops/VERSIONS.md` и отчёт `ops/RELEASE-<версия>-<дата>.md`, закоммить.
