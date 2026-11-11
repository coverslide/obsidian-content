import { expect, test } from '@playwright/test';

const optionReference = {
  main_build_settings: {
    game: { type: 'choice', values: ['doom1', 'doom2'], default: 'doom2', tooltip: 'Game to generate' },
    port: { type: 'choice', values: ['boom', 'zdoom'], default: 'boom' },
    length: { type: 'choice', values: ['single', 'game'], default: 'game' },
    theme: { type: 'choice', values: ['original', 'tech'], default: 'original' },
  },
  architecture: {
    float_size: { type: 'slider', values: { min: 1, max: 9, default: 5, nan: ['mixed'] }, tooltip: 'Architecture size' },
    walls: { type: 'choice', values: ['brick', 'metal'] },
    enabled: { type: 'boolean', default: 1 },
  },
};

async function mockReference(page: import('@playwright/test').Page) {
  await page.route('**/api/options', (route) => route.fulfill({ json: optionReference }));
}

test('loads core settings and every grouped option from the reference', async ({ page }) => {
  await mockReference(page);
  await page.route('**/api/jobs', (route) => route.fulfill({ json: [] }));
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Level Forge' })).toBeVisible();
  await expect(page.locator('[name="core.game"]')).toHaveValue('doom2');
  await expect(page.locator('[name="core.port"]')).toHaveValue('boom');
  await expect(page.locator('[name="core.length"]')).toHaveValue('game');
  const architecture = page.locator('.option-group').filter({ hasText: 'architecture' }).locator('summary');
  await expect(architecture).toBeVisible();
  await architecture.click();
  await expect(page.locator('[name="option.float_size"]')).toHaveValue('5');
  await expect(page.locator('[name="option.walls"] option').first()).toHaveText('Use Obsidian default');
  await expect(page.locator('[name="option.enabled"]')).toHaveValue('1');
});

test('submits selected settings, displays a completed build, and downloads its WAD', async ({ page }) => {
  await mockReference(page);
  let submitted: Record<string, unknown> | undefined;
  let posted = false;
  await page.route('**/api/jobs', async (route) => {
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON() as Record<string, unknown>;
      posted = true;
      await route.fulfill({ json: { id: 'job-123', status: 'queued', createdAt: '2026-01-02T03:04:05Z' } });
      return;
    }
    await route.fulfill({ json: posted ? [{ id: 'job-123', status: 'completed', createdAt: '2026-01-02T03:04:05Z', file: '/api/jobs/job-123/download' }] : [] });
  });
  await page.route('**/api/jobs/job-123/download', (route) => route.fulfill({
    status: 200,
    contentType: 'application/octet-stream',
    headers: { 'content-disposition': 'attachment; filename="obsidian-job-123.wad"' },
    body: 'PWAD-test-content',
  }));

  await page.goto('/');
  await page.locator('[name="core.game"]').selectOption('doom1');
  await page.locator('[name="core.port"]').selectOption('zdoom');
  await page.locator('[name="core.theme"]').selectOption('tech');
  await page.locator('[name="core.length"]').selectOption('single');
  await page.locator('[name="seed"]').fill('e2e-seed');
  await page.locator('.option-group').filter({ hasText: 'architecture' }).locator('summary').click();
  await page.locator('[name="option.float_size"]').fill('8');
  await page.locator('[name="option.walls"]').selectOption('metal');
  await page.locator('[name="option.enabled"]').selectOption('0');
  await page.getByRole('button', { name: /Generate WAD/ }).click();

  await expect(page.getByText(/OBSIDIAN-.*123/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /Download WAD/ })).toBeVisible();
  expect(submitted).toEqual({
    game: 'doom1', port: 'zdoom', theme: 'tech', length: 'single', seed: 'e2e-seed',
    options: { float_size: '8', walls: 'metal', enabled: '0' },
  });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: /Download WAD/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('obsidian-job-123.wad');
});

test('shows a failed generation message without rendering it as HTML', async ({ page }) => {
  await mockReference(page);
  await page.route('**/api/jobs', (route) => route.fulfill({ json: [{
    id: 'failed-1', status: 'failed', createdAt: '2026-01-02T03:04:05Z', error: '<img src=x onerror=alert(1)> generator error',
  }] }));
  await page.goto('/');
  await expect(page.getByText(/generator error/)).toBeVisible();
  await expect(page.locator('.error img')).toHaveCount(0);
});

test('reports a queue error and makes the build button available again', async ({ page }) => {
  await mockReference(page);
  await page.route('**/api/jobs', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 503, body: 'queue is full' });
      return;
    }
    await route.fulfill({ json: [] });
  });
  await page.goto('/');
  const dialog = page.waitForEvent('dialog');
  await page.getByRole('button', { name: /Generate WAD/ }).click();
  await (await dialog).accept();
  await expect(page.getByRole('button', { name: /Generate WAD/ })).toBeEnabled();
});
