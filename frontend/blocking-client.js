/* Автоблокировка приложений: связь веб-слоя с нативным плагином AppBlocking.
   Работает только в Android-сборке с плагином. Сервер решает, что ограничивать
   (GET /api/blocking/plan); телефон применяет план и обновляет его в фоне сам.
   Любая ошибка — в пользу человека: план снимается, ничего не придумывается. */
(function () {
  const DEVICE_KEY = 'disbit_blocking_device_v1';
  let cfg = null, pluginRef = null, enforcement = null, lastSync = 0, syncing = null, appsCache = null;

  function plugin() {
    const cap = window.Capacitor;
    if (!cap?.isNativePlatform?.() || cap.getPlatform?.() !== 'android' || !cap.isPluginAvailable?.('AppBlocking')) return null;
    if (!pluginRef) pluginRef = cap.Plugins?.AppBlocking || cap.registerPlugin('AppBlocking');
    return pluginRef;
  }
  const read = () => { try { return JSON.parse(localStorage.getItem(DEVICE_KEY)) || null; } catch { return null; } };
  const write = v => { try { v ? localStorage.setItem(DEVICE_KEY, JSON.stringify(v)) : localStorage.removeItem(DEVICE_KEY); } catch {} };
  function linkedDevice() {
    const saved = read(), owner = cfg?.owner?.();
    return saved && owner && saved.owner === owner ? saved.deviceId : null;
  }

  async function request(method, path, body, deviceId) {
    const api = cfg?.api?.(), token = cfg?.token?.();
    if (!api || !token) return { status: 0, body: null };
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
    if (deviceId) headers['X-Disbit-Device'] = deviceId;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(api + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
      return { status: response.status, body: await response.json().catch(() => null) };
    } catch { return { status: 0, body: null }; }
    finally { clearTimeout(timer); }
  }

  async function clearNative() { try { await plugin()?.clearPlan(); } catch {} }

  async function refreshEnforcement() {
    const token = cfg?.token?.();
    const r = await request('GET', '/blocking/devices');
    if (token !== cfg?.token?.()) return enforcement;
    if (r.status === 200 && r.body) {
      enforcement = !!r.body.enforcement;
      const mine = linkedDevice();
      // телефон отключён на сервере (выход на другом устройстве, лимит, удаление) — забываем
      if (mine && !r.body.devices.some(d => d.id === mine && d.current && d.consentCurrent)) { write(null); await clearNative(); }
    }
    return enforcement;
  }

  /* План с сервера → телефон. force — после отметки обещания. */
  function sync(force) {
    const p = plugin(), deviceId = linkedDevice();
    if (!p || !deviceId || !cfg?.token?.()) return Promise.resolve(null);
    if (!force && Date.now() - lastSync < 20000) return syncing || Promise.resolve(null);
    if (syncing) return syncing.then(() => (force ? sync(true) : null));
    const token = cfg.token();
    lastSync = Date.now();
    syncing = (async () => {
      const r = await request('GET', '/blocking/plan', undefined, deviceId);
      if (cfg.token() !== token || linkedDevice() !== deviceId) return null;
      if (r.status === 401) { await forget(); return null; }
      if (r.status !== 200 || !r.body) return null;   // нет связи: телефон сам снимет ограничение по сроку
      enforcement = r.body.enrollment !== 'disabled';
      try {
        const result = await p.applyPlan({ plan: r.body, apiBase: cfg.api().replace(/\/api$/, ''), token: cfg.token(), deviceId });
        if (!result?.enrolled) write(null);
        return result;
      } catch { await clearNative(); return null; }
    })().finally(() => { syncing = null; });
    return syncing;
  }

  async function status() {
    const p = plugin();
    if (!p) return { available: false };
    let native = {};
    try { native = await p.getStatus(); } catch {}
    if (enforcement === null) await refreshEnforcement();
    return { available: true, enforcement: !!enforcement, linked: !!linkedDevice(), ...native };
  }

  /* Подключить телефон к обещаниям. Сначала согласие и разрешение — в нативных настройках. */
  async function enroll() {
    const p = plugin();
    if (!p) return { error: 'Подключение доступно только в приложении Disbit для Android.' };
    let inst;
    try { inst = await p.getInstallation(); } catch { return { error: 'Нужна новая версия приложения.' }; }
    if (inst.consentVersion !== inst.requiredConsentVersion || !inst.authorized) return { needsSetup: true };
    const token = cfg.token();
    const r = await request('POST', '/blocking/devices', { platform: 'android', installationId: inst.installationId,
      consentVersion: inst.consentVersion, label: inst.label || '', appVersion: inst.appVersion || '' });
    if (token !== cfg.token()) return { error: 'Аккаунт изменился.' };
    if (r.body?.code === 'consent_outdated') return { needsSetup: true };
    if (r.status !== 200 && r.status !== 201) return { error: r.body?.error || 'Сервер недоступен. Проверь связь и попробуй ещё раз.' };
    write({ owner: cfg.owner(), deviceId: r.body.device.id });
    enforcement = !!r.body.enforcement;
    await sync(true);
    return { ok: true, enforcement };
  }

  async function disconnect() {
    const id = linkedDevice();
    write(null); await clearNative();
    if (id) await request('DELETE', '/blocking/devices/' + id);
  }

  /* Выход из аккаунта: снять ограничения до того, как сессия исчезнет. */
  async function forget() { write(null); enforcement = null; appsCache = null; await clearNative(); }

  async function listApps() {
    if (appsCache) return appsCache;
    try { appsCache = (await plugin()?.listApps())?.apps || []; } catch { appsCache = []; }
    return appsCache;
  }

  const ready = () => !!plugin() && !!linkedDevice() && enforcement === true;

  /* ---------- экран «Блокировка приложений» ---------- */
  async function renderSheet() {
    const box = document.getElementById('blocking-link');
    if (!box) return;
    const s = await status();
    box.hidden = !s.available;
    if (!s.available) return;
    const text = document.getElementById('blocking-link-status');
    const connect = document.getElementById('blocking-link-connect');
    const off = document.getElementById('blocking-link-disconnect');
    connect.hidden = s.linked; off.hidden = !s.linked;
    text.textContent = !s.enforcement ? 'Автоматические ограничения за обещания на сервере пока выключены.'
      : !s.linked ? 'Телефон не подключён. Подключи его, чтобы выбирать блокировку как штраф в обещаниях.'
      : !s.authorized ? 'Телефон подключён, но служба Disbit в специальных возможностях Android выключена — ограничения не работают.'
      : s.planWindows > 0 ? `Сейчас действует ограничений: ${s.planWindows}. Выполни обещание — и оно снимется.`
      : 'Телефон подключён. Сейчас ограничений нет.';
  }

  function wireSheet() {
    document.getElementById('capability-open')?.addEventListener('click', () => { renderSheet(); });
    const connect = document.getElementById('blocking-link-connect');
    connect?.addEventListener('click', async () => {
      connect.disabled = true;
      const text = document.getElementById('blocking-link-status');
      try {
        const r = await enroll();
        if (r.needsSetup) {
          text.textContent = 'Сначала прочитай описание доступа, согласись и включи службу Disbit. Потом вернись и нажми «Подключить» ещё раз.';
          try { await plugin()?.openSettings(); } catch {}
          return;
        }
        if (r.error) { text.textContent = r.error; return; }
        await renderSheet();
        syncLockForm();
      } finally { connect.disabled = false; }
    });
    document.getElementById('blocking-link-disconnect')?.addEventListener('click', async () => {
      if (!confirm('Отключить телефон? Ограничения за обещания на нём сразу снимутся.')) return;
      await disconnect(); await renderSheet(); syncLockForm();
    });
  }

  /* ---------- форма обещания ---------- */
  function syncLockForm() {
    const button = document.querySelector('#stake-mode [data-stake="lock"]');
    if (!button) return;
    const on = ready();
    // старые lock-обещания остаются редактируемыми, как и раньше
    button.disabled = !on && !button.classList.contains('active');
    button.lastChild.textContent = on ? 'Блокировка' : 'Недоступно';
    const hint = document.getElementById('lock-unavailable');
    if (hint) hint.textContent = on
      ? 'Блокировка: если обещание не выполнено, выбранные приложения будут ограничены весь следующий день, пока ты его не выполнишь. Телефон, настройки и Disbit доступны всегда.'
      : plugin() ? 'Чтобы выбрать блокировку, подключи телефон: Профиль → Настройки → Блокировка приложений.'
      : 'Блокировка приложений работает только в приложении Disbit для Android.';
    const mins = document.getElementById('f-lock-mins');
    if (mins) mins.closest('.count-fields').hidden = on;
    const apps = document.getElementById('f-apps');
    const list = document.getElementById('lock-app-list');
    if (apps) apps.hidden = on;
    if (list) { list.hidden = !on; if (on) renderAppList(); }
    const note = document.getElementById('lock-note');
    if (note) note.hidden = on;
  }

  async function renderAppList() {
    const list = document.getElementById('lock-app-list'), field = document.getElementById('f-apps');
    if (!list || !field) return;
    const chosen = new Set(field.value.split(',').map(s => s.trim()).filter(Boolean));
    if (!list.childElementCount) list.textContent = 'Загружаем приложения…';
    const apps = await listApps();
    list.replaceChildren();
    if (!apps.length) { list.textContent = 'Нет приложений, которые можно ограничить.'; return; }
    for (const app of apps) {
      const label = document.createElement('label');
      label.className = 'lock-app';
      const box = document.createElement('input');
      box.type = 'checkbox'; box.value = app.package; box.checked = chosen.has(app.package);
      box.addEventListener('change', () => {
        const set = new Set(field.value.split(',').map(s => s.trim()).filter(Boolean));
        box.checked ? set.add(app.package) : set.delete(app.package);
        field.value = [...set].join(', ');
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const name = document.createElement('span');
      name.textContent = app.label;
      label.append(box, name);
      list.append(label);
    }
  }

  window.DisbitBlocking = {
    configure(options) { cfg = options; },
    available: () => !!plugin(),
    ready, sync, status, enroll, disconnect, forget, listApps, refreshEnforcement, syncLockForm,
    async start() {
      if (!plugin() || !cfg?.token?.()) return;
      await refreshEnforcement();
      syncLockForm();
      await sync(true);
    }
  };

  document.addEventListener('DOMContentLoaded', wireSheet);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(false); });
})();
