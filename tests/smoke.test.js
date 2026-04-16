const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const { seedStorage, clearStorage, seedStorageThenNavigate } = require('./helpers/storage');
const { sampleCompany, sampleOpportunity, sampleQueueOpportunity } = require('./fixtures/companies');

const EXTENSION_PATH = path.join(__dirname, '..');

let context;
let extensionId;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
    ],
  });

  // Get extension ID from the service worker URL
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  extensionId = sw.url().split('/')[2];
});

test.afterAll(async () => {
  await context?.close();
});

// Helper: open a fresh page, navigate, optionally seed storage
async function openPage(url, storageData) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => {
    // Ignore expected extension messaging errors from unconnected contexts
    if (!e.message.includes('Extension context invalidated') &&
        !e.message.includes('Cannot read properties of undefined')) {
      errors.push(e.message);
    }
  });

  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');

  if (storageData) {
    await seedStorage(page, storageData);
  }

  return { page, errors };
}

// ── saved.html ────────────────────────────────────────────────────────────────

test.describe('saved.html', () => {
  test('loads without JS errors', async () => {
    const { page, errors } = await openPage(`chrome-extension://${extensionId}/saved.html`);
    expect(errors).toHaveLength(0);
    await page.close();
  });

  test('renders kanban columns', async () => {
    const { page } = await openPage(`chrome-extension://${extensionId}/saved.html`);
    // At least one stage column should render
    const columns = page.locator('.stage-col, .kanban-col, [data-stage]');
    await expect(columns.first()).toBeVisible({ timeout: 8000 });
    await page.close();
  });

  test('shows company card when data present', async () => {
    const page = await seedStorageThenNavigate(
      context, extensionId, 'saved.html',
      { savedCompanies: [sampleCompany] },
      { localStorageData: { ci_activePipeline: 'all' } }
    );
    await expect(page.getByText('Acme Corp')).toBeVisible({ timeout: 8000 });
    await page.close();
  });

  test('shows opportunity card when data present', async () => {
    const page = await seedStorageThenNavigate(
      context, extensionId, 'saved.html',
      { savedCompanies: [sampleOpportunity] }
    );
    await expect(page.getByText('Nexus AI')).toBeVisible({ timeout: 8000 });
    await page.close();
  });
});

// ── company.html ──────────────────────────────────────────────────────────────

test.describe('company.html', () => {
  test('loads a saved company by id', async () => {
    const { page } = await openPage(
      `chrome-extension://${extensionId}/company.html?id=${sampleCompany.id}`,
      { savedCompanies: [sampleCompany] }
    );
    await expect(page.locator('#hdr-name')).toHaveValue('Acme Corp', { timeout: 8000 });
    await page.close();
  });

  test('loads an opportunity by id', async () => {
    const { page } = await openPage(
      `chrome-extension://${extensionId}/company.html?id=${sampleOpportunity.id}`,
      { savedCompanies: [sampleOpportunity] }
    );
    await expect(page.locator('#hdr-name')).toHaveValue('Nexus AI', { timeout: 8000 });
    await page.close();
  });
});

// ── queue.html ────────────────────────────────────────────────────────────────

test.describe('queue.html', () => {
  test('loads without JS errors', async () => {
    const { page, errors } = await openPage(`chrome-extension://${extensionId}/queue.html`);
    expect(errors).toHaveLength(0);
    await page.close();
  });

  test('shows opportunity card for needs_review entries', async () => {
    const { page } = await openPage(
      `chrome-extension://${extensionId}/queue.html`,
      { savedCompanies: [sampleQueueOpportunity] }
    );
    await expect(page.getByText('QueueCo')).toBeVisible({ timeout: 8000 });
    await page.close();
  });
});

// ── preferences.html ──────────────────────────────────────────────────────────

test.describe('preferences.html', () => {
  test('loads and renders form inputs', async () => {
    const { page } = await openPage(`chrome-extension://${extensionId}/preferences.html`);
    await expect(page.locator('#pref-name')).toBeVisible({ timeout: 8000 });
    await page.close();
  });
});

// ── integrations.html ─────────────────────────────────────────────────────────

test.describe('integrations.html', () => {
  test('loads and shows Anthropic API key field', async () => {
    const { page } = await openPage(`chrome-extension://${extensionId}/integrations.html`);
    await expect(page.getByText(/anthropic/i).first()).toBeVisible({ timeout: 8000 });
    await page.close();
  });
});

// ── opportunity.html ──────────────────────────────────────────────────────────
// opportunity.html is a redirect shim to company.html — no JS errors is the only assertion needed.
// Rendering coverage for opportunities is via company.html tests above.

test.describe('opportunity.html', () => {
  test('loads without JS errors', async () => {
    const { page, errors } = await openPage(`chrome-extension://${extensionId}/opportunity.html`);
    expect(errors).toHaveLength(0);
    await page.close();
  });
});
