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

// The app's program table entry for a pane; shell is false for a running program.
const prog = (extra = {}) => ({ key: "k9s", name: "K9s", icon: null, tint: null, shell: false, agent: false, ...extra });

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

  test("carries the chosen pane's program, null when the pane has none", () => {
    const k9s = prog();
    const htop = prog({ key: "htop", name: "htop" });
    const result = rows({
      spaces: [space("app", [tab("t1"), tab("t2")])],
      panes: [pane("p1", "t1", { program: k9s }), pane("p1b", "t1", { focused: true, program: htop }), pane("p2", "t2")],
    });
    assert.deepEqual(result.map((r) => r.program), [htop, null]);
  });

  test("keeps the cwd detail for a pane running a shell", () => {
    const zsh = prog({ key: "zsh", name: "Zsh", shell: true });
    const result = rows({
      spaces: [space("app", [tab("t1")], { machine: "devbox" })],
      panes: [pane("p1", "t1", { cwd: `${HOME}/app`, title: "server", program: zsh })],
    });
    assert.deepEqual([result[0].program, result[0].detail], [zsh, "devbox · ~/app"]);
  });

  test("shows the program and a telling title for a non-shell program", () => {
    const result = rows({
      spaces: [space("app", [tab("t1")], { machine: "localhost" })],
      panes: [pane("p1", "t1", { cwd: `${HOME}/work/app`, title: "erp/stockadmin-e2e-uat", program: prog() })],
    });
    assert.equal(result[0].detail, "localhost · K9s · erp/stockadmin-e2e-uat");
  });

  test("falls back to the cwd for a title that is just the program name or key", () => {
    const result = rows({
      spaces: [space("app", [tab("t1"), tab("t2"), tab("t3")], { machine: "localhost" })],
      panes: [
        pane("p1", "t1", { cwd: `${HOME}/work/app`, title: "K9S", program: prog() }),
        pane("p2", "t2", { cwd: `${HOME}/work/app`, title: "K9s", program: prog() }),
        pane("p3", "t3", { cwd: `${HOME}/work/app`, title: "k9s", program: prog() }),
      ],
    });
    assert.deepEqual(result.map((r) => r.detail), Array(3).fill("localhost · K9s · ~/work/app"));
  });

  test("leaves out a title that looks like a path", () => {
    const result = rows({
      spaces: [space("app", [tab("t1"), tab("t2"), tab("t3"), tab("t4")])],
      panes: [
        pane("p1", "t1", { cwd: `${HOME}/work/app`, title: "/srv/www", program: prog() }),
        pane("p2", "t2", { cwd: `${HOME}/work/app`, title: "~/work/app", program: prog() }),
        pane("p3", "t3", { cwd: `${HOME}/work/app`, title: "C:\\Users\\me\\app", program: prog() }),
        pane("p4", "t4", { cwd: `${HOME}/work/app`, title: null, program: prog() }),
      ],
    });
    assert.deepEqual(result.map((r) => r.detail), Array(4).fill("K9s · ~/work/app"));
  });

  test("leaves out a title with a user@host prompt", () => {
    const result = rows({
      spaces: [space("app", [tab("t1")])],
      panes: [pane("p1", "t1", { cwd: `${HOME}/work/app`, title: "robert@box: ~", program: prog() })],
    });
    assert.equal(result[0].detail, "K9s · ~/work/app");
  });

  test("strips leading decoration before judging the title", () => {
    const result = rows({
      spaces: [space("app", [tab("t1"), tab("t2"), tab("t3")], { machine: "localhost" })],
      panes: [
        pane("p1", "t1", { cwd: `${HOME}/work/app`, title: "⠋ K9s", program: prog() }),
        pane("p2", "t2", { cwd: `${HOME}/work/app`, title: "✳ erp/stockadmin-e2e-uat", program: prog() }),
        pane("p3", "t3", { cwd: `${HOME}/work/app`, title: "⠋ ", program: prog() }),
      ],
    });
    assert.deepEqual(result.map((r) => r.detail), [
      "localhost · K9s · ~/work/app",
      "localhost · K9s · erp/stockadmin-e2e-uat",
      "localhost · K9s · ~/work/app",
    ]);
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
