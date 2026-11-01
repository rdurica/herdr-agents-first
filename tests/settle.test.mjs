import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { loadMod } from "./load.mjs";

const { settleAction, isManaged, settleInTurn } = await loadMod("mods/agents-clean/settle.js");

describe("settleAction", () => {
  test("closes a tab that is not its space's last one", () => {
    assert.equal(
      settleAction({ lastTab: false, managed: true, dirty: true, merged: false, batch: true }),
      "close",
    );
  });

  test("keeps the tab while another agent in it is still busy", () => {
    assert.equal(
      settleAction({ lastTab: false, managed: false, dirty: true, merged: false, busy: true }),
      "keep",
    );
    assert.equal(
      settleAction({ lastTab: true, managed: true, dirty: false, merged: true, busy: true }),
      "keep",
    );
    assert.equal(
      settleAction({ lastTab: true, managed: true, dirty: false, merged: true, busy: true, batch: true }),
      "keep",
    );
  });

  test("closes the last tab of an unmanaged space instead of replacing it", () => {
    assert.equal(settleAction({ lastTab: true, managed: false, dirty: true, merged: false }), "close");
    assert.equal(
      settleAction({ lastTab: true, managed: false, dirty: false, merged: true, batch: true }),
      "close",
    );
  });

  test("removes the space and worktree when the last managed tab is clean and merged", () => {
    assert.equal(settleAction({ lastTab: true, managed: true, dirty: false, merged: true }), "remove");
    assert.equal(
      settleAction({ lastTab: true, managed: true, dirty: false, merged: true, batch: true }),
      "remove",
    );
  });

  test("asks when a single settle leaves work behind", () => {
    assert.equal(
      settleAction({ lastTab: true, managed: true, dirty: true, merged: true, batch: false }),
      "ask",
    );
    assert.equal(
      settleAction({ lastTab: true, managed: true, dirty: false, merged: false }),
      "ask",
    );
  });

  test("skips the same case during Settle all", () => {
    assert.equal(
      settleAction({ lastTab: true, managed: true, dirty: true, merged: true, batch: true }),
      "skip",
    );
    assert.equal(
      settleAction({ lastTab: true, managed: true, dirty: false, merged: false, batch: true }),
      "skip",
    );
  });
});

describe("settleInTurn", () => {
  test("waits for a closed tab to go before settling the next one", async () => {
    const settled = [];
    let pauses = 0;
    let firstGone = false;

    const skips = await settleInTurn([{ id: "a" }, { id: "b" }], {
      settle: async (tab) => {
        if (tab.id === "b") assert.equal(firstGone, true, "b was settled before a was gone");
        settled.push(tab.id);
        return "closed";
      },
      gone: async (tab) => {
        if (tab.id !== "a") return true;
        if (pauses >= 3) firstGone = true;
        return firstGone;
      },
      pause: async () => {
        pauses += 1;
      },
    });

    assert.deepEqual(settled, ["a", "b"]);
    assert.equal(pauses, 3);
    assert.equal(skips, 0);
  });

  test("settles tabs in order and counts the skipped ones", async () => {
    const settled = [];
    const results = { a: "closed", b: "skip", c: undefined, d: "skip" };

    const skips = await settleInTurn([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], {
      settle: async (tab) => {
        settled.push(tab.id);
        return results[tab.id];
      },
      gone: async () => true,
      pause: async () => {},
    });

    assert.deepEqual(settled, ["a", "b", "c", "d"]);
    assert.equal(skips, 2);
  });

  test("does not pause or check gone for a tab that was left alone", async () => {
    const results = { skip: "skip", keep: "keep", gone: undefined };
    let pauses = 0;
    let gones = 0;

    const skips = await settleInTurn([{ id: "skip" }, { id: "keep" }, { id: "gone" }], {
      settle: async (tab) => results[tab.id],
      gone: async () => {
        gones += 1;
        return true;
      },
      pause: async () => {
        pauses += 1;
      },
    });

    assert.equal(skips, 1);
    assert.equal(pauses, 0);
    assert.equal(gones, 0);
  });

  test("gives up after the allowed pauses and settles the rest", async () => {
    const settled = [];
    let pauses = 0;
    let gones = 0;

    const skips = await settleInTurn([{ id: "stuck" }, { id: "after" }], {
      settle: async (tab) => {
        settled.push(tab.id);
        return "closed";
      },
      gone: async (tab) => {
        gones += 1;
        return tab.id !== "stuck";
      },
      pause: async () => {
        pauses += 1;
      },
      tries: 3,
    });

    assert.deepEqual(settled, ["stuck", "after"]);
    assert.equal(pauses, 3);
    // Once before the first pause, then after each of the three.
    assert.equal(gones, 5);
    assert.equal(skips, 0);
  });

  test("does not pause when the tab is already gone right after closing", async () => {
    const settled = [];
    let pauses = 0;

    await settleInTurn([{ id: "a" }, { id: "b" }], {
      settle: async (tab) => {
        settled.push(tab.id);
        return "closed";
      },
      gone: async () => true,
      pause: async () => {
        pauses += 1;
      },
    });

    assert.deepEqual(settled, ["a", "b"]);
    assert.equal(pauses, 0);
  });

  test("pauses forty times when tries is not given", async () => {
    let pauses = 0;

    await settleInTurn([{ id: "stuck" }, { id: "after" }], {
      settle: async () => "closed",
      gone: async (tab) => tab.id !== "stuck",
      pause: async () => {
        pauses += 1;
      },
    });

    assert.equal(pauses, 40);
  });

  test("propagates a failing settle", async () => {
    let settledAfter = false;

    await assert.rejects(
      settleInTurn([{ id: "a" }, { id: "b" }], {
        settle: async (tab) => {
          if (tab.id === "a") throw new Error("close failed");
          settledAfter = true;
          return "closed";
        },
        gone: async () => true,
        pause: async () => {},
      }),
      /close failed/,
    );

    assert.equal(settledAfter, false);
  });
});

describe("isManaged", () => {
  test("recognises a linked worktree under .herdr/worktrees", () => {
    assert.equal(
      isManaged("/home/me/.herdr/worktrees/app/agent-fix", "/home/me/app"),
      true,
    );
  });

  test("rejects the main checkout", () => {
    assert.equal(isManaged("/home/me/app", "/home/me/app"), false);
  });

  test("rejects a linked worktree outside .herdr/worktrees", () => {
    assert.equal(isManaged("/home/me/wt/app", "/home/me/app"), false);
  });

  test("normalises Windows backslashes", () => {
    assert.equal(
      isManaged("C:\\Users\\me\\.herdr\\worktrees\\app\\agent-fix", "C:\\Users\\me\\app"),
      true,
    );
  });
});
