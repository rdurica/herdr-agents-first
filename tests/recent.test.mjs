import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { loadMod } from "./load.mjs";

const { rememberSpaces } = await loadMod("mods/agents-clean/recent.js");

describe("rememberSpaces", () => {
  const entry = (folder, name = folder.split("/").pop(), git = false, machine = null) => ({
    folder,
    machine,
    name,
    git,
  });
  const space = (key, name = key.split("/").pop(), git = true, machine = null) => ({
    key,
    machine,
    name,
    git,
  });

  test("adds an open space at the front with its machine, name and git", () => {
    const stored = [entry("/work/old", "old", false)];

    assert.deepEqual(rememberSpaces(stored, [space("/repo/app", "app", true, "wsl")]), [
      entry("/repo/app", "app", true, "wsl"),
      entry("/work/old", "old", false),
    ]);
  });

  test("returns null when every open space is already stored", () => {
    const stored = [entry("/a", "a"), entry("/repo/app", "app", true, "wsl")];

    assert.equal(
      rememberSpaces(stored, [space("/a", "a", false), space("/repo/app", "app", true, "wsl")]),
      null,
    );
  });

  test("keeps the stored order and puts the new spaces first in their row order", () => {
    const stored = [entry("/old/one"), entry("/old/two")];

    assert.deepEqual(
      rememberSpaces(stored, [space("/new/a"), space("/new/b")]).map((e) => e.folder),
      ["/new/a", "/new/b", "/old/one", "/old/two"],
    );
  });

  test("puts a new space in front of the stored ones it already knows", () => {
    const stored = [entry("/a", "a"), entry("/x", "x")];

    assert.deepEqual(
      rememberSpaces(stored, [space("/a", "a"), space("/b", "b")]).map((e) => e.folder),
      ["/b", "/a", "/x"],
    );
  });

  test("keeps the same folder on two machines as two entries", () => {
    assert.deepEqual(
      rememberSpaces([], [space("/repo/app", "app", true, null), space("/repo/app", "app", true, "wsl")]),
      [entry("/repo/app", "app", true, null), entry("/repo/app", "app", true, "wsl")],
    );
  });

  test("falls back to the folder's last segment for a missing or empty name", () => {
    assert.deepEqual(
      rememberSpaces(
        [],
        [
          { key: "/repo/app", machine: null, name: "", git: false },
          { key: "/work/api", machine: null },
          { key: "C:\\work\\win", machine: "wsl", name: null, git: 0 },
        ],
      ),
      [
        entry("/repo/app", "app", false),
        entry("/work/api", "api", false),
        entry("C:\\work\\win", "win", false, "wsl"),
      ],
    );
  });

  test("reads a missing or garbage stored value as no projects", () => {
    for (const value of [undefined, null, "not json", 42, true, {}, { folder: "/x" }]) {
      assert.deepEqual(
        rememberSpaces(value, [space("/new")]),
        [entry("/new", "new", true)],
        `value: ${JSON.stringify(value)}`,
      );
    }
  });

  test("drops invalid stored entries and reads a legacy entry without a machine as local", () => {
    const stored = [null, "text", 42, {}, { name: "no folder" }, { folder: "/work/api", git: 1 }];

    assert.deepEqual(rememberSpaces(stored, [space("/new")]), [
      entry("/new", "new", true),
      entry("/work/api", "api", true, null),
    ]);
  });

  test("caps the stored list at 50 projects by default, dropping the oldest", () => {
    const stored = Array.from({ length: 50 }, (_, i) => entry(`/old/${i}`, `p${i}`));

    const list = rememberSpaces(stored, [space("/new")]);

    assert.equal(list.length, 50);
    assert.equal(list[0].folder, "/new");
    assert.equal(list[49].folder, "/old/48");
    assert.ok(!list.some((e) => e.folder === "/old/49"));
  });

  test("takes the cap as an argument", () => {
    const stored = [entry("/old/a"), entry("/old/b"), entry("/old/c")];

    assert.deepEqual(
      rememberSpaces(stored, [space("/new")], 2).map((e) => e.folder),
      ["/new", "/old/a"],
    );
  });

  test("applies the cap to the newly added spaces too", () => {
    const stored = [entry("/old/a"), entry("/old/b")];

    assert.deepEqual(
      rememberSpaces(stored, [space("/new/one"), space("/new/two")], 3).map((e) => e.folder),
      ["/new/one", "/new/two", "/old/a"],
    );
  });

  test("adds one entry for a folder that appears in two rows", () => {
    const list = rememberSpaces([], [space("/repo/app"), space("/repo/app"), space("/work/api")]);

    assert.deepEqual(
      list.map((e) => e.folder),
      ["/repo/app", "/work/api"],
    );
  });

  test("ignores garbage rows and a rows value that is not a list", () => {
    assert.equal(rememberSpaces([], [{ name: "no key" }, { key: "" }, { key: 42 }, null, "text"]), null);
    assert.equal(rememberSpaces([], undefined), null);
    assert.equal(rememberSpaces([], "not a list"), null);

    assert.deepEqual(rememberSpaces([], [null, { name: "no key" }, space("/ok")]), [entry("/ok", "ok", true)]);
  });

  test("does not change its inputs", () => {
    const stored = Object.freeze([Object.freeze(entry("/old/a"))]);
    const rows = Object.freeze([Object.freeze(space("/new/b"))]);

    const list = rememberSpaces(stored, rows);

    assert.deepEqual(stored, [entry("/old/a")]);
    assert.deepEqual(rows, [space("/new/b")]);
    assert.equal(list.length, 2);
    assert.notEqual(list, stored);
  });
});
