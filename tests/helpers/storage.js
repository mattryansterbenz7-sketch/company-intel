// Seed storage while already on an extension page, then reload
async function seedStorage(page, data) {
  await page.evaluate((d) => {
    return new Promise((resolve) => chrome.storage.local.set(d, resolve));
  }, data);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

// Seed storage before navigating (preferred for pages that need data on first load)
// options.localStorageData: { key: value } pairs to set in localStorage before navigation
async function seedStorageThenNavigate(context, extensionId, targetPath, data, options = {}) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/integrations.html`);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate((d) => {
    return new Promise((resolve) => chrome.storage.local.set(d, resolve));
  }, data);
  if (options.localStorageData) {
    await page.evaluate((ls) => {
      Object.entries(ls).forEach(([k, v]) => localStorage.setItem(k, v));
    }, options.localStorageData);
  }
  await page.goto(`chrome-extension://${extensionId}/${targetPath}`);
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function clearStorage(page) {
  await page.evaluate(() => {
    return new Promise((resolve) => chrome.storage.local.clear(resolve));
  });
}

module.exports = { seedStorage, clearStorage, seedStorageThenNavigate };
