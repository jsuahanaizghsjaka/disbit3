// Run in an isolated Playwright session against the localhost fixture.
async page => {
  await page.goto('http://127.0.0.1:3399/');
  await page.evaluate(() => {
    localStorage.setItem('disbit_intro_v1', '1');
    localStorage.removeItem('disbit_token_v1');
    localStorage.setItem('disbit_owner_v1', 'draft-owner-a');
  });
  await page.reload();
  const result = await page.evaluate(async () => {
    const assert = (value, message) => { if (!value) throw new Error(message); };
    const field = document.getElementById('f-name');
    const overlay = document.getElementById('add-overlay');
    const ownerKey = 'disbit_owner_v1';
    const type = value => { field.value = value; field.dispatchEvent(new Event('input', { bubbles: true })); };
    const key = owner => `disbit-path-draft:${owner}:new`;
    editingId = null;
    sessionStorage.removeItem(key('draft-owner-a'));
    sessionStorage.removeItem(key('draft-owner-b'));
    overlay.hidden = false;
    type('Сохранить черновик');
    assert(!sessionStorage.getItem(key('draft-owner-a')), 'Writing must be debounced');
    closeSheet('add-overlay');
    await Promise.resolve();
    assert(JSON.parse(sessionStorage.getItem(key('draft-owner-a'))).values['f-name'] === 'Сохранить черновик', 'Closing must flush draft');
    overlay.hidden = false;
    type('Удалить черновик');
    closeSheet('add-overlay');
    discardHabitDraft('new');
    await new Promise(resolve => setTimeout(resolve, 400));
    assert(!sessionStorage.getItem(key('draft-owner-a')), 'Discarded draft must not reappear');
    overlay.hidden = false;
    type('Только аккаунт A');
    localStorage.setItem(ownerKey, 'draft-owner-b');
    field.value = 'Исходное значение B';
    restoreHabitDraft('new');
    assert(field.value === 'Исходное значение B', 'In-memory draft must be isolated by owner');
    await new Promise(resolve => setTimeout(resolve, 400));
    assert(!sessionStorage.getItem(key('draft-owner-a')) && !sessionStorage.getItem(key('draft-owner-b')), 'Old timer must not write across owners');
    type('Сохранить при уходе');
    window.dispatchEvent(new Event('pagehide'));
    assert(JSON.parse(sessionStorage.getItem(key('draft-owner-b'))).values['f-name'] === 'Сохранить при уходе', 'Pagehide must flush synchronously');
    discardHabitDraft('new');
    overlay.hidden = true;
    return { closeFlush: true, discard: true, ownerIsolation: true, pagehideFlush: true };
  });
  return result;
}
