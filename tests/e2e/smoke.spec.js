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
  let sharedOverview = [
    { type: "header", text: "Huis", level: 2 },
    { type: "header", text: "🔴 Urgent", level: 3 },
    { type: "item", matchKey: "s1", text: "Tuintafel schoonmaken", timestamp: "2026-05-01 15:39", contexts: [] },
    { type: "header", text: "Tuin", level: 2 },
    { type: "header", text: "🟡 Binnenkort", level: 3 },
    { type: "item", matchKey: "s2", text: "Voortuin snoeien", timestamp: "2026-04-28 14:33", contexts: [] },
    { type: "header", text: "Afspraken", level: 2 },
    { type: "header", text: "🔴 Urgent", level: 3 },
    { type: "item", matchKey: "s3", text: "Naar Polen", timestamp: "2026-04-28 14:27", contexts: [] },
  ];
  await page.route("**/api/auth", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, role: "anna", expiry: Date.now() + 60_000 }),
    });
  });
  await page.route("**/api/shared", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      if (body.action === "done") {
        sharedOverview = sharedOverview.filter((entry) => entry.matchKey !== body.matchKey);
      }
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [{ matchKey: "a", text: "Samen doen", timestamp: "2026-04-28 11:00", author: "Bram", contexts: [], attachment: null }],
        overview: sharedOverview,
      }),
    });
  });

  await page.goto("/");
  await page.getByLabel("PIN invoeren").fill("1111");
  await page.getByRole("button", { name: "Unlock" }).click();

  await expect(page.getByRole("button", { name: "Anna / Bram" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Braindump" })).toBeHidden();
  await expect(page.getByPlaceholder("Zoek in Anna/Bram")).toBeHidden();
  await expect(page.getByText("Tuintafel schoonmaken")).toBeVisible();
  await expect(page.getByRole("button", { name: "Alles" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Huis", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tuin", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Afspraken", exact: true }).click();
  await expect(page.getByText("Naar Polen")).toBeVisible();
  await expect(page.getByText("Tuintafel schoonmaken")).toBeHidden();
  await page.getByRole("button", { name: "Markeer als klaar: Naar Polen" }).click();
  await expect(page.getByText("Naar Polen")).toBeHidden();
  await expect(page.getByText("Samen doen")).toBeHidden();
});

test("personal inbox can add a new item", async ({ page }) => {
  await page.route("**/api/auth", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, role: "bram", expiry: Date.now() + 60_000 }),
    });
  });
  await page.route("**/api/inbox?nocache=1", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });
  await page.route("**/api/inbox", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          item: {
            matchKey: "new-1",
            text: "Nieuwe inbox taak",
            timestamp: "2026-04-28 12:15",
            author: null,
            contexts: [],
            attachment: null,
          },
        }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });
  await page.route("**/api/overview", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        categories: { werk: [], fysiek: [], code: [], persoonlijk: [], someday: [] },
      }),
    });
  });
  await page.route("**/api/shared", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) }));
  await page.route("**/api/gep", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) }));

  await page.goto("/");
  await page.getByLabel("PIN invoeren").fill("1234");
  await page.getByRole("button", { name: "Unlock" }).click();

  await page.getByPlaceholder("Nieuw item...").fill("Nieuwe inbox taak");
  await page.getByRole("button", { name: "Inbox item verzenden" }).click();

  await expect(page.getByText("Nieuwe inbox taak")).toBeVisible();
});

test("overview focus chips filter urgent, recent, and open items", async ({ page }) => {
  await page.route("**/api/auth", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, role: "bram", expiry: Date.now() + 60_000 }),
    });
  });
  await page.route("**/api/inbox**", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) }));
  await page.route("**/api/shared", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) }));
  await page.route("**/api/gep", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) }));
  await page.route("**/api/overview", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        categories: {
          werk: [
            { type: "header", text: "🔴 Urgent", level: 2 },
            { type: "item", matchKey: "urgent-1", text: "Bel leverancier", timestamp: "2026-05-01 10:00", contexts: [], isClaudeItem: false },
            { type: "header", text: "🟢 Geen haast", level: 2 },
            { type: "item", matchKey: "later-1", text: "Archief nalopen", timestamp: "2026-04-01 10:00", contexts: [], isClaudeItem: false },
          ],
          fysiek: [],
          code: [{ type: "item", matchKey: "code-1", text: "🤖 UI polish", timestamp: "2026-05-01 11:00", contexts: [], isClaudeItem: true }],
          persoonlijk: [],
          someday: [],
        },
      }),
    });
  });

  await page.goto("/");
  await page.getByLabel("PIN invoeren").fill("1234");
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.getByRole("button", { name: "Overzicht" }).click();

  await expect(page.getByText("Codex kan dit oppakken")).toBeVisible();
  await page.getByRole("button", { name: /urgent/i }).click();
  await expect(page.getByText("Bel leverancier")).toBeVisible();
  await expect(page.getByText("Archief nalopen")).toBeHidden();

  await page.getByRole("button", { name: /recent/i }).click();
  await expect(page.getByText("UI polish")).toBeVisible();
  await expect(page.getByText("Archief nalopen")).toBeHidden();

  await page.getByRole("button", { name: /open/i }).click();
  await expect(page.getByText("Archief nalopen")).toBeVisible();
});
