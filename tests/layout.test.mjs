import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { repoRoot } from "./load.mjs";

describe("layouts/main-settle.json", () => {
  async function lists() {
    const layout = JSON.parse(await readFile(path.join(repoRoot, "layouts/main-settle.json"), "utf8"));
    const find = (node, id) => {
      if (node.id === id) return node;
      for (const child of node.children ?? []) {
        const hit = find(child, id);
        if (hit) return hit;
      }
      return null;
    };
    return find(layout, "sidebar-lists");
  }

  test("has no spaces block in the sidebar lists", async () => {
    const list = await lists();
    assert.ok(list, "sidebar-lists is missing");
    assert.equal(list.children.some((c) => c.id === "spaces" || c.content?.mod === "spaces"), false);
  });

  test("lists agents above terminals, both from agents-clean", async () => {
    const list = await lists();
    assert.deepEqual(
      list.children.map((c) => ({ id: c.id, content: c.content, size: c.size, min: c.min })),
      [
        { id: "agents", content: { mod: "agents-clean" }, size: { weight: 2 }, min: 90 },
        {
          id: "terminals",
          content: { mod: "agents-clean", props: { terminals: true } },
          size: { weight: 1 },
          min: 90,
        },
      ],
    );
  });
});
