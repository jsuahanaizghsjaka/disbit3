import { createRemoteJWKSet, jwtVerify } from 'jose';

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), { timeoutDuration: 8000 });

export function googleConfig(env = process.env) {
  // Production is deliberately not enabled by the staging feature flag.
  if (env.GOOGLE_OAUTH_ENABLED !== '1' || !['development', 'test', 'staging'].includes(env.APP_ENV || 'development')) return null;
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) return null;
  let origin;
  try {
    const url = new URL(env.PUBLIC_URL);
    if (url.origin !== env.PUBLIC_URL || url.username || url.password) return null;
    const local = ['127.0.0.1', 'localhost'].includes(url.hostname) && ['test', 'development'].includes(env.APP_ENV || 'development');
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
    origin = url.origin;
  } catch { return null; }
  return { origin, clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: origin + '/api/auth/oauth/google/callback' };
}

export async function verifyGoogleToken(token, config, nonce, keys = googleKeys) {
  const { payload } = await jwtVerify(token, keys, {
    algorithms: ['RS256'], issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: config.clientId, requiredClaims: ['exp', 'iat', 'sub', 'nonce'], maxTokenAge: '10m', clockTolerance: 5
  });
  if (payload.nonce !== nonce || (payload.azp && payload.azp !== config.clientId)
      || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== config.clientId)
      || typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255
      || payload.email_verified !== true || typeof payload.email !== 'string'
      || payload.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    throw Error('Invalid Google identity');
  }
  return { subject: payload.sub, email: payload.email.trim().toLowerCase() };
}

export async function exchangeGoogleCode(code, flow, config) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: config.clientId,
      client_secret: config.clientSecret, redirect_uri: config.redirectUri, code_verifier: flow.verifier })
  });
  if (!response.ok) throw Error('Google exchange failed');
  const data = await response.json();
  if (typeof data.id_token !== 'string' || data.id_token.length > 16384) throw Error('Missing Google identity');
  return verifyGoogleToken(data.id_token, config, flow.nonce);
}
