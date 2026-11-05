import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { googleConfig, exchangeGoogleCode } from '../lib/google-identity.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const FLOW_TTL = 10 * 60 * 1000;
const RESULT_TTL = 60 * 1000;

export function createSocialAuthRouter({ db, createSession, publicUser, hashPassword, verifyPassword,
  config = googleConfig, exchange = exchangeGoogleCode }) {
  const router = Router();
  const cookieName = cfg => (cfg.origin.startsWith('https:') ? '__Host-' : '') + 'disbit_oauth';
  const cookieOptions = cfg => ({ httpOnly: true, secure: cfg.origin.startsWith('https:'), sameSite: 'lax', path: '/' });
  const cookie = (req, name) => {
    const values = (req.headers.cookie || '').split(';').map(s => s.trim()).filter(s => s.startsWith(name + '='));
    if (values.length !== 1) return '';
    const value = values[0].slice(name.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : '';
  };
  const sameOrigin = (req, cfg) => req.get('origin') === cfg.origin && req.get('X-Disbit-OAuth') === '1';
  const currentSession = (token, userId) => db.prepare('SELECT 1 FROM sessions WHERE token=? AND user_id=? AND expires_at>?').get(token || '', userId, Date.now());
  function limit(bucket, max) {
    const now = Date.now();
    db.prepare('DELETE FROM oauth_limits WHERE window_start<?').run(now - 15 * 60 * 1000);
    db.prepare('INSERT INTO oauth_limits(bucket,window_start,count) VALUES(?,?,0) ON CONFLICT(bucket) DO NOTHING').run(bucket, now);
    return db.prepare('UPDATE oauth_limits SET count=count+1 WHERE bucket=? AND count<?').run(bucket, max).changes > 0;
  }
  function clean() {
    db.prepare('DELETE FROM oauth_flows WHERE expires_at<?').run(Date.now());
    db.prepare('DELETE FROM oauth_results WHERE expires_at<?').run(Date.now());
  }
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy', 'no-referrer'); next(); });
  router.get('/providers', (req, res) => res.json({ google: !!config(), apple: false }));
  router.post('/google/start', (req, res) => {
    const cfg = config();
    if (!cfg) return res.status(503).json({ error: 'Вход через Google пока недоступен' });
    if (!sameOrigin(req, cfg)) return res.status(403).json({ error: 'Откройте вход в этом приложении' });
    clean();
    if (!limit('start:' + digest(req.ip || ''), 20) || !limit('global', 200)) return res.status(429).json({ error: 'Слишком много попыток. Попробуйте через 15 минут.' });
    const mode = req.body?.mode;
    if (!['login', 'link'].includes(mode)) return res.status(400).json({ error: 'Неверный режим входа' });
    let userId = null, session = null;
    if (mode === 'link') {
      if (!req.userId || !currentSession(req.token, req.userId)) return res.status(401).json({ error: 'Сначала войдите в аккаунт' });
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.userId);
      const password = req.body?.password;
      if (!user || !user.email_verified || typeof password !== 'string' || password.length > 1024
          || !verifyPassword(password, user.pass_salt, user.pass_hash)) return res.status(403).json({ error: 'Подтвердите почту и текущий пароль аккаунта' });
      userId = req.userId; session = req.token;
    }
    const state = secret(), binding = secret(), nonce = secret(), verifier = secret();
    const previous = cookie(req, cookieName(cfg));
    if (previous) {
      db.prepare('DELETE FROM oauth_flows WHERE binding_hash=?').run(digest(previous));
      db.prepare('DELETE FROM oauth_results WHERE binding_hash=?').run(digest(previous));
    }
    db.prepare(`INSERT INTO oauth_flows(state_hash,binding_hash,nonce,verifier,mode,user_id,session_token,expires_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(digest(state), digest(binding), nonce, verifier, mode, userId, session, Date.now() + FLOW_TTL);
    res.cookie(cookieName(cfg), binding, { ...cookieOptions(cfg), maxAge: FLOW_TTL });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code',
      scope: 'openid email profile', state, nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256', prompt: 'select_account' }).toString();
    return res.json({ url: url.href });
  });
  router.get('/google/callback', async (req, res) => {
    try {
    const cfg = config();
    if (!cfg) return res.status(503).send('Google sign-in unavailable');
    const state = req.query.state, binding = cookie(req, cookieName(cfg));
    if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state) || !binding) return res.status(400).send('Invalid sign-in request. Start again in Disbit.');
    // Consume before the network call; duplicate callbacks cannot create sessions.
    const flow = db.prepare('DELETE FROM oauth_flows WHERE state_hash=? AND binding_hash=? AND expires_at>? RETURNING *')
      .get(digest(state), digest(binding), Date.now());
    if (!flow) return res.status(400).send('Sign-in expired or already used. Start again in Disbit.');
    let result = 'failed', userId = null;
    if (req.query.error === 'access_denied') result = 'cancelled';
    else if (typeof req.query.code === 'string' && req.query.code.length > 0 && req.query.code.length <= 4096) {
      try {
        const identity = await exchange(req.query.code, flow, cfg);
        db.exec('BEGIN IMMEDIATE');
        try {
          const linked = db.prepare("SELECT user_id FROM social_identities WHERE provider='google' AND subject=?").get(identity.subject);
          if (flow.mode === 'link') {
            if (!currentSession(flow.session_token, flow.user_id)) result = 'session_expired';
            else if (linked && linked.user_id !== flow.user_id) result = 'identity_in_use';
            else {
              const own = db.prepare("SELECT subject FROM social_identities WHERE provider='google' AND user_id=?").get(flow.user_id);
              if (own && own.subject !== identity.subject) result = 'already_linked';
              else {
                db.prepare("INSERT OR IGNORE INTO social_identities(provider,subject,user_id) VALUES('google',?,?)").run(identity.subject, flow.user_id);
                result = 'linked'; userId = flow.user_id;
              }
            }
          } else if (linked) { result = 'login'; userId = linked.user_id; }
          else if (db.prepare('SELECT 1 FROM users WHERE lower(email)=?').get(identity.email)) result = 'link_required';
          else {
            // No usable password is created; email recovery can set one later.
            const password = hashPassword(secret());
            const created = db.prepare('INSERT INTO users(login,email,pass_hash,pass_salt,email_verified) VALUES(?,?,?,?,1)')
              .run('g_' + randomBytes(10).toString('hex'), identity.email, password.hash, password.salt);
            userId = Number(created.lastInsertRowid);
            db.prepare("INSERT INTO social_identities(provider,subject,user_id) VALUES('google',?,?)").run(identity.subject, userId);
            result = 'login';
          }
          db.exec('COMMIT');
        } catch (err) { db.exec('ROLLBACK'); throw err; }
      } catch {
        // Never log provider codes, tokens, passwords or raw upstream errors.
        console.error('[oauth] Google callback failed'); result = 'failed'; userId = null;
      }
    }
    db.prepare('INSERT INTO oauth_results(binding_hash,result,user_id,session_token,expires_at) VALUES(?,?,?,?,?)')
      .run(digest(binding), result, userId, result === 'linked' ? flow.session_token : null, Date.now() + RESULT_TTL);
    res.cookie(cookieName(cfg), binding, { ...cookieOptions(cfg), maxAge: RESULT_TTL });
    return res.redirect(303, cfg.origin + '/?oauth=google');
    } catch {
      console.error('[oauth] Google callback storage failed');
      if (!res.headersSent) return res.status(503).send('Sign-in unavailable. Try again later in Disbit.');
    }
  });
  router.post('/google/result', (req, res) => {
    const cfg = config();
    if (!cfg) return res.status(503).json({ error: 'Вход через Google пока недоступен' });
    if (!sameOrigin(req, cfg)) return res.status(403).json({ error: 'Откройте вход в этом приложении' });
    const binding = cookie(req, cookieName(cfg));
    res.clearCookie(cookieName(cfg), cookieOptions(cfg));
    if (!binding) return res.status(400).json({ result: 'expired' });
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = db.prepare('DELETE FROM oauth_results WHERE binding_hash=? AND expires_at>? RETURNING *').get(digest(binding), Date.now());
      let reply = { result: row?.result || 'expired' };
      if (row?.result === 'linked' && (req.token !== row.session_token || !currentSession(row.session_token, row.user_id))) reply = { result: 'session_expired' };
      if (row?.result === 'login') {
        const user = db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id);
        if (user) reply = { result: 'login', token: createSession(user.id), user: publicUser(user) };
        else reply = { result: 'expired' };
      }
      db.exec('COMMIT');
      return res.json(reply);
    } catch (err) { db.exec('ROLLBACK'); throw err; }
  });
  return router;
}
