// Money limits from the public offer (frontend/terms.html, sections 5–6).
// All values are integer kopecks. Change them only together with the offer text.
export const TOPUP_MIN = 100;           // 1 ₽ per top-up
export const TOPUP_MAX = 1_000_000;     // 10 000 ₽ per top-up
export const BALANCE_MAX = 10_000_000;  // 100 000 ₽ total security deposit
export const PAYMENT_FEE_PERMILLE = 28; // 2.8 % payment service fee, paid on top
export const SERVICE_FEE_PERMILLE = 10; // 1 % service fee for the operation, paid on top

const part = (amount, permille) => Math.ceil(amount * permille / 1000);

// The deposit is credited in full; the fees are added on top and are not refunded.
export function topupQuote(amount) {
  const paymentFee = part(amount, PAYMENT_FEE_PERMILLE), serviceFee = part(amount, SERVICE_FEE_PERMILLE);
  return { amount, paymentFee, serviceFee, fee: paymentFee + serviceFee, total: amount + paymentFee + serviceFee };
}

// pending = sum of not yet settled top-ups of the same user.
export function topupProblem(amount, balance = 0, pending = 0) {
  if (!Number.isSafeInteger(amount) || amount < TOPUP_MIN || amount > TOPUP_MAX) {
    return { code: 'amount_range', error: 'Сумма пополнения — от 1 до 10 000 ₽' };
  }
  if (balance + pending + amount > BALANCE_MAX) {
    const left = Math.max(0, BALANCE_MAX - balance - pending);
    return { code: 'balance_limit', error: `Депозит не может превышать 100 000 ₽. Можно пополнить ещё на ${Math.floor(left / 100)} ₽`, left };
  }
  return null;
}
