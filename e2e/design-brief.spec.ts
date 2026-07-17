import { expect, test } from '@playwright/test';

test('Author generates and inspects a persisted read-only Design Brief', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('textbox', { name: 'Insight Source' }).fill(
    'Homeowners cannot compare energy retrofit proposals because costs, assumptions, and long-term trade-offs are presented inconsistently.',
  );
  await expect(page.getByRole('status', { name: 'Insight Source saved' }))
    .toBeVisible();

  await page.getByRole('button', { name: /Design Brief/ }).click();
  await expect(page.getByRole('heading', { name: 'Design Brief' })).toBeVisible();
  await expect(page.getByText('gpt-5.6-luna')).toBeVisible();
  await expect(page.getByText('Add an Insight Source before generating'))
    .not.toBeVisible();

  await page.getByRole('button', { name: 'Generate Design Brief' }).click();
  await expect(
    page.getByRole('status', { name: 'Generating Design Brief' }),
  ).toBeVisible();
  await expect(
    page.getByRole('article', { name: 'Design Brief Artifact' }),
  ).toContainText('Problem or opportunity');
  await expect(page.getByText('Read-only Artifact')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Design Brief Artifact' }))
    .toHaveCount(0);

  const inspector = page.getByRole('complementary', { name: 'Run Inspector' });
  await expect(inspector).toContainText('Succeeded');
  await expect(inspector).toContainText('gpt-5.6-luna');
  await expect(inspector).toContainText('Input tokens');
  await expect(inspector).toContainText('Output tokens');
  await expect(inspector).toContainText('mock_req_');
  await expect(inspector).toContainText(/\d+ words/);

  await page.getByRole('link', { name: 'All projects' }).click();
  const generatedProject = page.getByRole('article').filter({
    hasText: 'Homeowners cannot compare energy retrofit proposals',
  });
  await expect(generatedProject).toContainText('Design Brief ready');
  await generatedProject.getByRole('button', { name: /Homeowners cannot compare/ }).click();
  await page.getByRole('button', { name: /Design Brief/ }).click();
  await expect(
    page.getByRole('article', { name: 'Design Brief Artifact' }),
  ).toContainText('Scope and non-goals');

  await page.reload();
  await page.getByRole('button', { name: /Design Brief/ }).click();
  await expect(
    page.getByRole('article', { name: 'Design Brief Artifact' }),
  ).toContainText('Scope and non-goals');
  await page.getByRole('button', { name: /Insight Source/ }).click();
  await expect(page.getByRole('textbox', { name: 'Insight Source' }))
    .toHaveAttribute('readonly', '');
  await expect(page.getByText('Insight Source is locked after generation'))
    .toBeVisible();
  await expect(page.getByRole('button', { name: 'Begin Insight Revision' }))
    .toBeVisible();
  await page.getByRole('link', { name: 'All projects' }).click();
  await expect(page.getByRole('article').filter({
    hasText: 'Homeowners cannot compare energy retrofit proposals',
  })).toContainText('Design Brief ready');
});

test('Author sees thin-output warnings and safe failure diagnostics', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create project' }).click();
  const insight = page.getByRole('textbox', { name: 'Insight Source' });
  await insight.fill('[mock:short] A deliberately thin product signal.');
  await expect(page.getByRole('status', { name: 'Insight Source saved' }))
    .toBeVisible();
  await page.getByRole('button', { name: /Design Brief/ }).click();
  await page.getByRole('button', { name: 'Generate Design Brief' }).click();

  const inspector = page.getByRole('complementary', { name: 'Run Inspector' });
  await expect(inspector).toContainText('Sanity Warning');
  await expect(inspector).toContainText('recommended minimum is 250');
  const acceptedArtifact = page.getByRole('article', { name: 'Design Brief Artifact' });
  await expect(acceptedArtifact).toContainText('deliberately short mock result');
});

test('Author sees safe diagnostics when Design Brief generation fails', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('textbox', { name: 'Insight Source' }).fill(
    '[mock:failure] Simulate an unavailable OpenAI request.',
  );
  await expect(page.getByRole('status', { name: 'Insight Source saved' }))
    .toBeVisible();
  await page.getByRole('button', { name: /Design Brief/ }).click();
  await page.getByRole('button', { name: 'Generate Design Brief' }).click();

  const inspector = page.getByRole('complementary', { name: 'Run Inspector' });
  await expect(page.getByRole('alert').filter({
    hasText: 'OpenAI could not generate the Design Brief.',
  }).first()).toContainText(
    'OpenAI could not generate the Design Brief.',
  );
  await expect(inspector).toContainText('Failed');
  await expect(inspector).toContainText('openai_request_failed');
  await expect(inspector).toContainText('mock_req_failure');
  await expect(page.getByRole('article', { name: 'Design Brief Artifact' }))
    .toHaveCount(0);
});
