import { expect, test } from '@playwright/test';

async function createProject(page: import('@playwright/test').Page, insight: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('textbox', { name: 'Insight Source' }).fill(insight);
  await expect(page.getByRole('status', { name: 'Insight Source saved' })).toBeVisible();
}

async function startFullGeneration(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Generate complete workflow' }).click();
  const preview = page.getByRole('dialog', { name: 'Generate complete workflow?' });
  await expect(preview).toContainText('gpt-5.6-luna');
  await expect(preview).toContainText('gpt-image-2');
  await expect(preview).toContainText('5 operations');
  await preview.getByRole('button', { name: 'Start 5 operations' }).click();
}

test('Author generates the complete workflow atomically with one action', async ({ page }) => {
  await createProject(
    page,
    'Authors need a bounded way to turn one product insight into a coherent planning workflow.',
  );
  await page.evaluate(() => {
    const observed: string[] = [];
    (window as typeof window & { fullGenerationAnnouncements?: string[] })
      .fullGenerationAnnouncements = observed;
    new MutationObserver(() => {
      const announcement = document.querySelector(
        '[role="status"][aria-label="Generating complete workflow"]',
      )?.textContent;
      if (announcement && observed.at(-1) !== announcement) observed.push(announcement);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });

  await startFullGeneration(page);

  const progress = page.getByRole('status', { name: 'Generating complete workflow' });
  await expect(progress).toBeVisible();
  await expect(progress).toContainText(/Design Brief|Concept Screens|PRD/);
  await expect(page.getByRole('button', { name: 'Cancel after current operation' })).toBeVisible();
  await expect(progress).toHaveCount(0, { timeout: 15_000 });
  const announcements = await page.evaluate(() => (
    window as typeof window & { fullGenerationAnnouncements?: string[] }
  ).fullGenerationAnnouncements ?? []);
  expect(announcements.some((announcement) => (
    announcement.includes('Validating Candidate Workflow')
  ))).toBe(true);
  expect(announcements.some((announcement) => (
    announcement.includes('Promoting Candidate Workflow')
  ))).toBe(true);

  await expect(page.getByRole('button', { name: /Design Brief/ })).toContainText('Current');
  await expect(page.getByRole('button', { name: /Concept Screens/ })).toContainText('Current');
  await expect(page.getByRole('button', { name: /PRD/ })).toContainText('Current');
  await page.getByRole('button', { name: /PRD/ }).click();
  await expect(page.getByRole('article', { name: 'PRD Artifact' })).toContainText('FR-001');
});

test('Author regenerates an affected suffix and deliberately requests a Variation Run', async ({ page }) => {
  await createProject(
    page,
    'Safe rerun demonstration\nA changed prompt must never produce a mixed current workflow.',
  );
  await startFullGeneration(page);
  await expect(page.getByRole('status', { name: 'Generating complete workflow' }))
    .toBeVisible();
  await expect(page.getByRole('status', { name: 'Generating complete workflow' }))
    .toHaveCount(0, { timeout: 15_000 });

  await page.getByRole('link', { name: 'All projects' }).click();
  await page.getByRole('link', { name: 'Prompts' }).click();
  const designPrompt = page.getByRole('textbox', { name: 'Design Brief Stage Prompt' });
  await designPrompt.fill(`${await designPrompt.inputValue()}\nMake trade-offs explicit.`);
  await page.getByRole('button', { name: 'Save globally' }).click();
  await expect(page.getByRole('status', { name: 'Active Stage Configuration saved' }))
    .toBeVisible();
  await page.getByRole('link', { name: 'Projects' }).click();
  const projectCard = page.getByRole('article', { name: 'Safe rerun demonstration' });
  await expect(projectCard).toContainText('Update Available');
  await projectCard.getByRole('button', { name: /Safe rerun demonstration/ }).click();

  await expect(page.getByRole('button', { name: /Design Brief/ }))
    .toContainText('Update Available');
  await expect(page.getByRole('button', { name: /Concept Screens/ }))
    .toContainText('Affected');
  await page.getByRole('button', { name: /Design Brief/ }).click();
  const update = page.getByRole('status', { name: 'Update available' });
  await expect(update).toContainText('shared Stage Prompt changed');
  await expect(update).toContainText('Design Brief, Concept Screens, PRD together');
  await update.getByText('Inspect fingerprints').click();
  await expect(update.getByText(/Previous input: [a-f0-9]{64}/)).toBeVisible();
  await expect(update.getByText(/Current prompt: [a-f0-9]{64}/)).toBeVisible();

  await page.getByRole('button', { name: 'Regenerate from here' }).click();
  const regeneration = page.getByRole('dialog', { name: 'Regenerate from Design Brief?' });
  await expect(regeneration).toContainText('5 OpenAI operations');
  await expect(regeneration).toContainText('Workflow Snapshot');
  await regeneration.getByRole('button', { name: 'Start regeneration' }).click();
  await expect(page.getByRole('status', { name: 'Update available' }))
    .toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: /PRD/ })).toContainText('Current');

  await page.getByRole('button', { name: /PRD/ }).click();
  await page.getByRole('button', { name: 'Generate another variation' }).click();
  const variation = page.getByRole('dialog', { name: 'Generate another PRD variation?' });
  await expect(variation).toContainText('identical to the current run');
  await expect(variation).toContainText('1 OpenAI operation');
  await variation.getByRole('button', { name: 'Generate Variation Run' }).click();
  await expect(page.getByRole('status', { name: 'Generating complete workflow' }))
    .toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('complementary', { name: 'Run Inspector' }))
    .toContainText('Variation Run');
});

test('Author resumes a failed Candidate Workflow without regenerating completed work', async ({ page }) => {
  await createProject(
    page,
    '[mock:image-failure-once-2] A full workflow that fails safely during its second image operation.',
  );

  await startFullGeneration(page);

  await expect(page.getByRole('status').filter({
    hasText: 'Candidate generation failed',
  })).toContainText('2 of 5 operations complete', { timeout: 15_000 });
  await expect(page.getByRole('button', { name: /Design Brief/ })).not.toContainText('Current');
  await page.getByRole('button', { name: 'Resume Candidate Workflow' }).click();
  await expect(page.getByRole('status', { name: 'Generating complete workflow' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Generating complete workflow' }))
    .toHaveCount(0, { timeout: 15_000 });

  await page.getByRole('button', { name: /Concept Screens/ }).click();
  await expect(page.getByRole('article', { name: 'Concept Screen Set' }).getByRole('img'))
    .toHaveCount(3);
  const inspector = page.getByRole('complementary', { name: 'Run Inspector' });
  await expect(inspector).toContainText('Prior generation attempts');
  await expect(inspector).toContainText('mock_req_screen_2_failed');
});

test('Author reviews sanity warnings before promoting a complete Candidate Workflow', async ({ page }) => {
  await createProject(
    page,
    '[mock:prd-short] A complete candidate with a deliberately thin PRD for warning review.',
  );

  await startFullGeneration(page);

  const warningReview = page.getByRole('status').filter({
    hasText: 'Candidate ready for warning review',
  });
  await expect(warningReview).toContainText('1 sanity warning', { timeout: 15_000 });
  await expect(warningReview).toContainText('recommended minimum is 250');
  await expect(page.getByRole('button', { name: /PRD/ })).not.toContainText('Current');
  await page.getByRole('button', { name: 'Keep Candidate Workflow' }).click();
  const keptCandidate = page.getByRole('status').filter({
    hasText: 'Candidate kept for later',
  });
  await expect(keptCandidate).toContainText('1 sanity warning');
  await expect(page.getByRole('button', { name: /PRD/ })).not.toContainText('Current');
  await page.getByRole('button', { name: 'Promote Candidate Workflow' }).click();

  await expect(warningReview).toHaveCount(0);
  await page.getByRole('button', { name: /PRD/ }).click();
  await expect(page.getByRole('article', { name: 'PRD Artifact' })).toBeVisible();
});
