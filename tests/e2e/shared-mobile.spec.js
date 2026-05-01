import { test, expect } from "playwright/test";

const sharedOverview = [
  { type: "header", text: "Huis", level: 2 },
  { type: "header", text: "🔴 Urgent", level: 3 },
  { type: "item", matchKey: "s1", text: "Vriezer fixen", timestamp: "2026-04-27 22:31", contexts: [] },
  { type: "item", matchKey: "s2", text: "Douche kitten", timestamp: "2026-04-28 14:28", contexts: [] },
  { type: "item", matchKey: "s3", text: "Dakraam bijkeuken schoon maken binnen / buiten en schimmel afzuig bijkeuken weg", timestamp: "2026-04-10 15:35", contexts: [] },
  { type: "header", text: "🟡 Binnenkort", level: 3 },
  { type: "item", matchKey: "s4", text: "Werkwasje", timestamp: "2026-04-28 14:28", contexts: [] },
];

test.describe("Anna/Bram mobile overview", () => {
  test.use({
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
  });

  test.beforeEach(async ({ page }) => {
    await page.route("**/api/auth/session", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ authenticated: false, role: null, expiry: null }),
      });
    });
    await page.route("**/api/auth", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, role: "anna", expiry: Date.now() + 60_000 }),
      });
    });
  });

  test("matches the compact mobile task layout and keeps the composer small", async ({ page }) => {
    await page.route("**/api/shared", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], overview: sharedOverview }),
      });
    });

    await page.goto("/");
    await page.getByLabel("PIN invoeren").fill("1111");
    await page.getByRole("button", { name: "Unlock" }).click();

    const row = page.locator(".shared-overview-item", { hasText: "Vriezer fixen" }).first();
    const circle = row.locator(".circle");
    const text = row.locator(".item-main");
    const dragButton = row.locator(".shared-drag-btn");
    await expect(row).toBeVisible();
    await expect(dragButton).toBeVisible();
    await expect(page.getByPlaceholder("Zoek in Anna/Bram")).toBeHidden();
    await expect(page.locator(".focus-summary")).toBeHidden();
    await expect(page.locator(".overview-header-item", { hasText: "Urgent" })).toBeHidden();
    await expect(page.locator(".overview-header-item", { hasText: "Binnenkort" })).toBeHidden();
    await expect(row.locator(".item-date")).toHaveCount(0);
    await expect(row).not.toContainText("27-04-2026");

    const [circleBox, textBox, composerBox] = await Promise.all([
      circle.boundingBox(),
      text.boundingBox(),
      page.locator("#tab-shared .chat-input").boundingBox(),
    ]);
    expect(circleBox).toBeTruthy();
    expect(textBox).toBeTruthy();
    expect(composerBox).toBeTruthy();

    const circleCenterY = circleBox.y + circleBox.height / 2;
    const textFirstLineCenterY = textBox.y + 16;
    expect(Math.abs(circleCenterY - textFirstLineCenterY)).toBeLessThan(18);
    expect(composerBox.height).toBeLessThan(105);

    const input = page.getByPlaceholder("Nieuw Anna/Bram item...");
    const initialHeight = (await input.boundingBox()).height;
    await input.fill("Eerste regel\nTweede regel\nDerde regel");
    const grownHeight = (await input.boundingBox()).height;
    expect(grownHeight).toBeGreaterThan(initialHeight);
  });

  test("can reorder shared items from the visible mobile handle", async ({ page }) => {
    let organizeRequest = null;
    await page.route("**/api/shared", async (route) => {
      if (route.request().method() === "PATCH") {
        organizeRequest = route.request().postDataJSON();
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], overview: sharedOverview }),
      });
    });

    await page.goto("/");
    await page.getByLabel("PIN invoeren").fill("1111");
    await page.getByRole("button", { name: "Unlock" }).click();

    const handle = page.getByLabel("Sleep om te herschikken: Vriezer fixen");
    const target = page.locator(".shared-overview-item", { hasText: "Douche kitten" });
    const handleBox = await handle.boundingBox();
    const targetBox = await target.boundingBox();
    expect(handleBox).toBeTruthy();
    expect(targetBox).toBeTruthy();

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height + 8, { steps: 6 });
    await page.mouse.up();

    await expect.poll(() => organizeRequest?.action).toBe("organize");
    expect(organizeRequest.matchKey).toBe("s1");
  });
});
