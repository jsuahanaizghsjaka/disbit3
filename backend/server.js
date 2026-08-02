/* ============================================================
   disbit — бэкенд
   Данные хранятся в SQLite (встроенный node:sqlite, файл
   db/disbit.db создаётся автоматически). Требуется Node ≥ 22.13.
   Сервер также раздаёт фронтенд: открой http://localhost:3000 —
   и приложение будет синхронизироваться с базой.
   Запуск:  npm install  &&  npm start   (по умолчанию порт 3000)
   ============================================================ */

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
import walletRouter from './routes/wallet.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());                    // чтобы фронтенд с другого порта мог обращаться
app.use(express.json({ limit: '1mb' }));
app.use(authMiddleware);            // Authorization: Bearer → req.userId

// проверка, что сервер жив
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'disbit-backend', storage: 'sqlite', auth: true });
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

// чистый URL для политики конфиденциальности (нужен сторам): /privacy
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'privacy.html'));
});
// панель проверки пруфов (только для админа — вход по ключу внутри страницы)
app.get('/review', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'review.html'));
});

// раздаём фронтенд статикой (http://localhost:3000 → приложение)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`disbit backend запущен: http://localhost:${PORT}`);
});
