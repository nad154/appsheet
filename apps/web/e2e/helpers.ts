// The grid scrolls inside its own container (rows are virtualized), so a row
// only enters the DOM once the container is scrolled to it. Step the container
// down until `text` appears in the rendered window, retrying across a data
// refetch so the call also works right after a navigation.
export async function scrollGridTo(page, text: string, options: { timeout?: number } = {}) {
  const { timeout = 10000 } = options;
  const table = page.getByRole('table');
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = await table.evaluate(async (el: HTMLElement, target: string) => {
      const step = Math.max(40, Math.floor(el.clientHeight * 0.8));
      const max = el.scrollHeight - el.clientHeight;
      for (let y = 0; y <= max; y += step) {
        el.scrollTop = max === 0 ? 0 : Math.min(y, max);
        await new Promise((r) => setTimeout(r, 40));
        if (el.textContent?.includes(target)) return true;
      }
      return false;
    }, text);
    if (found) return;
    await page.waitForTimeout(150);
  }
  throw new Error(`scrollGridTo: row "${text}" never entered the virtualized grid window`);
}