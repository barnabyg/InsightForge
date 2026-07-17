import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';

test('Author creates, imports, saves, and manages Projects', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(
    page.getByRole('heading', { name: 'Untitled Project' }),
  ).toBeVisible();

  const insight = page.getByRole('textbox', { name: 'Insight Source' });
  await insight.fill(
    'Reduce uncertainty in home energy upgrades\nPeople cannot compare installer proposals.',
  );
  await expect(
    page.getByRole('status', { name: 'Insight Source has unsaved changes' }),
  ).toBeVisible();
  await expect(page.getByRole('status', { name: 'Insight Source saved' }))
    .toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Reduce uncertainty in home energy upgrades' }),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Insight Source' })).toHaveValue(
    'Reduce uncertainty in home energy upgrades\nPeople cannot compare installer proposals.',
  );

  await page.getByLabel('Import Insight Source file').setInputFiles({
    name: 'research-note.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Installer confidence\n\nQuotes hide important trade-offs.'),
  });
  const replaceDialog = page.getByRole('dialog', { name: 'Replace Insight Source?' });
  await expect(replaceDialog).toBeVisible();
  await replaceDialog.getByRole('button', { name: 'Replace insight' }).click();
  await expect(insight).toHaveValue(
    '# Installer confidence\n\nQuotes hide important trade-offs.',
  );
  await expect(page.getByRole('status', { name: 'Insight Source saved' }))
    .toBeVisible();

  await page.getByRole('link', { name: 'All projects' }).click();
  const projectCard = page.getByRole('article', { name: 'Installer confidence' });
  await projectCard.getByRole('button', { name: 'Rename project' }).click();
  const renameDialog = page.getByRole('dialog', { name: 'Rename Project' });
  await renameDialog.getByRole('textbox', { name: 'Project name' }).fill(
    'Confident retrofit choices',
  );
  await renameDialog.getByRole('button', { name: 'Save name' }).click();

  const renamedCard = page.getByRole('article', {
    name: 'Confident retrofit choices',
  });
  const projectExportDownload = page.waitForEvent('download');
  await renamedCard.getByRole('link', { name: 'Export Project' }).click();
  const projectExport = await projectExportDownload;
  expect(projectExport.suggestedFilename()).toBe(
    'confident-retrofit-choices-project-export.zip',
  );
  const projectExportPath = await projectExport.path();
  expect(projectExportPath).not.toBeNull();
  const projectExportFiles = unzipSync(await readFile(projectExportPath!));
  expect(JSON.parse(strFromU8(projectExportFiles['manifest.json']))).toMatchObject({
    format: 'insightforge.project-export',
    schemaVersion: 1,
    project: { name: 'Confident retrofit choices' },
  });
  expect(JSON.parse(strFromU8(projectExportFiles['project.json']))).toMatchObject({
    project: {
      name: 'Confident retrofit choices',
      insightSource: '# Installer confidence\n\nQuotes hide important trade-offs.',
    },
  });

  await renamedCard.getByRole('button', { name: 'Duplicate project' }).click();
  await expect(
    page.getByRole('article', { name: 'Confident retrofit choices — Copy' }),
  ).toBeVisible();

  const copyCard = page.getByRole('article', {
    name: 'Confident retrofit choices — Copy',
  });
  await copyCard.getByRole('button', { name: 'Delete project' }).click();
  const deleteDialog = page.getByRole('dialog', { name: 'Delete Project?' });
  await expect(deleteDialog).toContainText('cannot be undone');
  await deleteDialog.getByRole('button', { name: 'Delete project' }).click();

  await expect(copyCard).not.toBeVisible();
  await expect(renamedCard).toBeVisible();

  await renamedCard.getByRole('button', { name: /Confident retrofit choices/ }).click();
  await page.getByRole('textbox', { name: 'Insight Source' }).fill(
    'A final observation saved while leaving the workspace.',
  );
  await page.getByRole('link', { name: 'All projects' }).click();
  await page
    .getByRole('article', { name: 'Confident retrofit choices' })
    .getByRole('button', { name: /Confident retrofit choices/ })
    .click();
  await expect(page.getByRole('textbox', { name: 'Insight Source' })).toHaveValue(
    'A final observation saved while leaving the workspace.',
  );

  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'Recent lines of thought' }),
  ).toBeVisible();
});
