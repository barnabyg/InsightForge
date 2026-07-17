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
  await restorationSnapshot.getByRole('button', { name: 'Delete snapshot' }).click();
  const deletion = page.getByRole('dialog', { name: 'Delete Workflow Snapshot?' });
  await expect(deletion).toContainText('unreferenced Concept Screen files');
  await deletion.getByRole('button', { name: 'Delete Workflow Snapshot' }).click();
  await expect(page.getByRole('button', { name: 'Workflow history, 1 snapshot' })).toBeVisible();
});
