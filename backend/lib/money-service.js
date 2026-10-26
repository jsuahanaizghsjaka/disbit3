import {
  openMoneyPayment, attachProviderPayment, confirmProviderPayment,
  reserveMoneyRefund, attachProviderRefund, confirmProviderRefund
} from './money-core.js';

// The public webhook must only pass an object ID. Every monetary decision is
// made from a fresh authenticated GET to the configured YooKassa shop.
export function createMoneyService(db, provider) {
  async function resumePayment(intentId, returnUrl) {
    const intent=db.prepare('SELECT * FROM money_payment_intents WHERE id=?').get(intentId);
    if (!intent) throw Error('Unknown payment intent');
    if (intent.status==='succeeded' || intent.status==='canceled') return { id:intent.id, status:intent.status };
    if (intent.provider_payment_id) {
      const remote=await provider.getPayment(intent.provider_payment_id);
      const result=confirmProviderPayment(db,remote);
      return { id:intent.id, providerId:intent.provider_payment_id, url:intent.confirmation_url, result };
    }
    const remote=await provider.createPayment({id:intent.id,amount:intent.amount,idempotencyKey:intent.idempotency_key},returnUrl);
    return attachProviderPayment(db,intent.id,remote);
  }
  async function startPayment(userId,amount,returnUrl) {
    const intent=openMoneyPayment(db,{userId,amount});
    return resumePayment(intent.id,returnUrl);
  }
  async function resumeRefundPart(partId) {
    const part=db.prepare(`SELECT r.*,p.provider_payment_id FROM money_refund_parts r
      JOIN money_payment_intents p ON p.id=r.payment_intent_id WHERE r.id=?`).get(partId);
    if (!part) throw Error('Unknown refund part');
    if (part.status==='succeeded' || part.status==='failed') return { id:part.id,status:part.status };
    if (part.provider_refund_id) return confirmProviderRefund(db,await provider.getRefund(part.provider_refund_id));
    const remote=await provider.createRefund({amount:part.amount,idempotencyKey:part.idempotency_key},part.provider_payment_id);
    attachProviderRefund(db,part.id,remote);
    return confirmProviderRefund(db,remote);
  }
  async function startRefund(userId,amount) {
    const request=reserveMoneyRefund(db,{userId,amount});
    const results=[];
    for(const part of request.parts) {
      try { results.push({ id:part.id,result:await resumeRefundPart(part.id) }); }
      catch { results.push({ id:part.id,pending:true }); } // keep reserved for safe retry/reconciliation
    }
    return { id:request.id,results };
  }
  async function receiveNotification(body) {
    if (body?.type!=='notification' || typeof body.event!=='string') return { ignored:true };
    const id=body.object?.id;
    if (typeof id!=='string' || !/^[a-zA-Z0-9-]{20,80}$/.test(id)) return { ignored:true };
    if (body.event.startsWith('payment.')) {
      if (!db.prepare('SELECT 1 FROM money_payment_intents WHERE provider_payment_id=?').get(id)) return { ignored:true };
      return confirmProviderPayment(db,await provider.getPayment(id));
    }
    if (body.event.startsWith('refund.')) {
      if (!db.prepare('SELECT 1 FROM money_refund_parts WHERE provider_refund_id=?').get(id)) return { ignored:true };
      return confirmProviderRefund(db,await provider.getRefund(id));
    }
    return { ignored:true };
  }
  // Retry uses the SAME provider idempotency keys. Unknown outcomes stay
  // pending rather than creating a second payment/refund or releasing funds.
  async function reconcile(returnUrl) {
    const results=[];
    for(const intent of db.prepare("SELECT id FROM money_payment_intents WHERE status IN ('created','pending')").all()) {
      try { results.push({ type:'payment',id:intent.id,result:await resumePayment(intent.id,returnUrl) }); }
      catch { results.push({ type:'payment',id:intent.id,pending:true }); }
    }
    for(const part of db.prepare("SELECT id FROM money_refund_parts WHERE status IN ('reserved','pending')").all()) {
      try { results.push({ type:'refund',id:part.id,result:await resumeRefundPart(part.id) }); }
      catch { results.push({ type:'refund',id:part.id,pending:true }); }
    }
    return results;
  }
  return { startPayment,resumePayment,startRefund,resumeRefundPart,receiveNotification,reconcile };
}
