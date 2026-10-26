// Closed integration: do not import this into a public route until the Disbit
// merchant contract, receipt requirements, and release switch are approved.
const BASE = 'https://api.yookassa.ru/v3';

export function createYooKassaClient({ shopId, secretKey, request = fetch }) {
  if (!shopId || !secretKey) throw Error('Disbit YooKassa credentials are required');
  const authorization = `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString('base64')}`;
  async function call(method, path, { idempotencyKey, body } = {}) {
    const response = await request(BASE + path, {
      method,
      headers: {
        Authorization: authorization,
        ...(body ? { 'Content-Type':'application/json' } : {}),
        ...(idempotencyKey ? { 'Idempotence-Key': idempotencyKey } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12000)
    });
    // Provider response may contain personal/payment data; never log its body.
    if (!response.ok) throw Error(`YooKassa ${method} ${path.split('/')[1]} returned HTTP ${response.status}`);
    return response.json();
  }
  const rub = amount => (amount / 100).toFixed(2);
  return {
    createPayment(intent, returnUrl) {
      if (!/^https:\/\//.test(returnUrl)) throw Error('HTTPS return URL required');
      return call('POST','/payments',{
        idempotencyKey:intent.idempotencyKey,
        body:{
          amount:{ value:rub(intent.amount), currency:'RUB' },
          capture:true,
          confirmation:{ type:'redirect', return_url:returnUrl },
          description:`Пополнение Disbit №${intent.id.slice(0,12)}`,
          metadata:{ disbit_intent:intent.id }
        }
      });
    },
    getPayment(providerId) {
      if (!/^[a-zA-Z0-9-]{20,80}$/.test(providerId)) throw Error('Invalid payment ID');
      return call('GET',`/payments/${providerId}`);
    },
    createRefund(part, providerPaymentId) {
      if (!/^[a-zA-Z0-9-]{20,80}$/.test(providerPaymentId)) throw Error('Invalid payment ID');
      return call('POST','/refunds',{
        idempotencyKey:part.idempotencyKey,
        body:{ payment_id:providerPaymentId, amount:{ value:rub(part.amount), currency:'RUB' } }
      });
    },
    getRefund(providerId) {
      if (!/^[a-zA-Z0-9-]{20,80}$/.test(providerId)) throw Error('Invalid refund ID');
      return call('GET',`/refunds/${providerId}`);
    }
  };
}
