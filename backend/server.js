/* ============================================================
   disbit — бэкенд (каркас)
   Пока сервер хранит данные в памяти. База данных подключается
   позже — схема уже описана в db/schema.sql.
   Запуск:  npm install  &&  npm start   (по умолчанию порт 3000)
   ============================================================ */

import express from 'express';
import cors from 'cors';
import habitsRouter from './routes/habits.js';

const app = express();

app.use(cors());            // чтобы фронтенд с другого порта мог обращаться
app.use(express.json());    // парсинг JSON в теле запросов

// проверка, что сервер жив
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'disbit-backend' });
});

// эндпоинты привычек
app.use('/api/habits', habitsRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`disbit backend запущен: http://localhost:${PORT}`);
});
