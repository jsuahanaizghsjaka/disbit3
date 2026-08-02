/* ============================================================
   ИИ-ассистент «Всевидящее око» — прокси к Groq.

   Ключ живёт ТОЛЬКО здесь (GROQ_API_KEY в переменных Railway): если бы фронт
   ходил в Groq напрямую, ключ утёк бы из кода страницы и квоту потратили бы чужие.

   Клиент присылает вопрос и СВОДКУ своих данных (привычки, серии, штрафы) —
   сервер её не хранит и никуда не пишет, только передаёт модели в контексте.
   ============================================================ */

import { Router } from 'express';
import express from 'express';

const router = Router();

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const MAX_QUESTION = 500;
const RATE_LIMIT = 20;                 // запросов в час на пользователя
const RATE_WINDOW_MS = 60 * 60 * 1000;

// простой лимит в памяти: бесплатная квота Groq не бесконечна
const hits = new Map();
function rateLimited(key) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_LIMIT) { hits.set(key, arr); return true; }
  arr.push(now);
  hits.set(key, arr);
  return false;
}

const SYSTEM_PROMPT = `Ты — «Всевидящее око» в приложении disbit (трекер привычек со штрафом за пропуск).
Ты видишь всю статистику пользователя и говоришь по делу.

Как отвечать:
— по-русски, на «ты», коротко: 2–5 предложений, без воды и списков-простыней;
— опирайся на ЦИФРЫ из данных: серии, проценты, пропуски, штрафы;
— замечай закономерности (какой день недели проваливается, какая привычка тянет вниз);
— один конкретный совет в конце, выполнимый завтра;
— если данных мало — так и скажи, не выдумывай;
— не морализируй и не стыди. Ты спокойный наблюдатель, который видит всё.

Про механики disbit, если спросят: грейс-день (один пропуск серию не рвёт),
минимум (маленький шаг вместо полного — серия жива), марафон (привычки двигают
путника к большой цели), штраф за пропуск — деньги на благотворительность или
блокировка приложений (в этой версии симуляция).`;

router.post('/ask', express.json({ limit: '256kb' }), async (req, res) => {
  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({ error: 'ИИ пока не подключён: нет ключа GROQ_API_KEY на сервере' });
  }
  const key = req.userId ? 'u' + req.userId : 'ip' + (req.ip || 'x');
  if (rateLimited(key)) {
    return res.status(429).json({ error: 'Слишком много вопросов подряд — попробуй через час' });
  }

  const question = String(req.body?.question || '').slice(0, MAX_QUESTION).trim();
  const summary = req.body?.summary;
  if (!question) return res.status(400).json({ error: 'Пустой вопрос' });

  const context = summary && typeof summary === 'object'
    ? 'Данные пользователя (JSON):\n' + JSON.stringify(summary).slice(0, 6000)
    : 'Данных пользователя нет.';

  try {
    const r = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.6,
        max_tokens: 500,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'system', content: context },
          { role: 'user', content: question }
        ]
      })
    });

    if (!r.ok) {
      const text = (await r.text()).slice(0, 300);
      console.error('[ai] groq', r.status, text);
      if (r.status === 401) return res.status(502).json({ error: 'Ключ Groq не принят — проверь GROQ_API_KEY' });
      if (r.status === 429) return res.status(429).json({ error: 'Groq перегружен или квота исчерпана' });
      if (r.status === 404) return res.status(502).json({ error: `Модель ${MODEL} недоступна — задай GROQ_MODEL` });
      return res.status(502).json({ error: 'ИИ не ответил, попробуй ещё раз' });
    }

    const data = await r.json();
    const answer = data?.choices?.[0]?.message?.content?.trim();
    if (!answer) return res.status(502).json({ error: 'Пустой ответ от ИИ' });
    res.json({ answer, model: MODEL });
  } catch (e) {
    console.error('[ai]', e.message);
    res.status(502).json({ error: 'Не удалось связаться с ИИ' });
  }
});

// есть ли ключ — фронт по этому решает, показывать ли око
router.get('/status', (req, res) => {
  res.json({ enabled: !!process.env.GROQ_API_KEY, model: MODEL });
});

export default router;
