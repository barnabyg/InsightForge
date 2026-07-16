import { expect, test } from '@playwright/test';

test('Author understands the local and OpenAI boundary when the app launches', async ({
  page,
}) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'Turn an insight into a product direction.' }),
  ).toBeVisible();
  await expect(page.getByText('Mock mode')).toBeVisible();
  await expect(page.getByRole('status', { name: 'OpenAI connected' })).toBeVisible();
  await expect(page.getByText('Projects stay on this device.')).toBeVisible();
  await expect(
    page.getByText(
      'When you generate, only the assembled prompt and required stage inputs are sent to OpenAI.',
    ),
  ).toBeVisible();

  const refreshResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/connectivity/refresh')
      && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Refresh OpenAI connectivity' }).click();
  expect((await refreshResponse).status()).toBe(200);
  await expect(page.getByRole('status', { name: 'OpenAI connected' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Privacy and OpenAI boundary')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh OpenAI connectivity' }))
    .toBeVisible();
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
});
