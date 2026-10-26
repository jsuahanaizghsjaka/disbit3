import { randomUUID } from 'node:crypto';

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tx(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try { const value = work(); db.exec('COMMIT'); return value; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function sandboxConfig(env = process.env) {
  if (env.YOOKASSA_TEST_ENABLED !== '1') return { enabled: false };
  const shopId = String(env.YOOKASSA_TEST_SHOP_ID || '');
  const secretKey = String(env.YOOKASSA_TEST_SECRET_KEY || '');
  if (!/^\d{5,12}$/.test(shopId) || !secretKey.startsWith('test_') || secretKey.length < 24)
    throw Error('Test-shop configuration requires shop ID and test key');
  let returnUrl;
  try { returnUrl = new URL(env.PUBLIC_URL); } catch { throw Error('Test shop needs an HTTPS PUBLIC_URL'); }
  if (returnUrl.protocol !== 'https:' || !returnUrl.hostname || returnUrl.username || returnUrl.password ||
      returnUrl.pathname !== '/' || returnUrl.search || returnUrl.hash)
    throw Error('Test shop needs an HTTPS PUBLIC_URL origin');
  return { enabled: true, shopId, secretKey };
}

export function sandboxAllowed(db, userId, config) {
  if (!config.enabled) return false;
  return !!db.prepare('SELECT 1 FROM users WHERE id=?').get(userId);
}

function moneyFromProvider(value) {
  if (typeof value !== 'string' || !/^\d+\.\d{2}$/.test(value)) throw Error('Invalid provider amount');
  const [rub, kop] = value.split('.');
  const amount = Number(rub) * 100 + Number(kop);
  if (!Number.isSafeInteger(amount)) throw Error('Provider amount overflow');
  return amount;
}

function matches(payment, intent, shopId) {
  return payment?.test === true && typeof payment.id === 'string' &&
    payment.amount?.currency === 'RUB' && moneyFromProvider(payment.amount.value) === intent.amount &&
    payment.metadata?.disbit_intent === intent.id &&
    String(payment.recipient?.account_id || '') === shopId;
}

function publicIntent(intent) {
  return { id: intent.id, providerId: intent.provider_payment_id, status: intent.status,
    url: intent.confirmation_url, amount: intent.amount };
}

export function sandboxSnapshot(db, userId) {
  const balance = db.prepare('SELECT balance FROM sandbox_accounts WHERE user_id=?').get(userId)?.balance || 0;
  const history = db.prepare(`SELECT i.id,i.amount,i.status,i.provider_payment_id,i.created_at,l.balance_after
    FROM sandbox_payment_intents i LEFT JOIN sandbox_ledger l ON l.source_key='sandbox-topup:'||i.id
    WHERE i.user_id=? ORDER BY i.created_at DESC,i.id DESC LIMIT 30`).all(userId)
    .map(row => ({ id: row.id, type: 'topup', amount: row.amount, status: row.status,
      provider_id: row.provider_payment_id, created_at: row.created_at, balance_after: row.balance_after,
      provider: 'yookassa-test', meta: { test: true } }));
  return { available: true, simulated: true, balance, currency: 'RUB', history };
}

export function openSandboxIntent(db, { userId, amount, requestId }) {
  if (!Number.isSafeInteger(amount) || amount < 5000 || amount > 5000000) throw Error('Invalid test topup amount');
  if (!REQUEST_ID.test(requestId || '')) throw Error('Invalid request ID');
  return tx(db, () => {
    const existing = db.prepare('SELECT * FROM sandbox_payment_intents WHERE user_id=? AND request_id=?').get(userId,requestId);
    if (existing) {
      if (existing.amount !== amount) throw Error('Request ID already used for another amount');
      return existing;
    }
    const id = randomUUID();
    db.prepare(`INSERT INTO sandbox_payment_intents(id,user_id,request_id,amount,idempotency_key)
      VALUES (?,?,?,?,?)`).run(id,userId,requestId,amount,`sandbox-topup-${id}`);
    return db.prepare('SELECT * FROM sandbox_payment_intents WHERE id=?').get(id);
  });
}

export function attachSandboxPayment(db, intentId, payment, shopId) {
  return tx(db, () => {
    const intent = db.prepare('SELECT * FROM sandbox_payment_intents WHERE id=?').get(intentId);
    if (!intent || !matches(payment,intent,shopId)) throw Error('Test payment does not match intent/shop');
    let confirmationUrl = null;
    if (payment.confirmation?.confirmation_url) {
      try {
        const url = new URL(payment.confirmation.confirmation_url);
        if (url.protocol !== 'https:' || url.username || url.password) throw Error();
        confirmationUrl = url.href;
      } catch { throw Error('Invalid test confirmation URL'); }
    }
    if (payment.status === 'pending' && !confirmationUrl) throw Error('Test payment has no confirmation URL');
    if (intent.provider_payment_id && intent.provider_payment_id !== payment.id) throw Error('Intent already bound');
    if (intent.status === 'succeeded' || intent.status === 'canceled') return publicIntent(intent);
    db.prepare(`UPDATE sandbox_payment_intents SET provider_payment_id=?,status='pending',confirmation_url=? WHERE id=?`)
      .run(payment.id,confirmationUrl,intentId);
    return publicIntent(db.prepare('SELECT * FROM sandbox_payment_intents WHERE id=?').get(intentId));
  });
}

// Pass only a fresh object read with the test shop's authenticated GET API.
export function confirmSandboxPayment(db, payment, shopId) {
  return tx(db, () => {
    const intent = db.prepare('SELECT * FROM sandbox_payment_intents WHERE provider_payment_id=?').get(payment?.id);
    if (!intent) return { ignored: true };
    if (!matches(payment,intent,shopId)) throw Error('Verified test payment mismatch');
    if (intent.status === 'succeeded') return { ...publicIntent(intent), duplicate: true };
    if (payment.status === 'canceled') {
      db.prepare("UPDATE sandbox_payment_intents SET status='canceled' WHERE id=?").run(intent.id);
      return { ...publicIntent(intent), status: 'canceled' };
    }
    if (payment.status !== 'succeeded' || payment.paid !== true) return { ...publicIntent(intent), status: 'pending' };
    if (intent.status === 'canceled') throw Error('Canceled intent cannot be credited');
    db.prepare('INSERT OR IGNORE INTO sandbox_accounts(user_id) VALUES (?)').run(intent.user_id);
    const current = db.prepare('SELECT balance FROM sandbox_accounts WHERE user_id=?').get(intent.user_id).balance;
    const next = current + intent.amount;
    if (!Number.isSafeInteger(next)) throw Error('Test balance overflow');
    db.prepare('UPDATE sandbox_accounts SET balance=? WHERE user_id=?').run(next,intent.user_id);
    db.prepare(`INSERT INTO sandbox_ledger(user_id,source_key,amount,balance_after,provider_payment_id)
      VALUES (?,?,?,?,?)`).run(intent.user_id,`sandbox-topup:${intent.id}`,intent.amount,next,payment.id);
    db.prepare("UPDATE sandbox_payment_intents SET status='succeeded' WHERE id=?").run(intent.id);
    return { ...publicIntent(intent), status: 'succeeded', balance: next };
  });
}

export function createSandboxService(db, provider, shopId) {
  async function refresh(intent) {
    if (!intent.provider_payment_id || ['succeeded','canceled'].includes(intent.status)) return publicIntent(intent);
    return confirmSandboxPayment(db,await provider.getPayment(intent.provider_payment_id),shopId);
  }
  async function start(userId, amount, requestId, returnUrl) {
    const intent = openSandboxIntent(db,{userId,amount,requestId});
    if (intent.provider_payment_id) return refresh(intent);
    const payment = await provider.createPayment({
      id:intent.id, amount:intent.amount, idempotencyKey:intent.idempotency_key
    },returnUrl);
    return attachSandboxPayment(db,intent.id,payment,shopId);
  }
  async function status(userId, intentId) {
    const intent = db.prepare('SELECT * FROM sandbox_payment_intents WHERE id=? AND user_id=?').get(intentId,userId);
    if (!intent) return null;
    return refresh(intent);
  }
  async function notification(body) {
    if (body?.type !== 'notification' || !/^payment\./.test(body.event || '')) return { ignored:true };
    const id = body.object?.id;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(id)) return { ignored:true };
    if (!db.prepare('SELECT 1 FROM sandbox_payment_intents WHERE provider_payment_id=?').get(id)) return { ignored:true };
    return confirmSandboxPayment(db,await provider.getPayment(id),shopId);
  }
  return { start,status,notification };
}
