import { test, expect } from "playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ authenticated: false, role: null, expiry: null }),
    });
  });
});

test("bram flow shows personal tabs and overview data", async ({ page }) => {
  await page.route("**/api/auth", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, role: "bram", expiry: Date.now() + 60_000 }),
    });
  });
  await page.route("**/api/inbox?nocache=1", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) }));
  await page.route("**/api/inbox", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) }));
  await page.route("**/api/overview", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        categories: {
          werk: [{ type: "item", matchKey: "1", text: "Bel klant", timestamp: "2026-04-28 09:00", contexts: [], isClaudeItem: false }],
          fysiek: [],
          code: [{ type: "item", matchKey: "2", text: "🤖 Refactor auth", timestamp: "2026-04-28 10:00", contexts: [], isClaudeItem: true }],
          persoonlijk: [],
          someday: [],
        },
      }),
    });
  });
  await page.route("**/api/shared", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) }));
  await page.route("**/api/gep", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) }));

  await page.goto("/");
  await page.getByLabel("PIN invoeren").fill("1234");
  await page.getByRole("button", { name: "Unlock" }).click();

  await expect(page.getByRole("button", { name: "Braindump" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Overzicht" })).toBeVisible();
  await page.getByRole("button", { name: "Overzicht" }).click();
  await expect(page.getByText("Refactor auth")).toBeVisible();
  await expect(page.getByPlaceholder("Zoek in overzicht")).toBeVisible();
});

test("anna flow only exposes shared tab", async ({ page }) => {
  await page.route("**/api/auth", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, role: "anna", expiry: Date.now() + 60_000 }),
    });
  });
  await page.route("**/api/shared", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [{ matchKey: "a", text: "Samen doen", timestamp: "2026-04-28 11:00", author: "Bram", contexts: [], attachment: null }],
      }),
    });
  });

  await page.goto("/");
  await page.getByLabel("PIN invoeren").fill("1111");
  await page.getByRole("button", { name: "Unlock" }).click();

  await expect(page.getByRole("button", { name: "Anna / Bram" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Braindump" })).toBeHidden();
  await expect(page.getByText("Samen doen")).toBeVisible();
});
