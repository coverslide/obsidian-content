import { devices, expect, test } from '@playwright/test';

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

const jobsEndpoint = /\/api\/jobs(?:\?.*)?$/;

test('loads core settings and every grouped option from the reference', async ({ page }) => {
  await mockReference(page);
  await page.route(jobsEndpoint, (route) => route.fulfill({ json: [] }));
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
  await page.route(jobsEndpoint, async (route) => {
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON() as Record<string, unknown>;
      posted = true;
      await route.fulfill({ json: { id: 'job-123', status: 'queued', createdAt: '2026-01-02T03:04:05Z' } });
      return;
    }
    await route.fulfill({ json: posted ? [{ id: 'job-123', status: 'completed', createdAt: '2026-01-02T03:04:05Z', file: '/api/jobs/job-123/download', settings: submitted }] : [] });
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
  await page.locator('.job[data-job-id="job-123"] > summary').click();
  await expect(page.getByRole('link', { name: /Download WAD/ })).toBeVisible();
  const playHref = await page.getByRole('link', { name: /Play in UZDoom/ }).getAttribute('href');
  expect(playHref).toContain('/play/?');
  const playUrl = new URL(playHref!, 'http://localhost');
  expect(playUrl.searchParams.get('iwad')).toBe('doom.wad');
  expect(playUrl.searchParams.get('modurl')).toBe('/api/jobs/job-123/download');
  expect(playUrl.searchParams.get('warp')).toBe('1,1');
  expect(submitted).toEqual({
    game: 'doom1', port: 'zdoom', theme: 'tech', length: 'single', seed: 'e2e-seed',
    options: { float_size: '8', walls: 'metal', enabled: '0' },
  });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: /Download WAD/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('obsidian-job-123.wad');
  await page.locator('[name="core.game"]').selectOption('doom2');
  await page.locator('[name="seed"]').fill('changed');
  await page.getByRole('button', { name: 'Reuse settings' }).click();
  await expect(page.locator('[name="core.game"]')).toHaveValue('doom1');
  await expect(page.locator('[name="seed"]')).toHaveValue('e2e-seed');
  await expect(page.locator('[name="option.float_size"]')).toHaveValue('8');
  await expect(page.locator('[name="option.walls"]')).toHaveValue('metal');
});

test('adds persisted dual-stick controls only in a touch browser', async ({ browser, page }) => {
  await page.goto('/');
  await page.addScriptTag({ url: '/player/touch-controls.js' });
  const desktopControls = await page.evaluate(() => {
    const api = (window as unknown as { ObsidianTouchControls: { install: (options: unknown) => unknown } }).ObsidianTouchControls;
    return api.install({ windowRef: window, documentRef: document, canvas: document.createElement('canvas') });
  });
  expect(desktopControls).toBeNull();
  await expect(page.locator('.obsidian-touch-controls')).toHaveCount(0);

  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const touchPage = await context.newPage();
  await touchPage.goto('/');
  await touchPage.addScriptTag({ url: '/player/touch-controls.js' });
  await touchPage.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.id = 'canvas';
    document.body.appendChild(canvas);
    const api = (window as unknown as {
      ObsidianTouchControls: { install: (options: unknown) => { show: () => void } | null };
    }).ObsidianTouchControls;
    const controls = api.install({ windowRef: window, documentRef: document, canvas });
    (window as unknown as { touchKeys: string[] }).touchKeys = [];
    canvas.addEventListener('keydown', (event) => (window as unknown as { touchKeys: string[] }).touchKeys.push(`down:${(event as KeyboardEvent).code}`));
    canvas.addEventListener('keyup', (event) => (window as unknown as { touchKeys: string[] }).touchKeys.push(`up:${(event as KeyboardEvent).code}`));
    controls?.show();
  });
  await expect(touchPage.getByRole('application', { name: 'Move stick' })).toBeVisible();
  await expect(touchPage.getByRole('application', { name: 'Turn and look stick' })).toBeVisible();

  const leftStick = touchPage.locator('.touch-left');
  const bounds = await leftStick.boundingBox();
  expect(bounds).not.toBeNull();
  const pointer = { pointerId: 7, pointerType: 'touch', clientX: bounds!.x + bounds!.width / 2, clientY: bounds!.y + bounds!.height / 2 };
  await leftStick.dispatchEvent('pointerdown', pointer);
  await leftStick.dispatchEvent('pointermove', { ...pointer, clientY: pointer.clientY - 45 });
  expect(await touchPage.evaluate(() => (window as unknown as { touchKeys: string[] }).touchKeys)).toContain('down:KeyW');
  await leftStick.dispatchEvent('pointerup', { ...pointer, clientY: pointer.clientY - 45 });
  expect(await touchPage.evaluate(() => (window as unknown as { touchKeys: string[] }).touchKeys)).toContain('up:KeyW');

  await touchPage.getByRole('button', { name: 'Preview control settings' }).click();
  await touchPage.locator('[data-setting="opacity"]').evaluate((node) => {
    const slider = node as HTMLInputElement;
    slider.value = '0.75';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await touchPage.evaluate(() => JSON.parse(localStorage.getItem('obsidian-web:player-preview:v1') || '{}').opacity)).toBe(0.75);
  await context.close();
});

test('selects the local IWAD matching each generated game type', async ({ page }) => {
  await mockReference(page);
  const mappings:Record<string,string> = {
    doom1:'doom.wad', ultdoom:'doom.wad', doom2:'doom2.wad',
    tnt:'tnt.wad', plutonia:'plutonia.wad', heretic:'heretic.wad',
    hexen:'hexen.wad', strife:'strife1.wad', hacx:'hacx.wad', chex3:'chex3.wad',
  };
  await page.route(jobsEndpoint, (route) => route.fulfill({ json: Object.entries(mappings).map(([game], index) => ({
    id: `iwad-${index}`, status: 'completed', createdAt: '2026-01-02T03:04:05Z', file: `/api/jobs/iwad-${index}/download`,
    settings: { game, port: 'zdoom', theme: 'original', length: 'single', seed: '', options: {} },
  })) }));
  await page.goto('/');
  for (const [index, [game, iwad]] of Object.entries(mappings).entries()) {
    const card = page.locator(`.job[data-job-id="iwad-${index}"]`);
    await card.locator(':scope > summary').click();
    const href = await card.locator('.play-test').getAttribute('href');
    expect(new URL(href!, 'http://localhost').searchParams.get('iwad'), game).toBe(iwad);
    await expect(card.locator('.play-test')).toBeVisible();
  }
});

test('shows a failed generation message without rendering it as HTML', async ({ page }) => {
  await mockReference(page);
  await page.route(jobsEndpoint, (route) => route.fulfill({ json: [{
    id: 'failed-1', status: 'failed', createdAt: '2026-01-02T03:04:05Z', error: '<img src=x onerror=alert(1)> generator error',
  }] }));
  await page.route('**/api/jobs/failed-1/logs', (route) => route.fulfill({ body: 'generator started\nfailed while placing rooms\n', contentType: 'text/plain' }));
  await page.goto('/');
  await page.locator('.job[data-job-id="failed-1"] > summary').click();
  await expect(page.getByText(/generator error/)).toBeVisible();
  await expect(page.locator('.error img')).toHaveCount(0);
  await expect(page.locator('.job-logs pre')).toContainText('failed while placing rooms');
});

test('shows live output for a running generator and restores last settings from localStorage', async ({ page }) => {
  await mockReference(page);
  await page.addInitScript(() => localStorage.setItem('obsidian-web:last-settings:v1', JSON.stringify({
    game: 'doom1', port: 'zdoom', theme: 'tech', length: 'single', seed: 'remember-me', options: { float_size: '8' },
  })));
  await page.route(jobsEndpoint, (route) => route.fulfill({ json: [{
    id: 'live-1', status: 'running', createdAt: '2026-01-02T03:04:05Z', settings: { game: 'doom2', port: 'boom', theme: 'original', length: 'game', seed: '', options: {} },
  }] }));
  const tailLines = Array.from({ length: 25 }, (_, index) => `building room ${index + 1}`).join('\n') + '\n';
  await page.route('**/api/jobs/live-1/logs', (route) => route.fulfill({ body: tailLines, contentType: 'text/plain' }));
  await page.context().route('**/api/jobs/live-1/log', (route) => route.fulfill({ body: 'complete plaintext log from start to finish', contentType: 'text/plain' }));
  await page.goto('/');
  await page.locator('.job[data-job-id="live-1"] > summary').click();
  await expect(page.locator('[name="core.game"]')).toHaveValue('doom1');
  await expect(page.locator('[name="core.port"]')).toHaveValue('zdoom');
  await expect(page.locator('[name="seed"]')).toHaveValue('remember-me');
  await expect(page.locator('[name="option.float_size"]')).toHaveValue('8');
  await expect(page.locator('.job-logs summary')).toHaveText('Live generator log');
  const logPane = page.locator('.job-logs pre');
  await expect(logPane).toContainText('building room 25');
  await expect(logPane).not.toContainText('building room 5');
  expect(await logPane.evaluate((node) => getComputedStyle(node).whiteSpace)).toBe('pre');
  await page.evaluate(() => {
    (window as unknown as { queueMutations: number }).queueMutations = 0;
    const observer = new MutationObserver((records) => {
      const state = window as unknown as { queueMutations: number };
      state.queueMutations += records.length;
    });
    observer.observe(document.querySelector('#jobs')!, { childList: true, characterData: true, subtree: true });
  });
  await page.waitForTimeout(2700);
  expect(await page.evaluate(() => (window as unknown as { queueMutations: number }).queueMutations)).toBe(0);
  const fullLogLink = page.getByRole('link', { name: 'Open full log ↗' });
  await expect(fullLogLink).toHaveAttribute('target', '_blank');
  const popupPromise = page.waitForEvent('popup');
  await fullLogLink.click();
  const popup = await popupPromise;
  await expect(popup.locator('pre')).toHaveText('complete plaintext log from start to finish');
});

test('keeps the most recent form settings after a page reload', async ({ page }) => {
  await mockReference(page);
  await page.route(jobsEndpoint, (route) => route.fulfill({ json: [] }));
  await page.goto('/');
  await page.locator('[name="core.game"]').selectOption('doom1');
  await page.locator('[name="seed"]').fill('local-seed');
  await page.locator('.option-group').filter({ hasText: 'architecture' }).locator('summary').click();
  await page.locator('[name="option.float_size"]').fill('7');
  await page.reload();
  await expect(page.locator('[name="core.game"]')).toHaveValue('doom1');
  await expect(page.locator('[name="seed"]')).toHaveValue('local-seed');
  await expect(page.locator('[name="option.float_size"]')).toHaveValue('7');
});

test('failed runs can be deleted', async ({ page }) => {
  await mockReference(page);
  let deleted = false;
  await page.route(jobsEndpoint, async (route) => {
    await route.fulfill({ json: deleted ? [] : [{
      id: 'failed-delete', status: 'failed', createdAt: '2026-01-02T03:04:05Z', error: 'generation failed',
      settings: { game: 'heretic', port: 'zdoom', theme: 'original', length: 'game', seed: 'failed-seed', options: {} },
    }] });
  });
  await page.route('**/api/jobs/failed-delete/logs', (route) => route.fulfill({ body: 'failed output\n', contentType: 'text/plain' }));
  await page.route('**/api/jobs/failed-delete', async (route) => {
    if (route.request().method() === 'DELETE') {
      deleted = true;
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.fallback();
  });
  await page.goto('/');
  const card = page.locator('.job[data-job-id="failed-delete"]');
  await card.locator(':scope > summary').click();
  const confirm = page.waitForEvent('dialog');
  await card.getByRole('button', { name: 'Delete failed run' }).click();
  await (await confirm).accept();
  await expect(page.getByText('No runs yet')).toBeVisible();
  expect(deleted).toBe(true);
});

test('opens a run on its own detail page with status and settings', async ({ page }) => {
  await mockReference(page);
  const job = {
    id: 'run-detail', status: 'completed', createdAt: '2026-01-02T03:04:05Z', file: '/api/jobs/run-detail/download',
    settings: { game: 'heretic', port: 'zdoom', theme: 'original', length: 'game', seed: 'detail-seed', options: { float_size: '8' } },
  };
  await page.route('**/api/jobs/run-detail', (route) => route.fulfill({ json: job }));
  await page.route('**/api/jobs/run-detail/logs', (route) => route.fulfill({ body: 'generated successfully\n', contentType: 'text/plain' }));
  await page.goto('/#/runs/run-detail');
  await expect(page.getByRole('heading', { name: 'Generated run' })).toBeVisible();
  await expect(page.locator('.job[data-job-id="run-detail"]')).toHaveAttribute('open', '');
  await expect(page.locator('.status')).toHaveText('completed');
  await expect(page.locator('.run-settings pre')).toContainText('detail-seed');
  await expect(page.locator('.run-settings pre')).toContainText('float_size');
  await expect(page.getByRole('link', { name: '← ALL RUNS' })).toHaveAttribute('href', '#/runs');
});

test('reports a queue error and makes the build button available again', async ({ page }) => {
  await mockReference(page);
  await page.route(jobsEndpoint, async (route) => {
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

test('shows five recent runs, paginates history, and reuses settings back on the builder', async ({ page }) => {
  await mockReference(page);
  const jobs = Array.from({ length: 21 }, (_, index) => ({
    id: `run-${21 - index}`,
    status: 'completed',
    createdAt: '2026-01-02T03:04:05Z',
    file: `/api/jobs/run-${21 - index}/download`,
    settings: { game: 'doom1', port: 'zdoom', theme: 'tech', length: 'single', seed: `seed-${21 - index}`, options: { walls: 'metal' } },
  }));
  await page.route(jobsEndpoint, async (route) => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get('offset') || 0);
    const limit = Number(url.searchParams.get('limit') || 5);
    await route.fulfill({ json: jobs.slice(offset, offset + limit) });
  });
  await page.goto('/');
  await expect(page.locator('.job[data-job-id]')).toHaveCount(5);
  await page.getByRole('link', { name: /VIEW ALL RUNS/ }).click();
  await expect(page).toHaveURL(/#\/runs$/);
  await expect(page.locator('.job[data-job-id]')).toHaveCount(20);
  await page.locator('.job[data-job-id="run-21"] > summary').click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/#\/runs\?page=2$/);
  await expect(page.locator('.job[data-job-id]')).toHaveCount(1);
  await page.locator('.job[data-job-id="run-1"] > summary').click();
  await page.getByRole('button', { name: 'Reuse settings' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('[name="core.game"]')).toHaveValue('doom1');
  await expect(page.locator('[name="core.port"]')).toHaveValue('zdoom');
  await expect(page.locator('[name="seed"]')).toHaveValue('seed-1');
  await page.locator('.option-group').filter({ hasText: 'architecture' }).locator('summary').click();
  await expect(page.locator('[name="option.walls"]')).toHaveValue('metal');
});
