/* ============================================================
   Эндпоинты привычек.
   ВНИМАНИЕ: пока это временное хранилище в памяти (массив).
   После подключения БД заменить тело функций на запросы к базе
   (см. db/schema.sql и db/db.js). Структура объекта привычки
   совпадает с фронтендом (frontend/script.js).
   ============================================================ */

import { Router } from 'express';

const router = Router();

// временное хранилище (сбрасывается при перезапуске сервера)
let habits = [];

// GET /api/habits — список всех привычек
router.get('/', (req, res) => {
  res.json(habits);
});

// POST /api/habits — создать привычку
router.post('/', (req, res) => {
  const habit = {
    id: 'h' + Date.now(),
    counts: {},
    history: {},
    ...req.body
  };
  habits.push(habit);
  res.status(201).json(habit);
});

// PUT /api/habits/:id — обновить привычку (прогресс не трогаем)
router.put('/:id', (req, res) => {
  const h = habits.find(x => x.id === req.params.id);
  if (!h) return res.status(404).json({ error: 'Привычка не найдена' });
  Object.assign(h, req.body, { id: h.id });   // id менять нельзя
  res.json(h);
});

// DELETE /api/habits/:id — удалить привычку
router.delete('/:id', (req, res) => {
  habits = habits.filter(x => x.id !== req.params.id);
  res.status(204).end();
});

export default router;
