# Публикация preview блокировок — 15 ноября 2026

Опубликованный код: 6c23997. Ветка: phase0-stabilization.
Production: /srv/disbit/releases/6c23997; staging: /srv/disbit-staging/releases/6c23997.

Проверено после публикации:
- Внешний HTTPS GET https://disbit.ru/api/ready: 200, ok:true, release:6c23997.
- GET /api/blocking/plan без сессии: 401 (staging и production).
- На обоих серверах прошли тесты фото/короткого видео, отклонения длинного видео, приватности, одобрения модератором, экспорта и удаления тестового аккаунта.
- На обоих серверах прошли жалоба, ограничение, изолированные уведомления, обжалование, снятие ограничения и восстановление возможности дружбы. Синтетические аккаунты удалены.
- disbit и disbit-monitor.timer active.
- Перед публикацией: 70 Node-тестов, 2 JVM-теста; debug-приложение и инструментальный APK собраны.

Резервная копия production: /srv/disbit/backups/pre-blocking-preview-20261115T095629Z.
Проверка восстановления в отдельную папку: тот же путь с суффиксом -restored; 12 файлов, erased:0.
Staging: /srv/disbit-staging/backups/pre-blocking-preview-20261115T095539Z, восстановление проверено.
Данные рабочего приложения не заменялись копией.

Первая попытка staging откатилась: старый RELEASE_SHA из EnvironmentFile перекрывал Environment в drop-in. Исправлено отдельным последним EnvironmentFile. Повторная публикация прошла.

Откат кода production (root, база и медиа остаются текущими):
```sh
systemctl stop disbit
ln -sfn /srv/disbit/releases/acf1e8e /srv/disbit/current
rm -f /etc/systemd/system/disbit.service.d/zzzzzzz-blocking-preview.conf
systemctl daemon-reload
systemctl start disbit
curl --fail http://127.0.0.1:3000/api/ready
```

Ограничения выпуска: автоматическая блокировка выключена; API только preview. Новый APK на телефоны не установлен; устройства недоступны. Это не завершение фазы 3.1 и не публикация в магазины.

Свободное место после публикации: около 1,5 ГБ, 90% диска. Расширение/обслуживание диска остаётся отдельной эксплуатационной задачей; резервные копии ради этого выпуска не удалялись.
