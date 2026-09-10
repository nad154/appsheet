import { test, expect } from '@playwright/test';

async function login(page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/grid/, { timeout: 15000 });
}

// Unique per run so leftover views from earlier (possibly crashed) runs can
// never collide with the card this run creates or asserts on.
function uniqueViewLabel(prefix: string): string {
  return `${prefix} ${Date.now()}`;
}

// Clicking a pie sector must open the drill-down panel listing the projects
// behind that slice; clicking a project navigates to the grid and flashes the
// matching row.
test('admin drills into a pie slice and lands on the highlighted grid row', async ({ page }) => {
  await login(page, 'admin@example.com', 'admin12345');

  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await page.getByRole('button', { name: 'Add view' }).click();
  await page.getByLabel('Chart type').selectOption({ label: 'Pie' });
  await page.getByLabel('Column').selectOption({ label: 'Stage' });
  const label = uniqueViewLabel('E2E Drilldown Stage');
  await page.getByLabel('Display label').fill(label);
  await page.getByRole('button', { name: 'Add view' }).click();

  const card = page.getByRole('heading', { name: label });
  await expect(card).toBeVisible();

  // The dashboard may already hold seed/leftover charts, so scope the click to
  // this card's own pie (recharts sectors are <path class="recharts-sector">).
  const chartCard = card.locator('xpath=ancestor::div[contains(@class, "border-gray-200")]');
  await chartCard.locator('.recharts-sector').first().click();

  const panel = page.getByTestId('drill-down-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/^Projects — /)).toBeVisible();

  // Pick the first project in the panel and jump to it in the grid.
  const projectButton = panel.locator('ul button').first();
  const projectName = (await projectButton.textContent())?.trim() ?? '';
  expect(projectName.length).toBeGreaterThan(0);

  await projectButton.click();
  await expect(page).toHaveURL(/\/grid/, { timeout: 15000 });

  // The row is scrolled into view and flashed (data-testid only while active),
  // and it carries the project name clicked in the panel.
  const highlighted = page.getByTestId('highlighted-row');
  await expect(highlighted).toBeVisible({ timeout: 15000 });
  await expect(highlighted).toContainText(projectName);

  // The sticky Project Info cells run their own opaque yellow→white flash; the
  // flash's row-flash-sticky animation temporarily overrides their inline white
  // background. Sample the first (Project) cell's computed background over the
  // remaining flash window and require at least one non-white reading.
  const stickyCell = highlighted.locator('div[role="cell"]').first();
  const sawStickyFlash = await stickyCell.evaluate((el: HTMLElement) => {
    return new Promise<boolean>((resolve) => {
      const start = performance.now();
      const check = () => {
        const color = getComputedStyle(el).backgroundColor;
        if (color && color !== 'rgb(255, 255, 255)' && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') {
          resolve(true);
          return;
        }
        if (performance.now() - start > 2000) {
          resolve(false);
          return;
        }
        requestAnimationFrame(check);
      };
      check();
    });
  });
  expect(sawStickyFlash, 'sticky Project Info cell should flash during the row highlight').toBe(true);

  // Cleanup: the flash clears itself and the highlight is consumed.
  await expect(highlighted).toHaveCount(0, { timeout: 15000 });

  // Remove the test view so it doesn't linger for later runs.
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.getByRole('heading', { name: label }).locator('..').getByRole('button', { name: `Delete view ${label}` }).click();
  await expect(page.getByRole('heading', { name: label })).toHaveCount(0);
});