import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { loadMod } from "./load.mjs";

const { settleAction, isManaged } = await loadMod("mods/agents-clean/settle.js");

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

  test("replaces the last tab of an unmanaged space", () => {
    assert.equal(settleAction({ lastTab: true, managed: false, dirty: true, merged: false }), "replace");
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
