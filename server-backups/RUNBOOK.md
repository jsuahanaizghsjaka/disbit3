# disbit — сервер: шпаргалка на случай проблем

Сервер: Timeweb Cloud, `disbit-prod`, IP `188.225.34.65`, домен `disbit.ru`.
Вход: `ssh -i ~/.ssh/disbit_timeweb_ed25519 deploy@188.225.34.65` (root по SSH закрыт).

## Сайт/API не отвечает

```bash
sudo systemctl status disbit.service    # жив ли бэкенд
sudo systemctl status caddy             # жив ли прокси/TLS
sudo journalctl -u disbit -n 50         # последние логи бэкенда
sudo journalctl -u caddy -n 50          # последние логи caddy
```

Перезапуск:
```bash
sudo systemctl restart disbit.service
sudo systemctl restart caddy
```

Оба сервиса в автозапуске (`enabled`) — сами поднимутся после перезагрузки сервера.

## Кончилась память / сервер тормозит

```bash
free -h                 # своп 2 ГБ должен быть активен
systemctl status disbit # MemoryMax=600M — процесс сам не должен положить систему
```

## Нужно восстановить данные из бэкапа

Бэкапы лежат:
- на сервере: `/srv/disbit/backups/` (хранятся 14 дней)
- локально (offsite): `disbit3/server-backups/` на этом компьютере (30 дней),
  забираются автоматически каждый день в 05:00 по задаче планировщика
  Windows `disbit-backup-pull`

Восстановление:
```bash
sudo systemctl stop disbit
TMP=$(mktemp -d)
tar xzf /srv/disbit/backups/disbit-ДАТА.tar.gz -C "$TMP"
sqlite3 "$TMP/disbit.db" "PRAGMA integrity_check;"   # должно быть "ok"
cp "$TMP/disbit.db" /srv/disbit/data/disbit.db
rsync -a "$TMP/proofs/" /srv/disbit/data/proofs/
rm -rf "$TMP"
sudo systemctl start disbit
```

## Обновить код (деплой)

С локальной машины:
```bash
tar czf /tmp/disbit-app.tar.gz --exclude='backend/node_modules' \
  --exclude='backend/db/*.db*' --exclude='.git' backend frontend
scp -i ~/.ssh/disbit_timeweb_ed25519 /tmp/disbit-app.tar.gz deploy@188.225.34.65:/srv/disbit/
```

На сервере:
```bash
cd /srv/disbit/app && tar xzf ../disbit-app.tar.gz
cd backend && npm ci --omit=dev
sudo systemctl restart disbit
```

## Домен переехал на другой сервер

1. В панели Timeweb (DNS-зона `disbit.ru`) поменять A-запись на новый IP.
2. На новом сервере поднять тот же `Caddyfile` — сертификат получится
   автоматически, домен уже привязан к аккаунту Let's Encrypt не был,
   так что лимитов можно не бояться.
3. **Важно:** в уже установленных APK старый адрес вшит в код — если
   меняется САМ ДОМЕН (не IP за ним), нужна новая сборка приложения.
   Смена IP за тем же доменом ничего не ломает.

## Почему это вообще важно

23 августа 2026 закончился пробный период на Railway (США), оплата
не прошла (карта РФ), сервис погас без предупреждения, боевые данные
(аккаунты, обещания, медиа-пруфы всех тестеров) были потеряны безвозвратно —
резервной копии не было. Отсюда правило: **бэкап и мониторинг настраиваются
до того, как на сервере появится хоть один настоящий пользователь**,
не после.
