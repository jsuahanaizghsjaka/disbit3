import path from 'node:path';

// Validate before importing routes: a bad deployment must not migrate a wrong DB.
export function validateRuntime(env = process.env) {
  const name = env.APP_ENV || (env.NODE_ENV === 'production' ? 'production' : 'development');
  if (!['development', 'test', 'staging', 'production'].includes(name)) throw Error('Invalid APP_ENV');
  if (env.NODE_ENV === 'production' && !['staging', 'production'].includes(name)) throw Error('NODE_ENV and APP_ENV conflict');
  const hosted = ['staging', 'production'].includes(name);
  const provider = env.PAYMENTS_PROVIDER || (hosted ? 'disabled' : 'manual');
  if (!['manual', 'disabled'].includes(provider)) throw Error('Live payments are not release-ready; use disabled or local manual');
  if (hosted && provider !== 'disabled') throw Error('Simulated payments are forbidden in hosted environments');
  if (env.PAYMENTS_CURRENCY && env.PAYMENTS_CURRENCY !== 'RUB') throw Error('Only RUB is supported');
  if (hosted) {
    for (const key of ['DB_PATH', 'PROOFS_DIR']) {
      if (!env[key] || !path.isAbsolute(env[key])) throw Error(`${key} must be an explicit absolute persistent path`);
    }
    if (!/^[a-f0-9]{7,40}$/.test(env.RELEASE_SHA || '')) throw Error('RELEASE_SHA must identify the deployed commit');
    let url;
    try { url = new URL(env.PUBLIC_URL); } catch { throw Error('PUBLIC_URL is required'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('PUBLIC_URL must be an HTTPS origin');
    if (name === 'staging' && ['disbit.ru','www.disbit.ru'].includes(url.hostname)) throw Error('Staging must not use the production domain');
    if ((env.ADMIN_KEY || '').length < 32) throw Error('ADMIN_KEY must contain at least 32 characters');
  }
  return { name, hosted, provider, release: env.RELEASE_SHA || 'development' };
}

export const runtime = validateRuntime();
