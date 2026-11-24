import { expect, test } from '@playwright/test';

test('Author inspects, restores, and deletes Workflow Snapshots from compact history', async ({ page }) => {
  const created = await page.request.post('/api/projects', {
    headers: { host: 'localhost:4317' },
    data: {
      name: 'Manage snapshot history',
      insightSource: 'Authors need deliberate access to coherent historical workflows.',
    },
  });
  const projectId = (await created.json()).id as string;
  for (const path of [
    'full-generations',
    'full-generations/resume',
    'full-generations/resume',
    'full-generations/promotion',
  ]) {
    await page.request.post(`/api/projects/${projectId}/${path}`, {
      headers: { host: 'localhost:4317' },
    });
  }
  await page.request.post(`/api/projects/${projectId}/workflow-reruns`, {
    headers: { host: 'localhost:4317' },
    data: { stageId: 'prd' },
  });
  await page.request.post(`/api/projects/${projectId}/full-generations/promotion`, {
    headers: { host: 'localhost:4317' },
  });

  await page.goto(`/?project=${projectId}`);
  const historyTrigger = page.getByRole('button', { name: 'Workflow history, 1 snapshot' });
  await expect(historyTrigger.locator('[aria-hidden="true"]')).toHaveText('◷');
  await historyTrigger.focus();
  await page.keyboard.press('Enter');
  let history = page.getByRole('complementary', { name: 'Workflow history' });
  const closeHistory = history.getByRole('button', { name: 'Close history' });
  await expect(closeHistory).toBeFocused();
  await closeHistory.click();
  await expect(historyTrigger).toBeFocused();
  await historyTrigger.click();
  history = page.getByRole('complementary', { name: 'Workflow history' });
  await expect(history).toContainText('Preserved before PRD replacement');
  await expect(history).toContainText('gpt-5.6-luna');
  await expect(history.getByRole('button', { name: /Compare|Branch|Merge/ })).toHaveCount(0);

  await history.getByRole('button', { name: 'Inspect snapshot' }).click();
  await expect(history.getByRole('heading', { name: 'Snapshot inspection' })).toBeVisible();
  await expect(history.getByRole('textbox', { name: 'Snapshot Insight Source' }))
    .toHaveValue('Authors need deliberate access to coherent historical workflows.');
  await expect(history.getByRole('article', { name: 'PRD snapshot Artifact' }))
    .toContainText('# Product Requirements Document');

  await history.getByRole('button', { name: 'Restore snapshot' }).click();
  const restore = page.getByRole('dialog', { name: 'Restore Workflow Snapshot?' });
  await expect(restore).toContainText('current workflow will be preserved');
  await expect(restore).toContainText('shared Stage Configurations will not change');
  await restore.getByRole('button', { name: 'Restore Workflow Snapshot' }).click();

  await page.getByRole('button', { name: 'Workflow history, 2 snapshots' }).click();
  const updatedHistory = page.getByRole('complementary', { name: 'Workflow history' });
  const restorationSnapshot = updatedHistory.getByRole('article').first();
  await expect(restorationSnapshot).toContainText('Preserved before snapshot restoration');
  await restorationSnapshot.getByRole('button', { name: 'Inspect snapshot' }).click();
  await expect(updatedHistory.getByRole('heading', { name: 'Snapshot inspection' })).toBeVisible();
  await updatedHistory.getByRole('button', { name: 'Delete snapshot' }).click();
  const deletion = page.getByRole('dialog', { name: 'Delete Workflow Snapshot?' });
  await expect(deletion).toContainText('unreferenced Concept Screen files');
  await deletion.getByRole('button', { name: 'Delete Workflow Snapshot' }).click();
  await expect(page.getByRole('button', { name: 'Workflow history, 1 snapshot' })).toBeVisible();
  await expect(updatedHistory.getByRole('heading', { name: 'Workflow Snapshots' })).toBeVisible();
  await expect(updatedHistory.getByRole('heading', { name: 'Snapshot inspection' })).toHaveCount(0);
});

test('restored backups reopen with all artifacts and their preserved history', async ({ page }, testInfo) => {
  await page.goto('/');
  const upload = page.getByLabel('Import Project file');
  const imported = page.waitForResponse(response => response.url().endsWith('/api/project-imports'));
  await upload.setInputFiles('e2e/fixtures/restored-project-v1.zip');
  expect((await imported).status()).toBe(201);
  const card = page.getByRole('article', { name: /Review backup integrity/ }).first();
  await card.getByRole('button', { name: /Open Project/ }).click();
  await page.getByRole('button', { name: 'Workflow history, 2 snapshots' }).click();
  await page.getByRole('button', { name: 'Restore snapshot' }).last().click();
  await page.getByRole('button', { name: 'Restore Workflow Snapshot', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Workflow history, 3 snapshots' })).toBeVisible();
  await page.getByRole('link', { name: 'All projects' }).click();
  const originalExport = await card.locator('a[download]').first().getAttribute('href');
  const downloading = page.waitForEvent('download');
  await card.getByRole('link', { name: /^(Back up project|Export Project)$/i }).click();
  const file = testInfo.outputPath('restored.zip');
  await (await downloading).saveAs(file);
  const reimport = page.waitForResponse(response => response.url().endsWith('/api/project-imports'));
  await upload.setInputFiles(file);
  const response = await reimport;
  expect(response.status()).toBe(201);
  const copy = page.getByRole('article', { name: /Review backup integrity/ })
    .filter({ hasNot: page.locator(`a[href="${originalExport}"]`) });
  await copy.getByRole('button', { name: /Open Project/ }).click();
  await expect(page.getByRole('button', { name: 'Workflow history, 3 snapshots' })).toBeVisible();
  const rail = page.getByRole('complementary', { name: 'Project stages' });
  await rail.getByRole('button', { name: /Design Brief/ }).click();
  await expect(page.getByRole('article', { name: 'Design Brief Artifact' })).toBeVisible();
  await rail.getByRole('button', { name: /Concept Screens/ }).click();
  await expect(page.getByRole('article', { name: 'Concept Screen Set' }).getByRole('img')).toHaveCount(3);
  await rail.getByRole('button', { name: /PRD/ }).click();
  await expect(page.getByRole('article', { name: 'PRD Artifact' })).toContainText('FR-001');
});
