import test from "node:test";
import assert from "node:assert/strict";

import {
  parseFeedBlocks,
  parseStructuredOverview,
  serializeFeedItem,
} from "../../functions/lib/braindumpParser.js";

test("parseFeedBlocks normalizes shared items and image attachments", () => {
  const items = parseFeedBlocks("- [Anna] [foto.png](https://github.com/example/blob/main/uploads/foto.png) Keuken *(2026-04-28 09:45)*", {
    allowAuthor: true,
  }).map(serializeFeedItem);

  assert.equal(items.length, 1);
  assert.equal(items[0].author, "Anna");
  assert.equal(items[0].attachment.label, "foto.png");
  assert.equal(items[0].attachment.caption, "Keuken");
  assert.equal(items[0].timestamp, "2026-04-28 09:45");
});

test("parseFeedBlocks keeps personal contexts attached to parent items", () => {
  const items = parseFeedBlocks([
    "- Bel leverancier *(28-04-2026 09:45)*",
    "  - Morgen even bellen *(28-04-2026 10:00)*",
  ].join("\n"), {
    allowAuthor: false,
  }).map(serializeFeedItem);

  assert.equal(items.length, 1);
  assert.equal(items[0].text, "Bel leverancier");
  assert.equal(items[0].contexts.length, 1);
  assert.equal(items[0].contexts[0].text, "Morgen even bellen");
  assert.equal(items[0].contexts[0].timestamp, "2026-04-28 10:00");
});

test("parseStructuredOverview strips timestamps and done items", () => {
  const entries = parseStructuredOverview([
    "# Werk",
    "- [2026-04-28 10:00] 🤖 Refactor auth",
    "  - [2026-04-28 10:10] split middleware",
    "- ~~Afgerond~~ ✅ done",
  ].join("\n"));

  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "item");
  assert.equal(entries[0].text, "🤖 Refactor auth");
  assert.equal(entries[0].timestamp, "2026-04-28 10:00");
  assert.equal(entries[0].contexts[0].text, "split middleware");
});
