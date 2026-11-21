/* ============================================================
   disbit — бэкенд
   Данные хранятся в SQLite (встроенный node:sqlite, файл
   db/disbit.db создаётся автоматически). Требуется Node ≥ 22.13.
   Сервер также раздаёт фронтенд: открой http://localhost:3000 —
   и приложение будет синхронизироваться с базой.
   Запуск:  npm install  &&  npm start   (по умолчанию порт 3000)
   ============================================================ */

import { runtime } from './lib/runtime.js';
import { db } from './db/db.js';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import habitsRouter from './routes/habits.js';
import chargesRouter from './routes/charges.js';
import authRouter, { authMiddleware } from './routes/auth.js';
import stateRouter from './routes/state.js';
import proofsRouter from './routes/proofs.js';
import friendsRouter from './routes/friends.js';
import invitesRouter from './routes/invites.js';
import aiRouter from './routes/ai.js';
import walletRouter, { moneyService, moneyReturnUrl } from './routes/wallet.js';
import { settleClosedMoneyDays } from './lib/money-settlement.js';
import accountRouter from './routes/account.js';
import moderationRouter from './routes/moderation.js';
import blockingRouter from './routes/blocking.js';
import {enforceModeration} from './lib/moderation.js';
import {securityHeaders,corsOrigin} from './lib/http-security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
// Caddy connects locally; never trust forwarding headers from public peers.
app.set('trust proxy', 'loopback');

app.use(securityHeaders);
app.use(cors({origin:corsOrigin}));
app.use(express.json({ limit: '1mb' }));
app.use((req,res,next)=>{
  const invalid=value=>value&&typeof value==='object'&&(Object.keys(value).some(k=>['__proto__','constructor','prototype','toString','valueOf'].includes(k))||Object.values(value).some(invalid));
  if(invalid(req.body))return res.status(400).json({error:'Некорректные поля запроса'});
  next();
});
app.use(authMiddleware);            // Authorization: Bearer → req.userId
app.use(enforceModeration);

// проверка, что сервер жив
app.get('/api/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, service: 'disbit-backend', storage: 'sqlite', auth: true,
    environment: runtime.name, release: runtime.release, apiVersion: 1,
    capabilities: { proofRequired: true, proofSkipsPerMonth: 5, pastDaysReadOnly: true, livePayments: runtime.provider === 'yookassa' } });
});

app.get('/api/ready', (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { db.prepare('SELECT 1 FROM users LIMIT 1').get(); res.json({ ok: true, release: runtime.release }); }
  catch { res.status(503).json({ ok: false }); }
});

// эндпоинты
app.use('/api/auth', authRouter);
app.use('/api/habits', habitsRouter);
app.use('/api/charges', chargesRouter);
app.use('/api/state', stateRouter);
app.use('/api/proofs', proofsRouter);
app.use('/api/friends', friendsRouter);
app.use('/api/invites', invitesRouter);
app.use('/api/ai', aiRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/account', accountRouter);
app.use('/api/moderation', moderationRouter);
app.use('/api/blocking', blockingRouter);

/* Неизвестный /api/* НЕ должен проваливаться в статику ниже: опечатка в адресе
   отдавала index.html со статусом 200, apiCall() спотыкался на JSON.parse и
   возвращал null — сбой выглядел как «сервер ответил, данных нет». */
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Неизвестный эндпоинт: ' + req.method + ' /api' + req.path });
});

/* Android App Links: приложение (io.disbit.app) перехватывает только ссылки
   /invite — оплата, Google-вход и остальные страницы сайта открываются в браузере.
   Отпечаток — сертификат подписи релизных APK (ops/VERSIONS.md). Если сборки
   переподписывает Google Play, его отпечаток добавляется через
   ANDROID_CERT_SHA256 (через запятую). */
const ANDROID_CERTS = ['7e95ad23adccf196a54aa73ab1a192f97a1f54c699d6932802945e544befd701',
  ...String(process.env.ANDROID_CERT_SHA256 || '').split(',')]
  .map(v => v.replace(/[^0-9a-f]/gi, '').toUpperCase()).filter(v => v.length === 64)
  .map(v => v.match(/../g).join(':'));
app.get('/.well-known/assetlinks.json', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600').json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: 'io.disbit.app', sha256_cert_fingerprints: [...new Set(ANDROID_CERTS)] }
  }]);
});
// ссылка-приглашение: без приложения — в веб-версию с теми же параметрами
app.get('/invite', (req, res) => {
  const q = new URLSearchParams();
  for (const k of ['add', 't', 'join']) if (typeof req.query[k] === 'string' && req.query[k].length <= 64) q.set(k, req.query[k]);
  res.redirect(302, '/' + (q.size ? '?' + q : ''));
});

// чистый URL для политики конфиденциальности (нужен сторам): /privacy
app.get('/support', (_req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'support.html')));
app.get('/safety', (_req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'safety.html')));
app.get('/delete-account', (_req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'delete-account.html')));
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'privacy.html'));
});
// панель проверки пруфов (только для админа — вход по ключу внутри страницы)
app.get('/review', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'review.html'));
});

// раздаём фронтенд статикой (http://localhost:3000 → приложение)
// Шрифты и иконки не меняются между релизами — не перепроверяем их на каждый запуск.
// HTML/JS/CSS остаются с ETag-перепроверкой: имена файлов без хэшей.
app.use(express.static(path.join(__dirname, '..', 'frontend'), {
  setHeaders(res, file) {
    if (/\.woff2$/.test(file)) res.set('Cache-Control', 'public, max-age=2592000');
    else if (/[\\/]icons[\\/]/.test(file)) res.set('Cache-Control', 'public, max-age=604800');
  }
}));

/* Ошибки парсинга тела и неожиданные исключения: без этого Express отдавал
   HTML-страницу (в development — со стеком), а клиент ждёт JSON с полем error. */
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error('[request] internal error');
  const error = err.type === 'entity.too.large' ? 'Слишком большой запрос'
    : err.type === 'entity.parse.failed' ? 'Некорректный JSON в запросе'
    : status >= 500 ? 'Внутренняя ошибка сервера' : 'Некорректный запрос';
  res.status(status).json({ error });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, process.env.HOST || '127.0.0.1', () => {
  console.log(`disbit backend запущен: http://localhost:${PORT}`);
});
/* Live deposit jobs: penalties for closed days of accepted money conditions,
   then a retry of open payments/refunds with the same idempotency keys. */
if (moneyService) {
  let busy = false;
  const moneyJobs = async () => {
    if (busy) return;
    busy = true;
    try {
      const penalties = settleClosedMoneyDays(db).filter(r => r.status);
      if (penalties.length) console.log(`[money] penalties settled: ${penalties.length}`);
      await moneyService.reconcile(moneyReturnUrl);
    } catch (error) { console.error('[money] jobs failed:', error.message); }
    finally { busy = false; }
  };
  setTimeout(moneyJobs, 30000).unref();
  setInterval(moneyJobs, 10 * 60000).unref();
}

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
