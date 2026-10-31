/* Shared GET coordinator. Mutation requests intentionally use their existing
   payment/proof-specific paths and idempotency rules. */
(function (root) {
  'use strict';

  function createReadCoordinator({ fetchImpl, getOwner, getTimeZone, timeoutMs = 15000 }) {
    const pending = new Map();

    function cancelExcept(owner) {
      for (const entry of pending.values()) {
        if (entry.owner !== owner) {
          entry.cancelReason = 'stale';
          clearTimeout(entry.timer);
          entry.controller.abort();
          pending.delete(entry.key);
        }
      }
    }

    function cancelResource(url) {
      for (const entry of pending.values()) {
        if (entry.owner === (getOwner() || null) && entry.url === url) {
          entry.cancelReason = 'stale';
          clearTimeout(entry.timer);
          entry.controller.abort();
          pending.delete(entry.key);
        }
      }
    }

    function read(url) {
      const owner = getOwner() || null;
      const timeZone = getTimeZone();
      cancelExcept(owner);
      // A JSON tuple prevents delimiter collisions and stays only in memory.
      const key = JSON.stringify([owner, timeZone, url]);
      const existing = pending.get(key);
      if (existing) return existing.promise;
      const controller = new AbortController();
      const entry = { key, owner, url, controller, cancelReason: null, promise: null };
      const timer = setTimeout(() => {
        entry.cancelReason = 'timeout';
        controller.abort();
      }, timeoutMs);
      entry.timer = timer;
      const headers = { 'Content-Type': 'application/json', 'X-Time-Zone': timeZone };
      if (owner) headers.Authorization = 'Bearer ' + owner;
      entry.promise = (async () => {
        try {
          const response = await Promise.resolve().then(() => fetchImpl(url, { method: 'GET', headers, signal: controller.signal }));
          const data = await response.json().catch(() => null);
          if ((getOwner() || null) !== owner || getTimeZone() !== timeZone) return { kind: 'stale' };
          if (entry.cancelReason) return { kind: entry.cancelReason };
          if (!response.ok) return { kind: 'http', status: response.status, data };
          if (data === null) return { kind: 'invalid', status: response.status };
          return { kind: 'ok', status: response.status, data };
        } catch (error) {
          if ((getOwner() || null) !== owner || getTimeZone() !== timeZone || entry.cancelReason === 'stale') return { kind: 'stale' };
          if (entry.cancelReason === 'timeout') return { kind: 'timeout' };
          return { kind: 'network', errorName: error?.name || 'Error' };
        } finally {
          clearTimeout(timer);
          if (pending.get(key) === entry) pending.delete(key);
        }
      })();
      pending.set(key, entry);
      return entry.promise;
    }

    return { read, cancelExcept, cancelResource };
  }

  root.createDisbitReadCoordinator = createReadCoordinator;
  if (typeof module !== 'undefined' && module.exports) module.exports = { createDisbitReadCoordinator: createReadCoordinator };
})(typeof globalThis === 'undefined' ? window : globalThis);
