import { expect, test } from '@playwright/test';

test('Author safely improves and restores the shared workflow configuration', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Prompts' }).click();

  await expect(
    page.getByRole('heading', { name: 'Shared workflow configuration' }),
  ).toBeVisible();
  await expect(page.getByText('Mock model catalog')).toBeVisible();

  const designPrompt = page.getByRole('textbox', {
    name: 'Design Brief Stage Prompt',
  });
  await designPrompt.fill(
    'Prioritise observed behaviour.\n\nSeparate evidence, assumptions, and open questions.',
  );
  await expect(
    page.getByRole('status', { name: 'Prompt Draft saved locally' }),
  ).toBeVisible();

  await page.reload();
  await expect(designPrompt).toHaveValue(
    'Prioritise observed behaviour.\n\nSeparate evidence, assumptions, and open questions.',
  );
  await expect(
    page.getByRole('region', { name: 'Compare prompt changes' }),
  ).toContainText('Active Stage Prompt');

  await page.getByRole('button', { name: 'Preview assembled request' }).click();
  const preview = page.getByRole('dialog', { name: 'Assembled request preview' });
  await expect(preview).toContainText('{insight_source}');
  await expect(preview).toContainText('attached by InsightForge');
  await preview.getByRole('button', { name: 'Close preview' }).click();

  await page.getByRole('button', { name: 'Save globally' }).click();
  await expect(
    page.getByRole('status', { name: 'Active Stage Configuration saved' }),
  ).toBeVisible();

  await designPrompt.fill('This edit should be discarded.');
  await expect(
    page.getByRole('status', { name: 'Prompt Draft saved locally' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Discard Prompt Draft' }).click();
  await expect(designPrompt).toHaveValue(
    'Prioritise observed behaviour.\n\nSeparate evidence, assumptions, and open questions.',
  );

  await designPrompt.fill('A Prompt Draft saved while switching stages.');
  await page.getByRole('tab', { name: 'PRD' }).click();
  await page.getByRole('tab', { name: 'Design Brief' }).click();
  await expect(designPrompt).toHaveValue(
    'A Prompt Draft saved while switching stages.',
  );
  await page.getByRole('button', { name: 'Discard Prompt Draft' }).click();

  await page.getByRole('tab', { name: 'Concept Screens' }).click();
  await page.getByLabel('Image quality').selectOption('high');
  await page.getByRole('button', { name: 'Save globally' }).click();
  await expect(page.getByLabel('Image quality')).toHaveValue('high');

  const importedConfiguration = {
    schemaVersion: 1,
    stages: [
      {
        id: 'design_brief',
        prompt: 'Imported Design Brief instructions.',
        model: 'gpt-5.6-luna',
        imageQuality: null,
      },
      {
        id: 'concept_screens',
        prompt: 'Imported Concept Screen instructions.',
        model: 'gpt-image-2',
        imageQuality: 'low',
      },
      {
        id: 'prd',
        prompt: 'Imported PRD instructions.',
        model: 'gpt-5.6-luna',
        imageQuality: null,
      },
    ],
  };
  await page.getByLabel('Import Workflow Configuration file').setInputFiles({
    name: 'workflow.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(importedConfiguration)),
  });
  const importDialog = page.getByRole('dialog', {
    name: 'Import Workflow Configuration?',
  });
  await importDialog.getByRole('button', { name: 'Import configuration' }).click();
  await page.getByRole('tab', { name: 'Design Brief' }).click();
  await expect(designPrompt).toHaveValue('Imported Design Brief instructions.');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export configuration' }).click();
  expect((await download).suggestedFilename()).toBe(
    'insightforge-workflow-configuration.json',
  );

  await page.getByRole('button', { name: 'Reset entire workflow' }).click();
  const resetDialog = page.getByRole('dialog', {
    name: 'Reset entire workflow?',
  });
  await expect(resetDialog).toContainText('all three active Stage Configurations');
  await expect(resetDialog).toContainText('Low → Medium');
  await resetDialog.getByRole('button', { name: 'Reset workflow' }).click();
  await expect(designPrompt).toHaveValue(/experienced product designer/);
});
