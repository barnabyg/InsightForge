import { expect, test } from '@playwright/test';

async function createProjectWithDesignBrief(page: import('@playwright/test').Page, insight: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('textbox', { name: 'Insight Source' }).fill(insight);
  await expect(page.getByRole('status', { name: 'Insight Source saved' })).toBeVisible();
  await page.getByRole('button', { name: /Design Brief/ }).click();
  await page.getByRole('button', { name: 'Generate Design Brief' }).click();
  await expect(page.getByRole('article', { name: 'Design Brief Artifact' })).toBeVisible();
}

test('Author generates and inspects a persisted coordinated Concept Screen Set', async ({ page }) => {
  await createProjectWithDesignBrief(
    page,
    'Homeowners need to compare retrofit proposals, inspect trade-offs, and record a defensible choice.',
  );
  await page.getByRole('button', { name: /Concept Screens/ }).click();
  await expect(page.getByRole('heading', { name: 'Concept Screens' })).toBeVisible();
  await expect(page.getByText('gpt-image-2')).toBeVisible();

  await page.getByRole('button', { name: 'Generate Concept Screens' }).click();
  await expect(page.getByRole('status', { name: 'Generating Concept Screens' })).toBeVisible();
  await expect(page.getByText(/Screen [1-3] of 3/)).toBeVisible();

  const gallery = page.getByRole('article', { name: 'Concept Screen Set' });
  await expect(gallery).toBeVisible();
  await expect(gallery.getByRole('img')).toHaveCount(3);
  await expect(gallery.getByRole('link', { name: /Download Concept Screen/ })).toHaveCount(3);
  await expect(gallery.locator('figcaption').getByText('1024 × 768')).toHaveCount(3);

  const inspector = page.getByRole('complementary', { name: 'Run Inspector' });
  await expect(inspector).toContainText('Succeeded');
  await expect(inspector).toContainText('gpt-image-2');
  await expect(inspector).toContainText('Medium');
  await expect(inspector).toContainText('3 of 3 PNGs');
  await expect(inspector).toContainText('mock_req_image_3_');

  await gallery.getByRole('button', { name: 'Inspect Concept Screen 1' }).click();
  const focus = page.getByRole('dialog', { name: 'Concept Screen 1' });
  await expect(focus.getByRole('img', { name: 'Concept Screen 1' })).toBeVisible();
  await expect(focus.getByText('100%')).toBeVisible();
  await focus.getByRole('button', { name: 'Zoom in' }).click();
  await expect(focus.getByText('125%')).toBeVisible();
  await focus.getByRole('button', { name: 'Reset zoom' }).click();
  await expect(focus.getByText('100%')).toBeVisible();
  await focus.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: /Design Brief/ }).click();
  await expect(page.getByRole('button', { name: 'Regenerate from here' })).toBeDisabled();
  await page.getByRole('button', { name: 'Generate another variation' }).click();
  const cascadePreview = page.getByRole('dialog', { name: 'Rerun downstream workflow?' });
  await expect(cascadePreview).toContainText('new Design Brief');
  await expect(cascadePreview).toContainText('three new Concept Screens');
  await cascadePreview.getByRole('button', { name: 'Cancel' }).click();

  await page.reload();
  await page.getByRole('button', { name: /Concept Screens/ }).click();
  await expect(page.getByRole('article', { name: 'Concept Screen Set' }).getByRole('img'))
    .toHaveCount(3);
  await page.getByRole('link', { name: 'All projects' }).click();
  await expect(page.getByRole('article').filter({
    hasText: 'Homeowners need to compare retrofit proposals',
  })).toContainText('Concept Screens ready');
});

test('Author resumes a partial Concept Screen Set after a safe failure', async ({ page }) => {
  await createProjectWithDesignBrief(
    page,
    '[mock:image-failure-once-2] A comparison journey that exercises explicit resume.',
  );
  await page.getByRole('button', { name: /Concept Screens/ }).click();
  await page.getByRole('button', { name: 'Generate Concept Screens' }).click();

  const inspector = page.getByRole('complementary', { name: 'Run Inspector' });
  await expect(inspector).toContainText('Failed');
  await expect(inspector).toContainText('1 of 3 PNGs');
  await expect(inspector).toContainText('mock_req_screen_2_failed');
  await expect(page.getByRole('article', { name: 'Concept Screen Set' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Resume from Screen 2' }).click();
  await expect(page.getByRole('article', { name: 'Concept Screen Set' })).toBeVisible();
  await expect(inspector).toContainText('Succeeded');
  await expect(inspector).toContainText('3 of 3 PNGs');
});

test('Author cancels before the next Concept Screen and can resume', async ({ page }) => {
  await createProjectWithDesignBrief(
    page,
    'A journey used to verify explicit cancellation between image operations.',
  );
  await page.getByRole('button', { name: /Concept Screens/ }).click();
  await page.getByRole('button', { name: 'Generate Concept Screens' }).click();
  await expect(page.getByText('Screen 1 of 3')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel after current screen' }).click();

  const inspector = page.getByRole('complementary', { name: 'Run Inspector' });
  await expect(inspector).toContainText('Cancelled');
  await expect(page.getByRole('button', { name: /Resume from Screen/ })).toBeVisible();
  await page.getByRole('button', { name: /Resume from Screen/ }).click();
  await expect(page.getByRole('article', { name: 'Concept Screen Set' })).toBeVisible();
  await expect(inspector).toContainText('Succeeded');
});
