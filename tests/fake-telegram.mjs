// Поддельный Bot API для тестов (по образцу fake-yookassa.mjs). Запоминает вызовы и умеет отвечать ошибками.
import http from 'node:http';

export async function startFakeTelegram() {
  const calls = [];
  const queue = [];      // { method, response } — одноразовые ответы на ближайший вызов метода
  let messageId = 100;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const match = /^\/bot([^/]+)\/(\w+)$/.exec(req.url);
      const method = match?.[2] || 'unknown';
      let params = {};
      try { params = JSON.parse(body || '{}'); } catch {}
      calls.push({ method, params, token: match?.[1] });
      const index = queue.findIndex(item => item.method === method);
      const reply = index >= 0 ? queue.splice(index, 1)[0].response
        : { ok: true, result: method === 'sendMessage' ? { message_id: ++messageId } : true };
      res.writeHead(reply.http || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply.body ?? reply));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    calls,
    failNext: (method, response) => queue.push({ method, response }),
    sent: () => calls.filter(c => c.method === 'sendMessage'),
    clear: () => { calls.length = 0; queue.length = 0; },
    close: () => new Promise(resolve => server.close(resolve))
  };
}
