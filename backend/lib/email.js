/* ============================================================
   Почта: строгая валидация + отправка кода подтверждения.

   Валидация в два уровня:
   1. Формат (строгая регулярка — не пускает a@b.c, двойные точки и пр.)
   2. MX-запись домена через DNS — реально ли домен принимает почту.
      Именно это отсекает «@gmail.fdkjfsk»: регуляркой такое не поймать.

   Отправка — через транзакционный сервис по HTTP, без SDK.
   По умолчанию Resend (MAIL_PROVIDER=resend). Содержимое писем и коды
   никогда не печатаются в журнал, включая локальную разработку.
   ============================================================ */

import dns from 'node:dns';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { runtime } from './runtime.js';

const resolver = new dns.promises.Resolver();
resolver.setServers(['1.1.1.1', '8.8.8.8']);   // не зависим от DNS хостинга

// локальная часть: буквы/цифры/._%+- ; домен: метки через точку; TLD 2–24 буквы
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}$/;

export function isEmailFormatValid(email) {
  if (!email || email.length > 254) return false;
  if (email.includes('..')) return false;                 // две точки подряд
  const [local] = email.split('@');
  if (!local || local.length > 64) return false;
  if (local.startsWith('.') || local.endsWith('.')) return false;
  return EMAIL_RE.test(email);
}

// принимает ли домен почту (есть MX или хотя бы A-запись)
export async function domainAcceptsMail(email) {
  const domain = String(email).split('@')[1];
  if (!domain) return false;
  try {
    const mx = await resolver.resolveMx(domain);
    if (mx && mx.length) return true;
  } catch { /* MX нет — пробуем A ниже */ }
  try {
    const a = await resolver.resolve4(domain);
    return !!(a && a.length);
  } catch { return false; }
}

/* ---------- отправка ---------- */
const PROVIDER = (process.env.MAIL_PROVIDER || 'resend').toLowerCase();
const FROM = process.env.MAIL_FROM || 'disbit <onboarding@resend.dev>';

export function mailConfigured() {
  if (PROVIDER === 'timeweb') {
    return isEmailFormatValid(process.env.MAIL_FROM || '') &&
      process.env.TIMEWEB_SMTP_USER === process.env.MAIL_FROM && !!process.env.TIMEWEB_SMTP_PASSWORD;
  }
  if (PROVIDER === 'rusender') {
    return !!process.env.RUSENDER_API_TOKEN && /^\d+$/.test(process.env.RUSENDER_KEY_ID || '') &&
      isEmailFormatValid(process.env.MAIL_FROM || '');
  }
  if (process.env.POSTMARK_TOKEN && PROVIDER !== 'sendgrid') return true;
  if (process.env.SENDGRID_API_KEY && PROVIDER === 'sendgrid') return true;
  return !!process.env.RESEND_API_KEY;
}

async function sendViaRusender(to, subject, html) {
  const response = await fetch(`https://api.rusender.ru/api/v1/external-mails/send/${process.env.RUSENDER_KEY_ID}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RUSENDER_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ idempotencyKey: randomUUID(), mail: {
      to: { email: to }, from: { email: process.env.MAIL_FROM, name: 'Disbit' }, subject, html
    }}),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`RuSender: HTTP ${response.status}`);
}

async function sendViaResend(to, subject, html) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: FROM, to: [to], subject, html })
  });
  if (!r.ok) throw new Error('Resend: ' + r.status + ' ' + (await r.text()).slice(0, 200));
}

async function sendViaPostmark(to, subject, html) {
  const r = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'X-Postmark-Server-Token': process.env.POSTMARK_TOKEN,
      'Content-Type': 'application/json', Accept: 'application/json'
    },
    body: JSON.stringify({ From: FROM, To: to, Subject: subject, HtmlBody: html })
  });
  if (!r.ok) throw new Error('Postmark: ' + r.status + ' ' + (await r.text()).slice(0, 200));
}

async function sendViaSendgrid(to, subject, html) {
  const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: (FROM.match(/<(.+)>/) || [, FROM])[1] },
      subject,
      content: [{ type: 'text/html', value: html }]
    })
  });
  if (!r.ok) throw new Error('SendGrid: ' + r.status + ' ' + (await r.text()).slice(0, 200));
}

export async function sendMail(to, subject, html) {
  if (!mailConfigured()) {
    if (runtime.hosted) throw new Error('Mail provider is not configured');
    console.info('[mail] delivery disabled: no provider configured');
    return { sent: false, dev: true };
  }
  if (PROVIDER === 'timeweb') {
    const transport = nodemailer.createTransport({
      host: 'smtp.timeweb.ru', port: 465, secure: true,
      auth: { user: process.env.TIMEWEB_SMTP_USER, pass: process.env.TIMEWEB_SMTP_PASSWORD },
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000
    });
    try {
      const result = await transport.sendMail({ from: { name: 'Disbit', address: process.env.MAIL_FROM }, to, subject, html });
      if (!result.accepted?.length) throw new Error('Timeweb SMTP did not accept recipient');
    } catch { throw new Error('Timeweb SMTP delivery failed'); }
    finally { transport.close(); }
  }
  else if (PROVIDER === 'rusender') await sendViaRusender(to, subject, html);
  else if (process.env.POSTMARK_TOKEN && PROVIDER !== 'sendgrid') await sendViaPostmark(to, subject, html);
  else if (process.env.SENDGRID_API_KEY && PROVIDER === 'sendgrid') await sendViaSendgrid(to, subject, html);
  else await sendViaResend(to, subject, html);
  return { sent: true };
}

// письмо с кодом — простое и читаемое в любом клиенте
export function verifyCodeHtml(code) {
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:420px;margin:0 auto">
      <h2 style="margin:0 0 6px">Подтверди почту</h2>
      <p style="color:#555;margin:0 0 18px">Введи этот код в приложении disbit:</p>
      <div style="font-size:34px;font-weight:800;letter-spacing:8px;padding:16px 0;text-align:center;
                  background:#f4f6fb;border-radius:12px">${code}</div>
      <p style="color:#888;font-size:13px;margin-top:18px">
        Код действует 15 минут. Если это были не вы — просто проигнорируйте письмо.</p>
    </div>`;
}
