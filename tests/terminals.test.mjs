import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { loadMod } from "./load.mjs";

const { terminalRows } = await loadMod("mods/agents-clean/terminals.js");

const HOME = "/home/me";

const pane = (id, tab, extra = {}) => ({
  pane: id,
  terminal: `t-${id}`,
  tab,
  title: "zsh",
  cwd: null,
  branch: null,
  status: null,
  focused: false,
  ...extra,
});

const tab = (id, extra = {}) => ({ id, name: "1", named: false, settled: false, status: null, ...extra });

const space = (id, tabs, extra = {}) => ({ id, name: id, folder: `${HOME}/${id}`, machine: null, tabs, ...extra });

const rows = (input) => terminalRows({ agents: [], panes: [], focused: null, home: HOME, ...input });

describe("terminalRows", () => {
  test("gives one row per tab without an agent", () => {
    const result = rows({
      spaces: [space("app", [tab("t1"), tab("t2")])],
      panes: [pane("p1", "t1"), pane("p2", "t2")],
    });
    assert.deepEqual(
      result.map((r) => [r.space, r.tab, r.pane]),
      [["app", "t1", "p1"], ["app", "t2", "p2"]],
    );
  });

  test("skips a tab with an agents() entry", () => {
    const result = rows({
      spaces: [space("app", [tab("t1"), tab("t2")])],
      panes: [pane("p1", "t1"), pane("p2", "t2")],
      agents: [{ address: "a1", tab: "t1", status: "idle" }],
    });
    assert.deepEqual(result.map((r) => r.tab), ["t2"]);
  });

  test("skips a tab with a pane that reports an agent status", () => {
    const result = rows({
      spaces: [space("app", [tab("t1"), tab("t2")])],
      panes: [pane("p1", "t1"), pane("p1b", "t1", { status: "working" }), pane("p2", "t2")],
    });
    assert.deepEqual(result.map((r) => r.tab), ["t2"]);
  });

  test("skips settled tabs", () => {
    const result = rows({
      spaces: [space("app", [tab("t1", { settled: true }), tab("t2")])],
      panes: [pane("p1", "t1"), pane("p2", "t2")],
    });
    assert.deepEqual(result.map((r) => r.tab), ["t2"]);
  });

  test("skips a tab whose panes are all mod panes", () => {
    const result = rows({
      spaces: [space("app", [tab("t1"), tab("t2")])],
      panes: [pane("p1", "t1", { terminal: null, mod: "files" }), pane("p2", "t2")],
    });
    assert.deepEqual(result.map((r) => r.tab), ["t2"]);
  });

  test("keeps spaces order, then tab order", () => {
    const result = rows({
      spaces: [space("b", [tab("b1"), tab("b2")]), space("a", [tab("a1")])],
      panes: [pane("pa1", "a1"), pane("pb2", "b2"), pane("pb1", "b1")],
    });
    assert.deepEqual(result.map((r) => r.tab), ["b1", "b2", "a1"]);
  });

  test("picks the focused terminal pane of the tab, else the first one", () => {
    const result = rows({
      spaces: [space("app", [tab("t1"), tab("t2")])],
      panes: [
        pane("m1", "t1", { terminal: null, mod: "files" }),
        pane("p1", "t1"),
        pane("p1b", "t1", { focused: true }),
        pane("m2", "t2", { terminal: null, mod: "files", focused: true }),
        pane("p2", "t2"),
        pane("p2b", "t2"),
      ],
    });
    assert.deepEqual(result.map((r) => r.pane), ["p1b", "p2"]);
  });

  test("names the row after the tab when it is named, else after the space", () => {
    const result = rows({
      spaces: [space("app", [tab("t1", { name: "server", named: true }), tab("t2", { name: "2" })])],
      panes: [pane("p1", "t1"), pane("p2", "t2")],
    });
    assert.deepEqual(result.map((r) => r.name), ["server", "app"]);
  });

  test("shows the pane's cwd with home as ~, else the space folder", () => {
    const result = rows({
      spaces: [space("app", [tab("t1"), tab("t2"), tab("t3")])],
      panes: [
        pane("p1", "t1", { cwd: `${HOME}/code/app/src` }),
        pane("p2", "t2", { cwd: HOME }),
        pane("p3", "t3", { cwd: null }),
      ],
    });
    assert.deepEqual(result.map((r) => r.detail), ["~/code/app/src", "~", "~/app"]);
  });

  test("leaves a path outside home as it is", () => {
    const result = rows({
      spaces: [space("srv", [tab("t1")])],
      panes: [pane("p1", "t1", { cwd: "/srv/www" })],
    });
    assert.equal(result[0].detail, "/srv/www");
  });

  test("handles Windows slashes in the home rule", () => {
    const result = terminalRows({
      spaces: [space("app", [tab("t1")])],
      panes: [pane("p1", "t1", { cwd: "C:\\Users\\me\\app" })],
      agents: [],
      focused: null,
      home: "C:\\Users\\me",
    });
    assert.equal(result[0].detail, "~/app");
  });

  test("prefixes the machine for a remote space", () => {
    const result = rows({
      spaces: [space("app", [tab("t1")], { machine: "devbox" })],
      panes: [pane("p1", "t1", { cwd: `${HOME}/app` })],
    });
    assert.equal(result[0].detail, "devbox · ~/app");
  });

  test("marks the row of the focused tab", () => {
    const result = rows({
      spaces: [space("app", [tab("t1"), tab("t2")])],
      panes: [pane("p1", "t1"), pane("p2", "t2")],
      focused: { tab: "t2" },
    });
    assert.deepEqual(result.map((r) => r.focused), [false, true]);
  });

  test("returns no rows when there is nothing to show", () => {
    assert.deepEqual(rows({ spaces: [], panes: [] }), []);
  });
});
