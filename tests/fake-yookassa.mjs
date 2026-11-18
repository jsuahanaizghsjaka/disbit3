// Test-only stand-in for api.yookassa.ru, loaded with --import into a local
// server. State lives in FAKE_YOOKASSA_STATE so the test can play the bank.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const file = process.env.FAKE_YOOKASSA_STATE;
if (!file) throw Error('FAKE_YOOKASSA_STATE is required');
const load = () => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { payments: {}, refunds: {}, keys: {}, calls: [] };
const store = state => writeFileSync(file, JSON.stringify(state));
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const target = new URL(String(url));
  if (target.hostname !== 'api.yookassa.ru') return realFetch(url, options);
  const state = load();
  const method = options.method || 'GET';
  state.calls.push(`${method} ${target.pathname}`);
  if (!String(options.headers?.Authorization || '').startsWith('Basic ')) return reply(401, { type: 'error' });
  const key = options.headers?.['Idempotence-Key'];
  if (method === 'POST' && key && state.keys[key]) { store(state); return reply(200, state.keys[key]); }
  let result;
  const [, , kind, id] = target.pathname.split('/');
  if (method === 'POST' && kind === 'payments') {
    const body = JSON.parse(options.body);
    const paymentId = randomUUID();
    result = { id: paymentId, status: 'pending', paid: false, test: false, amount: body.amount,
      metadata: body.metadata, description: body.description,
      confirmation: { type: 'redirect', confirmation_url: `https://yoomoney.ru/checkout/payments/v2/contract?orderId=${paymentId}` } };
    state.payments[paymentId] = result;
  } else if (method === 'GET' && kind === 'payments') {
    result = state.payments[id];
  } else if (method === 'POST' && kind === 'refunds') {
    const body = JSON.parse(options.body);
    const payment = state.payments[body.payment_id];
    if (!payment || payment.status !== 'succeeded') { store(state); return reply(400, { type: 'error' }); }
    result = { id: randomUUID(), payment_id: body.payment_id, status: process.env.FAKE_REFUND_STATUS || 'succeeded', amount: body.amount };
    state.refunds[result.id] = result;
  } else if (method === 'GET' && kind === 'refunds') {
    result = state.refunds[id];
  }
  if (!result) { store(state); return reply(404, { type: 'error' }); }
  if (method === 'POST' && key) state.keys[key] = result;
  store(state);
  return reply(200, result);
};
