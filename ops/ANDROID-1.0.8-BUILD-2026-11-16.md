# Android 1.0.8 — результат сборки

- Файл: `release-artifacts/disbit-1.0.8-release.apk`, 5 662 043 байта.
- SHA-256: `a57267f0dfc458a03673a3c56249ff8cbdb0c15a9a4f01cfe3918cbc502b5cf3`.
- Пакет `io.disbit.app`, versionCode 9, versionName 1.0.8; minSdk 24, targetSdk 36. Release, не debuggable.
- Исходная версия Git: `2380e3b` (код опубликованного исправления безопасности `8fb575c`) плюс локальное повышение версии и исправление Android-ресурсов ниже.
- Существующая release-подпись сохранена. SHA-256 сертификата: `7e95ad23adccf196a54aa73ab1a192f97a1f54c699d6932802945e544befd701`; совпадает с проверенной предыдущей APK 1.0.6. apksigner verify — успешно, схема v2.

## Выполнено

1. Проверка release-ресурсов: API только HTTPS disbit.ru, ресурсы встроены, устаревших Railway URL нет.
2. Capacitor sync android: обновлены встроенные файлы и шесть плагинов.
3. Сборка перенесена по промежуточным каталогам в `%LOCALAPPDATA%/DisbitBuilds/1.0.8`: первая попытка в OneDrive завершилась AccessDeniedException. Исходники и ключ не переносились.
4. Исправлена найденная Lint ошибка NewApi: windowLightNavigationBar вынесен в values-v27, общий стиль сохранён для API 24–26.
5. Финальные задачи `:app:assembleRelease :app:testDebugUnitTest :app:lintRelease` — BUILD SUCCESSFUL.
6. Три unit-теста прошли: два BlockingWindowTest и один шаблонный ExampleUnitTest. Это не испытание блокировки на телефоне.
7. Lint: 0 ошибок, 31 предупреждение. Предупреждения касаются синхронной записи настроек, API-атрибута Accessibility, порядка manifest, новых версий зависимостей, ресурсов/иконок и локализации. Они не скрывались и не подавлялись.
8. В окончательной APK сверены SHA-256 всех 36 HTML/JS/CSS файлов с текущим frontend — совпадают.

Логи: `test-results/android-1.0.8-build-final.log`; отчёт Lint: `%LOCALAPPDATA%/DisbitBuilds/1.0.8/_app/reports/lint-results-release.html`.

## Не проверено

ADB не обнаружил устройства. Установка, обновление поверх установленной версии, запуск WebView, камера/галерея и нативная блокировка на настоящем Android в этом проходе не проверены. Совпадение подписи и повышение versionCode подтверждают условия для обновления прежней release-сборки, но не заменяют установку. Для debug APK с другим ключом обновление поверх неё может быть недоступно.

APK сохранена локально; на сервер и в магазины не загружалась. Изменения версии и ресурсов пока не закоммичены.
