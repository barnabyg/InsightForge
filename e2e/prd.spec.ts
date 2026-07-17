import { expect, test } from '@playwright/test';

test('Author generates and inspects a persisted PRD from the Design Brief and Concept Screens', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('textbox', { name: 'Insight Source' }).fill(
    'Homeowners need to compare retrofit proposals, understand material trade-offs, and preserve a defensible decision.',
  );
  await expect(page.getByRole('status', { name: 'Insight Source saved' })).toBeVisible();

  await page.getByRole('button', { name: /Design Brief/ }).click();
  await page.getByRole('button', { name: 'Generate Design Brief' }).click();
  await expect(page.getByRole('article', { name: 'Design Brief Artifact' })).toBeVisible();

  await page.getByRole('button', { name: /Concept Screens/ }).click();
  await page.getByRole('button', { name: 'Generate Concept Screens' }).click();
  await expect(page.getByRole('article', { name: 'Concept Screen Set' })).toBeVisible();

  await page.getByRole('button', { name: /PRD/ }).click();
  await expect(page.getByRole('heading', { name: 'PRD', exact: true })).toBeVisible();
  await expect(page.getByText('gpt-5.6-luna')).toBeVisible();
  await page.getByRole('button', { name: 'Generate PRD' }).click();
  await expect(page.getByRole('status', { name: 'Generating PRD' })).toBeVisible();

  const artifact = page.getByRole('article', { name: 'PRD Artifact' });
  await expect(artifact).toBeVisible();
  await expect(artifact).toContainText('Product Requirements Document');
  await expect(artifact).toContainText('FR-001');
  await expect(artifact.getByRole('button', { name: 'Download .md' })).toBeVisible();

  const inspector = page.getByRole('complementary', { name: 'Run Inspector' });
  await expect(inspector).toContainText('Succeeded');
  await expect(inspector).toContainText('gpt-5.6-luna');
  await expect(inspector).toContainText('3 Concept Screens');
  await expect(inspector).toContainText('Design Brief run');
  await expect(inspector).toContainText('Concept Screen Set run');
  await expect(inspector).toContainText('Screen 1 asset');
  await expect(inspector).toContainText('Screen 2 asset');
  await expect(inspector).toContainText('Screen 3 asset');
  await expect(inspector).toContainText('mock_req_');

  await page.reload();
  await page.getByRole('button', { name: /PRD/ }).click();
  await expect(page.getByRole('article', { name: 'PRD Artifact' })).toContainText('FR-001');
  await page.getByRole('link', { name: 'All projects' }).click();
  const projectCard = page.getByRole('article').filter({
    hasText: 'understand material trade-offs',
  });
  await expect(projectCard).toContainText('PRD ready');
  await projectCard.getByRole('button', { name: 'Rename project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Retrofit decisions');
  await page.getByRole('button', { name: 'Save name' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('article', { name: 'Retrofit decisions' })
    .getByRole('link', { name: 'Export project deliverables' }).click();
  expect((await download).suggestedFilename()).toBe(
    'retrofit-decisions-deliverables.zip',
  );
});

test('Author sees safe diagnostics when PRD generation fails once', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('textbox', { name: 'Insight Source' }).fill(
    '[mock:prd-failure] Simulate an unavailable OpenAI PRD request.',
  );
  await expect(page.getByRole('status', { name: 'Insight Source saved' }))
    .toBeVisible();

  await page.getByRole('button', { name: /Design Brief/ }).click();
  await page.getByRole('button', { name: 'Generate Design Brief' }).click();
  await expect(page.getByRole('article', { name: 'Design Brief Artifact' })).toBeVisible();

  await page.getByRole('button', { name: /Concept Screens/ }).click();
  await page.getByRole('button', { name: 'Generate Concept Screens' }).click();
  await expect(page.getByRole('article', { name: 'Concept Screen Set' })).toBeVisible();

  await page.getByRole('button', { name: /PRD/ }).click();
  await page.getByRole('button', { name: 'Generate PRD' }).click();

  const inspector = page.getByRole('complementary', { name: 'Run Inspector' });
  await expect(page.getByRole('alert').filter({
    hasText: 'OpenAI could not generate the PRD.',
  }).first()).toContainText('OpenAI could not generate the PRD.');
  await expect(inspector).toContainText('Failed');
  await expect(inspector).toContainText('openai_request_failed');
  await expect(inspector).toContainText('mock_req_prd_failure');
  await expect(page.getByRole('article', { name: 'PRD Artifact' })).toHaveCount(0);
});
