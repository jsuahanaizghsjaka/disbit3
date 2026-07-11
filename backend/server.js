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

// раздаём фронтенд статикой (http://localhost:3000 → приложение)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`disbit backend запущен: http://localhost:${PORT}`);
});
