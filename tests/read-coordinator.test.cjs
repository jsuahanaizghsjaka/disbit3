const test = require('node:test');
const assert = require('node:assert/strict');
const { createDisbitReadCoordinator } = require('../frontend/path-network.js');

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
const jsonResponse = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

test('same user and GET coalesce while different resources remain independent', async () => {
  let count = 0;
  const first = deferred();
  const coordinator = createDisbitReadCoordinator({
    fetchImpl: async (url, options) => {
      count++;
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.Authorization, 'Bearer account-a');
      assert.equal(options.headers['X-Time-Zone'], 'Europe/Moscow');
      return url === '/friends' ? first.promise : jsonResponse({ balance: 0 });
    },
    getOwner: () => 'account-a', getTimeZone: () => 'Europe/Moscow'
  });
  const a = coordinator.read('/friends');
  const b = coordinator.read('/friends');
  const wallet = coordinator.read('/wallet');
  assert.strictEqual(a, b);
  assert.equal((await wallet).data.balance, 0);
  first.resolve(jsonResponse({ friends: [] }));
  assert.deepEqual((await a).data, { friends: [] });
  assert.equal(count, 2);
  await coordinator.read('/friends');
  assert.equal(count, 3, 'completed reads do not become a stale cache');
});

test('account switch aborts an old read and never returns its data', async () => {
  let owner = 'account-a';
  let oldSignal;
  const old = deferred();
  const coordinator = createDisbitReadCoordinator({
    fetchImpl: (url, options) => {
      if (options.headers.Authorization === 'Bearer account-a') { oldSignal = options.signal; return old.promise; }
      return Promise.resolve(jsonResponse({ owner: 'b' }));
    },
    getOwner: () => owner, getTimeZone: () => 'Europe/Moscow'
  });
  const previous = coordinator.read('/state');
  await Promise.resolve();
  owner = 'account-b';
  const next = coordinator.read('/state');
  assert.equal(oldSignal.aborted, true);
  old.resolve(jsonResponse({ owner: 'a' }));
  assert.deepEqual(await previous, { kind: 'stale' });
  assert.deepEqual((await next).data, { owner: 'b' });
});

test('timezone change does not reuse or apply a pending read from the old zone', async () => {
  let zone = 'Europe/Moscow';
  const old = deferred();
  const seen = [];
  const coordinator = createDisbitReadCoordinator({
    fetchImpl: (url, options) => {
      seen.push(options.headers['X-Time-Zone']);
      return options.headers['X-Time-Zone'] === 'Europe/Moscow'
        ? old.promise : Promise.resolve(jsonResponse({ zone }));
    },
    getOwner: () => 'account-a', getTimeZone: () => zone
  });
  const previous = coordinator.read('/state');
  await Promise.resolve();
  zone = 'Asia/Tokyo';
  const next = coordinator.read('/state');
  assert.deepEqual((await next).data, { zone: 'Asia/Tokyo' });
  old.resolve(jsonResponse({ zone: 'Europe/Moscow' }));
  assert.deepEqual(await previous, { kind: 'stale' });
  assert.deepEqual(seen, ['Europe/Moscow', 'Asia/Tokyo']);
});

test('hung GET times out, clears in-flight entry and permits a retry', async () => {
  let calls = 0;
  const coordinator = createDisbitReadCoordinator({
    fetchImpl: (url, { signal }) => {
      calls++;
      if (calls > 1) return Promise.resolve(jsonResponse({ ok: true }));
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    },
    getOwner: () => 'account-a', getTimeZone: () => 'Europe/Moscow', timeoutMs: 20
  });
  assert.deepEqual(await coordinator.read('/state'), { kind: 'timeout' });
  assert.equal((await coordinator.read('/state')).kind, 'ok');
  assert.equal(calls, 2);
});

test('HTTP failures are reported and synchronous fetch errors do not poison later reads', async () => {
  let calls = 0;
  const coordinator = createDisbitReadCoordinator({
    fetchImpl: () => { if (++calls === 1) throw new TypeError('network'); return Promise.resolve(jsonResponse({ error: 'unauthorized' }, 401)); },
    getOwner: () => null, getTimeZone: () => 'Europe/Moscow'
  });
  assert.equal((await coordinator.read('/state')).kind, 'network');
  assert.deepEqual(await coordinator.read('/state'), { kind: 'http', status: 401, data: { error: 'unauthorized' } });
});
