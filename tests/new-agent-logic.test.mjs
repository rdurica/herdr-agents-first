import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { loadMod } from "./load.mjs";

const {
  slugify,
  branchName,
  uniqueBranch,
  worktreePath,
  projectId,
  parentFolder,
  joinFolder,
  folderListing,
  machineKey,
  projectsFromSpaces,
  TERMINAL,
  plainAgent,
  agentLists,
  agentsOn,
  setAgentsOn,
  wantsWorktree,
  pickAgent,
  agentArgv,
  launchPlan,
  parseRepo,
  readRecent,
  readFavorites,
  rememberProject,
  toggleFavorite,
  pickFavorite,
  projectList,
  filterProjects,
} = await loadMod("mods/new-agent/logic.js");

describe("slugify", () => {
  test("folds diacritics, lowercases and joins words with single dashes", () => {
    assert.equal(slugify("Oprav přihlášení uživatele!"), "oprav-prihlaseni-uzivatele");
    assert.equal(slugify("Café déjà vu"), "cafe-deja-vu");
    assert.equal(slugify("Hello,   World"), "hello-world");
  });

  test("trims leading and trailing separators", () => {
    assert.equal(slugify("  --Hello--  "), "hello");
  });

  test("returns an empty slug for empty or symbol-only text", () => {
    assert.equal(slugify(""), "");
    assert.equal(slugify("!!! ???"), "");
    assert.equal(slugify("---"), "");
  });

  test("cuts at 40 characters without leaving a trailing dash", () => {
    assert.equal(slugify("x".repeat(60)), "x".repeat(40));
    // The 40th character is the dash joining the next word.
    assert.equal(slugify("a".repeat(39) + " bcd"), "a".repeat(39));
  });
});

describe("branchName", () => {
  test("uses the task slug", () => {
    assert.equal(branchName("Fix login", new Date(2026, 0, 5, 9, 7)), "agent/fix-login");
    assert.equal(branchName("Oprav přihlášení", new Date(2026, 0, 5, 9, 7)), "agent/oprav-prihlaseni");
  });

  test("falls back to the local timestamp when the task has no slug", () => {
    assert.equal(branchName("", new Date(2026, 0, 5, 9, 7)), "agent/20260105-0907");
    assert.equal(branchName("!!!", new Date(2026, 11, 31, 23, 59)), "agent/20261231-2359");
  });
});

describe("uniqueBranch", () => {
  test("returns the branch when it is free", () => {
    assert.equal(uniqueBranch("agent/fix", []), "agent/fix");
    assert.equal(uniqueBranch("agent/fix", ["agent/fix-2"]), "agent/fix");
  });

  test("counts up until the name is free", () => {
    assert.equal(uniqueBranch("agent/fix", ["agent/fix"]), "agent/fix-2");
    assert.equal(uniqueBranch("agent/fix", ["agent/fix", "agent/fix-2"]), "agent/fix-3");
  });
});

describe("worktreePath", () => {
  test("uses Herdr's stock worktree layout", () => {
    assert.equal(
      worktreePath("/home/me", "app", "agent/fix-x"),
      "/home/me/.herdr/worktrees/app/agent-fix-x",
    );
  });

  test("replaces characters Herdr cannot use in a folder name", () => {
    assert.equal(
      worktreePath("/home/me", "app", "agent/re:fix x"),
      "/home/me/.herdr/worktrees/app/agent-re-fix-x",
    );
    assert.equal(
      worktreePath("/home/me", "app", "agent//x"),
      "/home/me/.herdr/worktrees/app/agent-x",
    );
  });
});

describe("projectId", () => {
  test("names a local row by its folder and a null machine", () => {
    assert.equal(projectId({ key: "/repo/app" }), '[null,"/repo/app"]');
    assert.equal(projectId({ key: "/repo/app", machine: null }), '[null,"/repo/app"]');
    assert.equal(projectId({ key: "/repo/app", machine: undefined }), '[null,"/repo/app"]');
  });

  test("names a remote row by its machine and folder", () => {
    assert.equal(projectId({ key: "/repo/app", machine: "wsl" }), '["wsl","/repo/app"]');
  });

  test("gives the same folder on two machines different ids", () => {
    const local = projectId({ key: "/repo/app", machine: null });
    const wsl = projectId({ key: "/repo/app", machine: "wsl" });

    assert.notEqual(local, wsl);
    assert.notEqual(wsl, projectId({ key: "/repo/app", machine: "vps" }));
  });

  test("does not let a machine and a folder swap places", () => {
    assert.notEqual(projectId({ key: "b", machine: "a" }), projectId({ key: "a", machine: "b" }));
    assert.notEqual(projectId({ key: "/repo/other", machine: "wsl" }), projectId({ key: "/repo/app", machine: "wsl" }));
  });

  test("quotes a folder so that the parts stay apart", () => {
    assert.equal(projectId({ key: 'a"b', machine: "wsl" }), '["wsl","a\\"b"]');
  });
});

describe("parentFolder", () => {
  test("walks up a POSIX folder one segment at a time", () => {
    assert.equal(parentFolder("/home/me"), "/home");
    assert.equal(parentFolder("/home"), "/");
  });

  test("is null at a POSIX root or without a segment to drop", () => {
    assert.equal(parentFolder("/"), null);
    assert.equal(parentFolder("name"), null);
    assert.equal(parentFolder(""), null);
    assert.equal(parentFolder(null), null);
    assert.equal(parentFolder(undefined), null);
  });

  test("walks up a relative path but stops at a bare name", () => {
    assert.equal(parentFolder("relative/path"), "relative");
  });

  test("ignores a trailing slash", () => {
    assert.equal(parentFolder("/home/me/"), "/home");
  });

  test("keeps a Windows path's backslashes", () => {
    assert.equal(parentFolder("C:\\Users\\me"), "C:\\Users");
    assert.equal(parentFolder("C:\\Users"), "C:\\");
    assert.equal(parentFolder("C:\\"), null);
  });

  test("keeps a forward-slash drive's separators", () => {
    assert.equal(parentFolder("C:/Users/me"), "C:/Users");
    assert.equal(parentFolder("C:/Users"), "C:/");
    assert.equal(parentFolder("C:"), null);
  });

  test("keeps a leading double slash so a UNC server stays a server", () => {
    assert.equal(parentFolder("//server/share"), "//server");
  });

  test("does not change the path it was given", () => {
    const given = "/home/me/";

    parentFolder(given);

    assert.equal(given, "/home/me/");
  });
});

describe("joinFolder", () => {
  test("joins a name onto a POSIX folder with one slash", () => {
    assert.equal(joinFolder("/home/me", "Projects"), "/home/me/Projects");
    assert.equal(joinFolder("/home/me/", "Projects"), "/home/me/Projects");
    assert.equal(joinFolder("/", "tmp"), "/tmp");
  });

  test("keeps a backslash path's separator", () => {
    assert.equal(joinFolder("C:\\Users\\me", "x"), "C:\\Users\\me\\x");
    assert.equal(joinFolder("C:\\", "x"), "C:\\x");
  });

  test("keeps a forward-slash drive's separator", () => {
    assert.equal(joinFolder("C:/", "x"), "C:/x");
  });

  test("does not change the folder it was given", () => {
    const given = "/home/me";

    joinFolder(given, "Projects");

    assert.equal(given, "/home/me");
  });
});

describe("folderListing", () => {
  test("reads the folder from the first line and its folders from the rest", () => {
    assert.deepEqual(folderListing("/home/me\nProjects/\n.cache/\nREADME.md\n"), {
      path: "/home/me",
      names: ["Projects", ".cache"],
    });
  });

  test("trims only the CR of CRLF line endings", () => {
    assert.deepEqual(folderListing("/srv\r\napi/\r\n"), { path: "/srv", names: ["api"] });
  });

  test("keeps the shell's order instead of sorting the names", () => {
    assert.deepEqual(folderListing("/x\nb/\na/\nc/\n").names, ["b", "a", "c"]);
  });

  test("keeps spaces inside a folder name", () => {
    assert.deepEqual(folderListing("/x\nMy Project/\n").names, ["My Project"]);
  });

  test("reads empty output as an empty folder with no names", () => {
    assert.deepEqual(folderListing(""), { path: "", names: [] });
    assert.deepEqual(folderListing("/\n"), { path: "/", names: [] });
  });

  test("skips blank, dot, dot-dot and root entries", () => {
    assert.deepEqual(folderListing("/x\n\n./\n../\n/\nb/\n").names, ["b"]);
  });

  test("does not change the output it was given", () => {
    const given = "/home/me\nProjects/\n";

    folderListing(given);

    assert.equal(given, "/home/me\nProjects/\n");
  });
});

describe("machineKey", () => {
  test("treats no machine as the empty key", () => {
    assert.equal(machineKey(null), "");
    assert.equal(machineKey(undefined), "");
    assert.equal(machineKey(""), "");
  });

  test("is the machine's name otherwise", () => {
    assert.equal(machineKey("wsl"), "wsl");
    assert.equal(machineKey("vps"), "vps");
  });
});

describe("projectsFromSpaces", () => {
  const space = (over = {}) => ({
    id: "sp-1",
    name: "app",
    folder: "/repo/app",
    machine: null,
    branch: "agent/fix",
    status: "idle",
    active: false,
    cwd: "/repo/app",
    ...over,
  });

  test("turns each open local space into a project row", () => {
    const rows = projectsFromSpaces(
      [
        space({ id: "sp-1", name: "app", cwd: "/repo/app", branch: "agent/fix", status: "idle" }),
        space({ id: "sp-2", name: "plain", folder: "/work/plain", cwd: "/work/plain", branch: null, status: "working" }),
      ],
      null,
    );

    assert.deepEqual(rows, [
      { key: "/repo/app", machine: null, name: "app", git: true, space: "sp-1", busy: false },
      { key: "/work/plain", machine: null, name: "plain", git: false, space: "sp-2", busy: true },
    ]);
  });

  test("keys a row by the space's live cwd, falling back to its folder", () => {
    const rows = projectsFromSpaces(
      [
        space({ id: "sp-1", folder: "/repo/app", cwd: "/repo/app/packages/web" }),
        space({ id: "sp-2", folder: "/repo/other", cwd: null }),
        space({ id: "sp-3", folder: "/repo/third", cwd: "" }),
      ],
      null,
    );

    assert.deepEqual(
      rows.map((r) => r.key),
      ["/repo/app/packages/web", "/repo/other", "/repo/third"],
    );
  });

  test("includes remote spaces and skips spaces with neither a cwd nor a folder", () => {
    const rows = projectsFromSpaces(
      [
        space({ id: "sp-local", cwd: "/repo/local" }),
        space({ id: "sp-remote", machine: "vps", cwd: "/repo/remote" }),
        space({ id: "sp-empty", cwd: null, folder: "" }),
        space({ id: "sp-undefined", cwd: undefined, folder: undefined }),
      ],
      null,
    );

    assert.deepEqual(rows, [
      { key: "/repo/local", machine: null, name: "app", git: true, space: "sp-local", busy: false },
      { key: "/repo/remote", machine: "vps", name: "app", git: true, space: "sp-remote", busy: false },
    ]);
  });

  test("reads a space without a machine as local", () => {
    const rows = projectsFromSpaces([space({ id: "sp-1", machine: undefined })], null);

    assert.equal(rows[0].machine, null);
  });

  test("marks a row busy only when its space is working or blocked", () => {
    const rows = projectsFromSpaces(
      ["working", "blocked", "idle", "done"].map((status, i) =>
        space({ id: `sp-${i}`, folder: `/repo/${status}`, cwd: `/repo/${status}`, status }),
      ),
      null,
    );

    assert.deepEqual(
      rows.map((r) => r.busy),
      [true, true, false, false],
    );
  });

  test("gives two spaces in one folder a single row, preferring the active one", () => {
    const first = space({ id: "sp-first", name: "first", branch: null, status: "idle" });
    const second = space({ id: "sp-second", name: "second", branch: "agent/x", status: "blocked" });

    assert.deepEqual(projectsFromSpaces([first, second], null), [
      { key: "/repo/app", machine: null, name: "first", git: false, space: "sp-first", busy: false },
    ]);
    assert.deepEqual(projectsFromSpaces([first, second], "sp-second"), [
      { key: "/repo/app", machine: null, name: "second", git: true, space: "sp-second", busy: true },
    ]);
    assert.deepEqual(projectsFromSpaces([second, first], "sp-first"), [
      { key: "/repo/app", machine: null, name: "first", git: false, space: "sp-first", busy: false },
    ]);
  });

  test("dedupes one folder on one machine, preferring that machine's active space", () => {
    const first = space({ id: "sp-first", machine: "wsl", name: "first", branch: null, status: "idle" });
    const second = space({ id: "sp-second", machine: "wsl", name: "second", branch: "agent/x", status: "blocked" });

    assert.deepEqual(projectsFromSpaces([first, second], null), [
      { key: "/repo/app", machine: "wsl", name: "first", git: false, space: "sp-first", busy: false },
    ]);
    assert.deepEqual(projectsFromSpaces([first, second], "sp-second"), [
      { key: "/repo/app", machine: "wsl", name: "second", git: true, space: "sp-second", busy: true },
    ]);
  });

  test("keeps the same folder on two machines as two rows", () => {
    const rows = projectsFromSpaces(
      [
        space({ id: "sp-local", machine: null, name: "local", cwd: "/repo/app" }),
        space({ id: "sp-wsl", machine: "wsl", name: "wsl", cwd: "/repo/app" }),
        space({ id: "sp-vps", machine: "vps", name: "vps", cwd: "/repo/app" }),
      ],
      "sp-vps",
    );

    assert.deepEqual(
      rows.map((r) => [r.machine, r.space]),
      [
        ["vps", "sp-vps"],
        [null, "sp-local"],
        ["wsl", "sp-wsl"],
      ],
    );
  });

  test("puts the active space's row first and keeps the others in space order", () => {
    const rows = projectsFromSpaces(
      [
        space({ id: "sp-a", folder: "/repo/a", cwd: "/repo/a" }),
        space({ id: "sp-b", folder: "/repo/b", cwd: "/repo/b" }),
        space({ id: "sp-c", folder: "/repo/c", cwd: "/repo/c" }),
        space({ id: "sp-d", folder: "/repo/d", cwd: "/repo/d" }),
      ],
      "sp-c",
    );

    assert.deepEqual(
      rows.map((r) => r.space),
      ["sp-c", "sp-a", "sp-b", "sp-d"],
    );
  });

  test("puts a remote active space's row first", () => {
    const rows = projectsFromSpaces(
      [
        space({ id: "sp-a", folder: "/repo/a", cwd: "/repo/a" }),
        space({ id: "sp-b", machine: "wsl", folder: "/repo/b", cwd: "/repo/b" }),
        space({ id: "sp-c", machine: "vps", folder: "/repo/c", cwd: "/repo/c" }),
      ],
      "sp-c",
    );

    assert.deepEqual(
      rows.map((r) => r.space),
      ["sp-c", "sp-a", "sp-b"],
    );
  });

  test("keeps space order when no space is active", () => {
    const rows = projectsFromSpaces(
      [
        space({ id: "sp-a", folder: "/repo/a", cwd: "/repo/a", active: false }),
        space({ id: "sp-b", machine: "wsl", folder: "/repo/b", cwd: "/repo/b", active: true }),
      ],
      null,
    );

    assert.deepEqual(
      rows.map((r) => r.space),
      ["sp-a", "sp-b"],
    );
  });

  test("returns nothing without spaces", () => {
    assert.deepEqual(projectsFromSpaces([], "sp-1"), []);
  });
});

describe("wantsWorktree", () => {
  test("is always false for a plain folder", () => {
    assert.equal(wantsWorktree({ git: false, busy: 5, choice: true }), false);
  });

  test("follows an explicit choice", () => {
    assert.equal(wantsWorktree({ git: true, busy: 0, choice: true }), true);
    assert.equal(wantsWorktree({ git: true, busy: 3, choice: false }), false);
  });

  test("ignores busy agents: only an explicit choice turns it on", () => {
    assert.equal(wantsWorktree({ git: true, busy: 3, choice: false }), false);
    assert.equal(wantsWorktree({ git: true, busy: 3, choice: null }), false);
  });

  test("defaults to off without a choice", () => {
    assert.equal(wantsWorktree({ git: true }), false);
  });
});

describe("pickAgent", () => {
  const agents = [{ key: "claude" }, { key: "codex" }, { key: "gemini" }];

  test("prefers the preferred agent over the last one used", () => {
    assert.equal(pickAgent(agents, "codex", "claude"), "codex");
  });

  test("falls back to the last used agent when the preferred one is not installed", () => {
    assert.equal(pickAgent(agents, "aider", "gemini"), "gemini");
  });

  test("falls back to the first installed agent when neither is installed", () => {
    assert.equal(pickAgent(agents, "aider", "amp"), "claude");
  });

  test("returns null when no agent is installed", () => {
    assert.equal(pickAgent([], "claude", "codex"), null);
  });

  test("works without a preferred or last agent", () => {
    assert.equal(pickAgent(agents, null, null), "claude");
    assert.equal(pickAgent(agents, undefined, undefined), "claude");
    assert.equal(pickAgent(agents, null, "codex"), "codex");
  });

  test("a requested agent wins over the preferred and the last one", () => {
    assert.equal(pickAgent(agents, "codex", "claude", "gemini"), "gemini");
  });

  test("ignores a requested agent that is not installed", () => {
    assert.equal(pickAgent(agents, "codex", "claude", "aider"), "codex");
    assert.equal(pickAgent(agents, "aider", "gemini", "amp"), "gemini");
    assert.equal(pickAgent(agents, null, null, "amp"), "claude");
  });

  test("works without a requested agent", () => {
    assert.equal(pickAgent(agents, "codex", "claude", null), "codex");
    assert.equal(pickAgent(agents, "codex", "claude", undefined), "codex");
  });

  test("a requested terminal is picked when it is among the choices", () => {
    const withTerminal = [...agents, { key: "terminal" }];
    assert.equal(pickAgent(withTerminal, "claude", "codex", "terminal"), "terminal");
    assert.equal(pickAgent(agents, "claude", "codex", "terminal"), "claude");
  });
});

describe("plainAgent", () => {
  const claude = {
    key: "claude",
    name: "Claude Code",
    icon: "icons/claude.svg",
    tint: false,
    run: ["claude"],
    installed: true,
  };

  test("keeps the five chip fields and drops everything else", () => {
    assert.deepEqual(plainAgent(claude), {
      key: "claude",
      name: "Claude Code",
      icon: "icons/claude.svg",
      tint: false,
      run: ["claude"],
    });
    assert.ok(!Object.hasOwn(plainAgent(claude), "installed"));
  });

  test("reads a missing or non-string icon as null", () => {
    assert.equal(plainAgent({ key: "x", name: "X", run: ["x"] }).icon, null);
    assert.equal(plainAgent({ key: "x", name: "X", icon: 42, run: ["x"] }).icon, null);
  });

  test("coerces the tint to a Boolean", () => {
    assert.equal(plainAgent({ key: "x", name: "X", tint: "yes", run: ["x"] }).tint, true);
    assert.equal(plainAgent({ key: "x", name: "X", tint: 0, run: ["x"] }).tint, false);
    assert.equal(plainAgent({ key: "x", name: "X", run: ["x"] }).tint, false);
  });

  test("keeps the run command and every argument", () => {
    assert.deepEqual(plainAgent({ key: "x", name: "X", run: ["x", "--flag", "a b"] }).run, ["x", "--flag", "a b"]);
    assert.deepEqual(plainAgent({ key: "x", name: "X", run: "x" }).run, []);
  });

  test("does not change the agent it was given", () => {
    const input = { ...claude, run: [...claude.run] };

    plainAgent(input);

    assert.deepEqual(input, claude);
  });
});

describe("agentLists", () => {
  const claude = {
    key: "claude",
    name: "Claude Code",
    icon: "icons/claude.svg",
    tint: false,
    run: ["claude"],
    installed: true,
  };
  const claudePlain = { key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: false, run: ["claude"] };
  const codex = { key: "codex", name: "Codex", icon: "icons/codex.svg", tint: true, run: ["codex"] };
  const codexPlain = { key: "codex", name: "Codex", icon: "icons/codex.svg", tint: true, run: ["codex"] };

  test("migrates the old stored array to the local machine's list", () => {
    assert.deepEqual(agentLists([claude, codex]), { "": [claudePlain, codexPlain] });
  });

  test("drops invalid agents from a legacy array", () => {
    const list = [null, "text", 42, [], {}, { name: "no key" }, { key: "x", name: "X", run: "x" }, claude];

    assert.deepEqual(agentLists(list), { "": [claudePlain] });
  });

  test("reads an object map of machines, plainifying every list", () => {
    const lists = agentLists({ "": [claude], wsl: [codex], vps: "not a list", bad: null });

    assert.deepEqual(lists, { "": [claudePlain], wsl: [codexPlain] });
  });

  test("drops an invalid agent from a machine's list", () => {
    assert.deepEqual(agentLists({ wsl: [null, codex, 3] }), { wsl: [codexPlain] });
  });

  test("reads a missing or garbage stored value as no lists", () => {
    for (const value of [undefined, null, "not json", 42, true, {}]) {
      assert.deepEqual(agentLists(value), {}, `value: ${JSON.stringify(value)}`);
    }
  });

  test("does not change the stored array it was given", () => {
    const stored = Object.freeze([Object.freeze({ ...claude, run: Object.freeze([...claude.run]) })]);

    const lists = agentLists(stored);

    assert.deepEqual(lists, { "": [claudePlain] });
    assert.deepEqual(stored, [claude]);
  });

  test("does not change the stored machine map it was given", () => {
    const stored = { wsl: [claude] };

    const lists = agentLists(stored);

    assert.deepEqual(lists, { wsl: [claudePlain] });
    assert.deepEqual(stored, { wsl: [claude] });
  });
});

describe("agentsOn", () => {
  const local = [{ key: "claude" }];
  const wsl = [{ key: "codex" }];
  const lists = { "": local, wsl };

  test("returns the list for a machine, or an empty list when it has none", () => {
    assert.deepEqual(agentsOn(lists, "wsl"), wsl);
    assert.deepEqual(agentsOn(lists, "vps"), []);
    assert.deepEqual(agentsOn({}, "wsl"), []);
  });

  test("reads no machine as the local list", () => {
    assert.deepEqual(agentsOn(lists, null), local);
    assert.deepEqual(agentsOn(lists, undefined), local);
  });
});

describe("setAgentsOn", () => {
  const local = [{ key: "claude", name: "Claude", icon: null, tint: false, run: ["claude"] }];
  const wsl = [{ key: "codex", name: "Codex", icon: null, tint: false, run: ["codex"] }];
  const vps = [{ key: "gemini", name: "Gemini", tint: true, run: ["gemini"], installed: true }];
  const vpsPlain = { key: "gemini", name: "Gemini", icon: null, tint: true, run: ["gemini"] };

  test("sets a machine's list and keeps the other machines", () => {
    const lists = { "": local, wsl };

    assert.deepEqual(setAgentsOn(lists, "vps", vps), { "": local, wsl, vps: [vpsPlain] });
  });

  test("replaces a machine's list", () => {
    const lists = { "": local, wsl };

    assert.deepEqual(setAgentsOn(lists, "wsl", vps), { "": local, wsl: [vpsPlain] });
  });

  test("sets the local list when there is no machine", () => {
    assert.deepEqual(setAgentsOn({}, null, vps), { "": [vpsPlain] });
    assert.deepEqual(setAgentsOn({}, undefined, vps), { "": [vpsPlain] });
  });

  test("does not change the map it was given", () => {
    const lists = Object.freeze({ "": Object.freeze([...local]) });

    const next = setAgentsOn(lists, "wsl", vps);

    assert.deepEqual(lists, { "": local });
    assert.deepEqual(next, { "": local, wsl: [vpsPlain] });
  });
});

describe("launchPlan", () => {
  const agent = { name: "Claude", run: ["claude", "--flag"] };
  const project = { key: "/repo/app", name: "app", git: true, space: "sp-1", at: 0 };

  test("opens a new space on the worktree path", () => {
    assert.deepEqual(
      launchPlan({ project, agent, task: "Fix it", worktree: true, path: "/home/me/.herdr/worktrees/app/agent-fix-it" }),
      [
        ["space.new", {
          folder: "/home/me/.herdr/worktrees/app/agent-fix-it",
          tab: "Claude",
          argv: ["claude", "--flag"],
          task: "Fix it",
        }],
      ],
    );
  });

  test("opens a tab in the project's existing space", () => {
    assert.deepEqual(launchPlan({ project, agent, task: "Fix it", worktree: false }), [
      ["space.select", { id: "sp-1" }],
      ["tab.new", {
        name: "Claude",
        space: "sp-1",
        folder: "/repo/app",
        argv: ["claude", "--flag"],
        task: "Fix it",
      }],
    ]);
  });

  test("opens a new space on the project when it has no space", () => {
    const noSpace = { key: "/repo/app", name: "app", git: true, space: null, at: 0 };

    assert.deepEqual(launchPlan({ project: noSpace, agent, task: "Fix it", worktree: false }), [
      ["space.new", {
        folder: "/repo/app",
        tab: "Claude",
        argv: ["claude", "--flag"],
        task: "Fix it",
      }],
    ]);
  });

  test("trims the task and omits it when blank", () => {
    const plan = launchPlan({ project, agent, task: "   ", worktree: false });

    assert.equal(plan[1][1].task, undefined);
    assert.ok(!Object.hasOwn(plan[1][1], "task"));
  });

  test("trims a given task", () => {
    const plan = launchPlan({ project, agent, task: "  do it  ", worktree: false });

    assert.equal(plan[1][1].task, "do it");
  });
});

describe("agentArgv", () => {
  test("delivers a task as Herdr's stock positional argument for other agents", () => {
    for (const key of ["claude", "codex", "cursor", "gemini", "aider", undefined]) {
      const run = [key ?? "unknown", "--flag"];
      assert.deepEqual(agentArgv({ key, run }, "  Fix it  "), { argv: run, task: "Fix it" });
    }
  });

  test("starts opencode with its prompt flag instead of a positional folder", () => {
    const run = ["opencode"];
    assert.deepEqual(agentArgv({ key: "opencode", run }, "  ahoj  "), {
      argv: ["opencode", "--prompt", "ahoj"],
    });
  });

  test("starts copilot and antigravity with their interactive prompt flag", () => {
    for (const key of ["copilot", "antigravity"]) {
      const run = [key];
      assert.deepEqual(agentArgv({ key, run }, "  ahoj  "), {
        argv: [key, "-i", "ahoj"],
      });
    }
  });

  test("marks kimi as unable to take a prompt at start", () => {
    const run = ["kimi"];
    assert.deepEqual(agentArgv({ key: "kimi", run }, "ahoj"), { argv: run, unsupported: true });
  });

  test("only the stock delivery carries a task key", () => {
    for (const key of ["opencode", "copilot", "antigravity", "kimi"]) {
      const result = agentArgv({ key, run: [key] }, "ahoj");
      assert.ok(!Object.hasOwn(result, "task"), `${key} must not carry a task key`);
    }
  });

  test("a blank task starts the agent with its run command unchanged", () => {
    for (const key of ["opencode", "copilot", "kimi", "claude"]) {
      const run = [key, "--flag"];
      assert.deepEqual(agentArgv({ key, run }, "   "), { argv: run });
      assert.deepEqual(agentArgv({ key, run }, ""), { argv: run });
      assert.deepEqual(agentArgv({ key, run }, undefined), { argv: run });
    }
  });

  test("does not mutate the agent's run array", () => {
    const run = Object.freeze(["opencode"]);
    const agent = Object.freeze({ key: "opencode", run });

    assert.deepEqual(agentArgv(agent, "ahoj"), { argv: ["opencode", "--prompt", "ahoj"] });
    assert.deepEqual(run, ["opencode"]);
  });
});

describe("launchPlan with a task-taking agent", () => {
  const agent = { key: "opencode", name: "OpenCode", run: ["opencode"] };
  const project = { key: "/repo/app", name: "app", git: true, space: "sp-1", at: 0 };
  const argv = ["opencode", "--prompt", "ahoj"];

  test("opens a new space on the worktree path with the prompt flag", () => {
    assert.deepEqual(
      launchPlan({ project, agent, task: " ahoj ", worktree: true, path: "/home/me/.herdr/worktrees/app/agent-ahoj" }),
      [
        ["space.new", {
          folder: "/home/me/.herdr/worktrees/app/agent-ahoj",
          tab: "OpenCode",
          argv,
        }],
      ],
    );
  });

  test("opens a tab in the project's existing space with the prompt flag", () => {
    assert.deepEqual(launchPlan({ project, agent, task: "ahoj", worktree: false }), [
      ["space.select", { id: "sp-1" }],
      ["tab.new", {
        name: "OpenCode",
        space: "sp-1",
        folder: "/repo/app",
        argv,
      }],
    ]);
  });

  test("opens a new space on the project with the prompt flag", () => {
    const noSpace = { key: "/repo/app", name: "app", git: true, space: null, at: 0 };

    assert.deepEqual(launchPlan({ project: noSpace, agent, task: "ahoj", worktree: false }), [
      ["space.new", {
        folder: "/repo/app",
        tab: "OpenCode",
        argv,
      }],
    ]);
  });

  test("keeps the stock task for an agent that takes one", () => {
    const claude = { key: "claude", name: "Claude", run: ["claude", "--flag"] };
    const plan = launchPlan({ project, agent: claude, task: "Fix it", worktree: false });

    assert.deepEqual(plan[1][1].argv, ["claude", "--flag"]);
    assert.equal(plan[1][1].task, "Fix it");
  });
});

describe("launchPlan for a remote project", () => {
  const agent = { key: "claude", name: "Claude", run: ["claude", "--flag"] };
  const project = { key: "/repo/app", machine: "wsl", name: "app", git: true, space: "sp-1", at: 0 };
  const noSpace = { key: "/repo/app", machine: "wsl", name: "app", git: true, space: null, at: 0 };

  test("opens the worktree's space on the project's machine", () => {
    assert.deepEqual(
      launchPlan({ project, agent, task: "Fix it", worktree: true, path: "/home/me/.herdr/worktrees/app/agent-fix-it" }),
      [
        ["space.new", {
          folder: "/home/me/.herdr/worktrees/app/agent-fix-it",
          machine: "wsl",
          tab: "Claude",
          argv: ["claude", "--flag"],
          task: "Fix it",
        }],
      ],
    );
  });

  test("opens a space on the project's machine when it has no space", () => {
    assert.deepEqual(launchPlan({ project: noSpace, agent, task: "Fix it", worktree: false }), [
      ["space.new", {
        folder: "/repo/app",
        machine: "wsl",
        tab: "Claude",
        argv: ["claude", "--flag"],
        task: "Fix it",
      }],
    ]);
  });

  test("puts the machine on the terminal's new space", () => {
    assert.deepEqual(launchPlan({ project: noSpace, agent: TERMINAL, task: "", worktree: false }), [
      ["space.new", { folder: "/repo/app", machine: "wsl" }],
    ]);
    assert.deepEqual(
      launchPlan({ project, agent: TERMINAL, task: "", worktree: true, path: "/home/me/.herdr/worktrees/app/agent-x" }),
      [["space.new", { folder: "/home/me/.herdr/worktrees/app/agent-x", machine: "wsl" }]],
    );
  });

  test("keeps a task-taking agent's prompt with the machine", () => {
    const opencode = { key: "opencode", name: "OpenCode", run: ["opencode"] };

    assert.deepEqual(
      launchPlan({ project, agent: opencode, task: " ahoj ", worktree: true, path: "/h/wt" }),
      [["space.new", { folder: "/h/wt", machine: "wsl", tab: "OpenCode", argv: ["opencode", "--prompt", "ahoj"] }]],
    );
  });

  test("does not put a machine on a tab in an existing space", () => {
    const plan = launchPlan({ project, agent, task: "Fix it", worktree: false });

    assert.deepEqual(plan, [
      ["space.select", { id: "sp-1" }],
      ["tab.new", {
        name: "Claude",
        space: "sp-1",
        folder: "/repo/app",
        argv: ["claude", "--flag"],
        task: "Fix it",
      }],
    ]);
    for (const [command, args] of plan) {
      assert.ok(!Object.hasOwn(args, "machine"), `${command} must not carry a machine`);
    }
  });

  test("does not put a machine on the terminal's tab in an existing space", () => {
    const plan = launchPlan({ project, agent: TERMINAL, task: "", worktree: false });

    assert.deepEqual(plan, [
      ["space.select", { id: "sp-1" }],
      ["tab.new", { space: "sp-1", folder: "/repo/app" }],
    ]);
    for (const [command, args] of plan) {
      assert.ok(!Object.hasOwn(args, "machine"), `${command} must not carry a machine`);
    }
  });

  test("leaves a local plan without a machine key", () => {
    for (const machine of [null, undefined, ""]) {
      const plan = launchPlan({ project: { ...project, machine }, agent, task: "Fix it", worktree: false });

      for (const [command, args] of plan) {
        assert.ok(!Object.hasOwn(args, "machine"), `${command} with machine ${JSON.stringify(machine)}`);
      }
    }
  });
});

describe("parseRepo", () => {
  test("reads the main checkout from a plain repo's two git lines", () => {
    assert.deepEqual(parseRepo("/a/repo\n/a/repo/.git\n"), {
      top: "/a/repo",
      main: "/a/repo",
      name: "repo",
      linked: false,
    });
  });

  test("reads a linked worktree's top and its main checkout", () => {
    assert.deepEqual(parseRepo("/h/.herdr/worktrees/repo/x\n/a/repo/.git\n"), {
      top: "/h/.herdr/worktrees/repo/x",
      main: "/a/repo",
      name: "repo",
      linked: true,
    });
  });

  test("is null when git printed no common dir line", () => {
    assert.equal(parseRepo("/a/repo\n"), null);
    assert.equal(parseRepo("/a/repo"), null);
    assert.equal(parseRepo(""), null);
  });
});

describe("readRecent", () => {
  const entry = (folder, name, git = false, machine = null) => ({ folder, name, git, machine });

  test("reads a stored list of projects with its machines", () => {
    const stored = [entry("/work/api", "api", true, "wsl"), entry("/work/site", "site", false)];

    assert.deepEqual(readRecent(stored), stored);
  });

  test("reads an entry without a machine as local", () => {
    assert.deepEqual(readRecent([{ folder: "/work/api", name: "api", git: true }]), [
      { folder: "/work/api", machine: null, name: "api", git: true },
    ]);
  });

  test("reads a garbage machine as local instead of dropping the entry", () => {
    const list = readRecent([
      { folder: "/a", name: "a", machine: 42 },
      { folder: "/b", name: "b", machine: "" },
      { folder: "/c", name: "c", machine: ["wsl"] },
      { folder: "/d", name: "d", machine: true },
    ]);

    assert.deepEqual(
      list.map((e) => [e.folder, e.machine]),
      [
        ["/a", null],
        ["/b", null],
        ["/c", null],
        ["/d", null],
      ],
    );
  });

  test("falls back to the folder's last segment for a missing name", () => {
    assert.deepEqual(readRecent([{ folder: "C:\\work\\api", machine: "wsl" }]), [
      { folder: "C:\\work\\api", machine: "wsl", name: "api", git: false },
    ]);
  });

  test("reads a missing or garbage stored value as an empty list", () => {
    for (const value of [undefined, null, "not json", 42, true, {}, { folder: "/work/api" }]) {
      assert.deepEqual(readRecent(value), [], `value: ${JSON.stringify(value)}`);
    }
  });

  test("drops invalid entries and keeps the valid ones in order", () => {
    const good = entry("/work/api", "api", true);
    const also = entry("/work/site", "site", false, "wsl");

    const list = readRecent([
      null,
      "text",
      42,
      [],
      {},
      { folder: "", name: "empty", git: false },
      { folder: 7, name: "number", git: false },
      { name: "no folder", git: true },
      good,
      also,
    ]);

    assert.deepEqual(list, [good, also]);
  });
});

describe("readFavorites", () => {
  const entry = (folder, name, git = false, machine = null) => ({ folder, name, git, machine });

  test("reads a stored list of favourite folders with their machines", () => {
    const stored = [entry("/work/api", "api", true, "wsl"), entry("/work/site", "site")];

    assert.deepEqual(readFavorites(stored), stored);
  });

  test("reads a missing or garbage stored value as an empty list and drops invalid entries", () => {
    for (const value of [undefined, null, "not json", 42, true, {}, { folder: "/work/api" }]) {
      assert.deepEqual(readFavorites(value), [], `value: ${JSON.stringify(value)}`);
    }
    assert.deepEqual(readFavorites([null, "text", 42, {}, { name: "no folder" }, entry("/a", "a")]), [
      entry("/a", "a"),
    ]);
  });
});

describe("toggleFavorite", () => {
  const entry = (folder, name = folder.split("/").pop(), git = false, machine = null) => ({
    folder,
    machine,
    name,
    git,
  });

  test("adds a new favourite at the front, normalized", () => {
    const list = toggleFavorite([entry("/work/api", "api")], { folder: "/work/site", name: "site", git: 1 });

    assert.deepEqual(list, [entry("/work/site", "site", true), entry("/work/api", "api")]);
  });

  test("reads a missing machine as local", () => {
    assert.deepEqual(toggleFavorite([], { folder: "/work/api", name: "api", git: true }), [
      entry("/work/api", "api", true),
    ]);
  });

  test("removes a stored favourite and keeps the order of the rest", () => {
    const before = [entry("/work/api"), entry("/work/site"), entry("/work/blog")];

    assert.deepEqual(toggleFavorite(before, entry("/work/site")), [entry("/work/api"), entry("/work/blog")]);
  });

  test("matches the machine when it removes a favourite", () => {
    const before = [entry("/repo/app", "app", false, null), entry("/repo/app", "app", true, "wsl")];

    assert.deepEqual(toggleFavorite(before, entry("/repo/app", "app", true, "wsl")), [
      entry("/repo/app", "app", false, null),
    ]);
  });

  test("keeps the same folder on two machines as two entries", () => {
    const list = toggleFavorite([entry("/repo/app", "app", false, null)], entry("/repo/app", "app", true, "wsl"));

    assert.deepEqual(list, [entry("/repo/app", "app", true, "wsl"), entry("/repo/app", "app", false, null)]);
  });

  test("caps the list at 50 favourites by default, dropping the oldest", () => {
    let list = [];
    for (let i = 0; i < 55; i++) list = toggleFavorite(list, entry(`/work/p${i}`));

    assert.equal(list.length, 50);
    assert.equal(list[0].folder, "/work/p54");
    assert.equal(list[49].folder, "/work/p5");
  });

  test("takes the cap as an argument", () => {
    const list = toggleFavorite([entry("/a"), entry("/b"), entry("/c")], entry("/d"), 2);

    assert.deepEqual(
      list.map((f) => f.folder),
      ["/d", "/a"],
    );
  });

  test("does not change the list it was given", () => {
    const before = Object.freeze([Object.freeze(entry("/work/api"))]);

    const list = toggleFavorite(before, entry("/work/site"));

    assert.equal(before.length, 1);
    assert.equal(list.length, 2);
    assert.notEqual(list, before);
  });
});

describe("pickFavorite", () => {
  const starred = (folder) => ({ key: folder, machine: null, starred: true, favorite: { folder, machine: null } });
  const plain = (folder) => ({ key: folder, machine: null });

  test("picks the first starred row, skipping rows without a star", () => {
    const rows = [plain("/a"), starred("/b"), plain("/c"), starred("/d")];

    assert.equal(pickFavorite(rows, 1).key, "/b");
  });

  test("picks the nth starred row", () => {
    const rows = [plain("/a"), starred("/b"), plain("/c"), starred("/d")];

    assert.equal(pickFavorite(rows, 2).key, "/d");
  });

  test("returns null out of range or when nothing is starred", () => {
    const rows = [plain("/a"), starred("/b")];

    assert.equal(pickFavorite(rows, 0), null);
    assert.equal(pickFavorite(rows, 2), null);
    assert.equal(pickFavorite([], 1), null);
    assert.equal(pickFavorite([plain("/a")], 1), null);
  });
});

describe("rememberProject", () => {
  const entry = (folder, name = folder.split("/").pop(), git = false, machine = null) => ({
    folder,
    name,
    git,
    machine,
  });

  test("puts the project first in an empty list", () => {
    assert.deepEqual(rememberProject([], entry("/work/api", "api", true)), [entry("/work/api", "api", true)]);
  });

  test("reads a missing machine as local", () => {
    assert.deepEqual(rememberProject([], { folder: "/work/api", name: "api", git: true }), [
      entry("/work/api", "api", true),
    ]);
  });

  test("puts the newest project first", () => {
    const list = rememberProject([entry("/work/api")], entry("/work/site"));

    assert.deepEqual(
      list.map((p) => p.folder),
      ["/work/site", "/work/api"],
    );
  });

  test("dedupes by folder on one machine, moving the project to the front with its new values", () => {
    const before = [entry("/work/api", "api", false), entry("/work/site"), entry("/work/blog")];

    const list = rememberProject(before, entry("/work/site", "site", true));

    assert.deepEqual(list, [entry("/work/site", "site", true), entry("/work/api", "api", false), entry("/work/blog")]);
  });

  test("keeps the same folder on two machines as two entries", () => {
    const before = [entry("/repo/app", "app", false, null), entry("/work/blog")];

    const list = rememberProject(before, entry("/repo/app", "app", true, "wsl"));

    assert.deepEqual(list, [
      entry("/repo/app", "app", true, "wsl"),
      entry("/repo/app", "app", false, null),
      entry("/work/blog"),
    ]);
  });

  test("caps the list at 30 projects by default, dropping the oldest", () => {
    let list = [];
    for (let i = 0; i < 35; i++) list = rememberProject(list, entry(`/work/p${i}`));

    assert.equal(list.length, 30);
    assert.equal(list[0].folder, "/work/p34");
    assert.equal(list[29].folder, "/work/p5");
  });

  test("takes the cap as an argument", () => {
    const list = rememberProject([entry("/a"), entry("/b"), entry("/c")], entry("/d"), 2);

    assert.deepEqual(
      list.map((p) => p.folder),
      ["/d", "/a"],
    );
  });

  test("does not change the list it was given", () => {
    const before = Object.freeze([Object.freeze(entry("/work/api"))]);

    const list = rememberProject(before, entry("/work/site"));

    assert.equal(before.length, 1);
    assert.equal(list.length, 2);
  });
});

describe("projectList", () => {
  const row = (over = {}) => ({
    key: "/repo/app",
    machine: null,
    name: "app",
    git: true,
    space: "sp-1",
    busy: false,
    ...over,
  });
  const space = (over = {}) => ({
    id: "sp-1",
    name: "app",
    folder: "/repo/app",
    cwd: "/repo/app",
    machine: null,
    ...over,
  });
  const hist = (folder, name = folder.split("/").pop(), git = false, machine = null) => ({
    folder,
    machine,
    name,
    git,
  });

  test("lists the open spaces first, then remembered projects without a space", () => {
    const rows = projectList(
      [row({ key: "/a", name: "a", space: "sp-a" }), row({ key: "/b", name: "b", space: "sp-b" })],
      [hist("/work/api", "api", true), hist("/work/site", "site", false)],
    );

    assert.deepEqual(rows, [
      { key: "/a", machine: null, name: "a", git: true, space: "sp-a", busy: false },
      { key: "/b", machine: null, name: "b", git: true, space: "sp-b", busy: false },
      { key: "/work/api", machine: null, name: "api", git: true, space: null, busy: false },
      { key: "/work/site", machine: null, name: "site", git: false, space: null, busy: false },
    ]);
  });

  test("passes a remote space row through with its machine", () => {
    const spaceRows = [row({ key: "/srv/app", machine: "vps", name: "app", space: "sp-9" })];

    assert.deepEqual(projectList(spaceRows, []), spaceRows);
  });

  test("keeps remembered projects in most recently started order", () => {
    const rows = projectList([], [hist("/new"), hist("/mid"), hist("/old")]);

    assert.deepEqual(
      rows.map((r) => r.key),
      ["/new", "/mid", "/old"],
    );
  });

  test("merges a remembered project into the open space with the same live folder", () => {
    const rows = projectList(
      [row({ key: "/repo/app/packages/web", name: "web", space: "sp-1", busy: true })],
      [hist("/repo/app/packages/web", "web", false)],
      [space({ cwd: "/repo/app/packages/web" })],
    );

    assert.deepEqual(rows, [
      { key: "/repo/app/packages/web", machine: null, name: "web", git: true, space: "sp-1", busy: true },
    ]);
  });

  test("merges a remembered project into the open space whose folder matches, not its live cwd", () => {
    const rows = projectList(
      [row({ key: "/repo/app/packages/web", name: "app", space: "sp-1" })],
      [hist("/repo/app", "app", true), hist("/work/api", "api", true)],
      [space({ id: "sp-1", folder: "/repo/app", cwd: "/repo/app/packages/web" })],
    );

    assert.deepEqual(
      rows.map((r) => [r.key, r.machine, r.space]),
      [
        ["/repo/app/packages/web", null, "sp-1"],
        ["/work/api", null, null],
      ],
    );
  });

  test("keeps a local history entry next to a remote space with the same folder", () => {
    const rows = projectList(
      [row({ key: "/repo/app", machine: "wsl", name: "app", space: "sp-1" })],
      [hist("/repo/app", "app")],
      [space({ id: "sp-1", machine: "wsl", folder: "/repo/app", cwd: "/repo/app" })],
    );

    assert.deepEqual(rows, [
      { key: "/repo/app", machine: "wsl", name: "app", git: true, space: "sp-1", busy: false },
      { key: "/repo/app", machine: null, name: "app", git: false, space: null, busy: false },
    ]);
  });

  test("swallows a remembered project in a matching folder on the same machine", () => {
    const rows = projectList(
      [row({ key: "/repo/app/packages/web", machine: "wsl", space: "sp-1" })],
      [hist("/repo/app", "app", true, "wsl"), hist("/repo/app", "app", true, null)],
      [space({ id: "sp-1", machine: "wsl", folder: "/repo/app", cwd: "/repo/app/packages/web" })],
    );

    assert.deepEqual(rows, [
      { key: "/repo/app/packages/web", machine: "wsl", name: "app", git: true, space: "sp-1", busy: false },
      { key: "/repo/app", machine: null, name: "app", git: true, space: null, busy: false },
    ]);
  });

  test("does not let a remote space swallow a local entry that only matches its key", () => {
    const rows = projectList(
      [row({ key: "/repo/app", machine: "wsl", space: "sp-1" })],
      [hist("/repo/app", "app", true, null)],
    );

    assert.deepEqual(
      rows.map((r) => [r.key, r.machine, r.space]),
      [
        ["/repo/app", "wsl", "sp-1"],
        ["/repo/app", null, null],
      ],
    );
  });

  test("keeps remembered projects with the same folder on different machines", () => {
    const rows = projectList([], [hist("/repo/app", "app", true, "wsl"), hist("/repo/app", "app", false)]);

    assert.deepEqual(
      rows.map((r) => [r.machine, r.key, r.git]),
      [
        ["wsl", "/repo/app", true],
        [null, "/repo/app", false],
      ],
    );
  });

  test("shows a folder once even when several remembered entries and spaces share it", () => {
    const rows = projectList(
      [row({ key: "/a", space: "sp-a" })],
      [hist("/a"), hist("/b"), hist("/a")],
    );

    assert.deepEqual(
      rows.map((r) => r.key),
      ["/a", "/b"],
    );
  });

  test("returns nothing when there are no spaces and no history", () => {
    assert.deepEqual(projectList([], []), []);
  });
});

describe("projectList with favourites", () => {
  const row = (over = {}) => ({
    key: "/repo/app",
    machine: null,
    name: "app",
    git: true,
    space: "sp-1",
    busy: false,
    ...over,
  });
  const space = (over = {}) => ({
    id: "sp-1",
    name: "app",
    folder: "/repo/app",
    cwd: "/repo/app",
    machine: null,
    ...over,
  });
  const hist = (folder, name = folder.split("/").pop(), git = false, machine = null) => ({
    folder,
    machine,
    name,
    git,
  });
  const fav = (folder, name = folder.split("/").pop(), git = true, machine = null) => ({
    folder,
    machine,
    name,
    git,
  });

  test("marks a favourite that matches an open space and moves it first", () => {
    const rows = projectList(
      [
        row({ key: "/repo/site", name: "site", space: "sp-2" }),
        row({ key: "/repo/app", name: "app", space: "sp-1", busy: true }),
      ],
      [],
      [],
      [fav("/repo/app", "app", true)],
    );

    assert.deepEqual(rows, [
      {
        key: "/repo/app",
        machine: null,
        name: "app",
        git: true,
        space: "sp-1",
        busy: true,
        starred: true,
        favorite: { folder: "/repo/app", machine: null },
      },
      { key: "/repo/site", machine: null, name: "site", git: true, space: "sp-2", busy: false },
    ]);
  });

  test("marks a favourite that matches only the space's folder, not its live key", () => {
    const rows = projectList(
      [row({ key: "/repo/app/packages/web", name: "app", space: "sp-1" })],
      [],
      [space({ id: "sp-1", folder: "/repo/app", cwd: "/repo/app/packages/web" })],
      [fav("/repo/app", "app", true)],
    );

    assert.deepEqual(rows, [
      {
        key: "/repo/app/packages/web",
        machine: null,
        name: "app",
        git: true,
        space: "sp-1",
        busy: false,
        starred: true,
        favorite: { folder: "/repo/app", machine: null },
      },
    ]);
  });

  test("marks a favourite that matches a remembered project and moves it first", () => {
    const rows = projectList(
      [],
      [hist("/work/site", "site", false), hist("/work/api", "api", true)],
      [],
      [fav("/work/api", "api", true)],
    );

    assert.deepEqual(rows, [
      {
        key: "/work/api",
        machine: null,
        name: "api",
        git: true,
        space: null,
        busy: false,
        starred: true,
        favorite: { folder: "/work/api", machine: null },
      },
      { key: "/work/site", machine: null, name: "site", git: false, space: null, busy: false },
    ]);
  });

  test("adds a favourite with no matching row as a new project first", () => {
    const rows = projectList(
      [row({ key: "/a", name: "a", space: "sp-a" })],
      [],
      [],
      [fav("/work/new", "new", true), fav("/srv/api", "api", false, "vps")],
    );

    assert.deepEqual(rows, [
      {
        key: "/work/new",
        machine: null,
        name: "new",
        git: true,
        space: null,
        busy: false,
        starred: true,
        favorite: { folder: "/work/new", machine: null },
      },
      {
        key: "/srv/api",
        machine: "vps",
        name: "api",
        git: false,
        space: null,
        busy: false,
        starred: true,
        favorite: { folder: "/srv/api", machine: "vps" },
      },
      { key: "/a", machine: null, name: "a", git: true, space: "sp-a", busy: false },
    ]);
  });

  test("stars only the machine the favourite belongs to", () => {
    const rows = projectList(
      [
        row({ key: "/repo/app", machine: null, name: "app", space: "sp-local" }),
        row({ key: "/repo/app", machine: "wsl", name: "app", space: "sp-wsl" }),
      ],
      [],
      [],
      [fav("/repo/app", "app", true, "wsl")],
    );

    assert.deepEqual(rows, [
      {
        key: "/repo/app",
        machine: "wsl",
        name: "app",
        git: true,
        space: "sp-wsl",
        busy: false,
        starred: true,
        favorite: { folder: "/repo/app", machine: "wsl" },
      },
      { key: "/repo/app", machine: null, name: "app", git: true, space: "sp-local", busy: false },
    ]);
    assert.ok(!Object.hasOwn(rows[1], "starred"), "an unstarred row must not carry a starred key");
  });

  test("puts several favourites first in their stored order", () => {
    const rows = projectList(
      [
        row({ key: "/a", name: "a", space: "sp-a" }),
        row({ key: "/b", name: "b", space: "sp-b" }),
        row({ key: "/c", name: "c", space: "sp-c" }),
        row({ key: "/d", name: "d", space: "sp-d" }),
      ],
      [],
      [],
      [fav("/c", "c", true), fav("/a", "a", true)],
    );

    assert.deepEqual(
      rows.map((r) => [r.key, r.starred]),
      [
        ["/c", true],
        ["/a", true],
        ["/b", undefined],
        ["/d", undefined],
      ],
    );
  });

  test("shows a favourite once when it matches both an open space and the history", () => {
    const rows = projectList(
      [row({ key: "/repo/app/packages/web", name: "app", space: "sp-1" })],
      [hist("/repo/app", "app", true), hist("/repo/work/api", "api", true)],
      [space({ id: "sp-1", folder: "/repo/app", cwd: "/repo/app/packages/web" })],
      [fav("/repo/app", "app", true)],
    );

    assert.deepEqual(rows, [
      {
        key: "/repo/app/packages/web",
        machine: null,
        name: "app",
        git: true,
        space: "sp-1",
        busy: false,
        starred: true,
        favorite: { folder: "/repo/app", machine: null },
      },
      { key: "/repo/work/api", machine: null, name: "api", git: true, space: null, busy: false },
    ]);
  });

  test("leaves the list unchanged when there are no favourites", () => {
    const spaceRows = [
      row({ key: "/a", name: "a", space: "sp-a" }),
      row({ key: "/b", machine: "wsl", name: "b", space: "sp-b" }),
    ];
    const recent = [hist("/work/api", "api", true), hist("/a", "a")];
    const spaces = [space({ id: "sp-b", machine: "wsl", folder: "/repo/b", cwd: "/b" })];

    assert.deepEqual(projectList(spaceRows, recent, spaces, []), projectList(spaceRows, recent, spaces));
  });
});

describe("filterProjects", () => {
  const rows = [
    { key: "/home/me/work/Příliš", machine: null, name: "Příliš", git: true, space: "sp-1", busy: false },
    { key: "/home/me/projects/api", machine: null, name: "api", git: true, space: null, busy: false },
    { key: "/srv/Site", machine: null, name: "Site", git: false, space: null, busy: false },
  ];
  const home = "/home/me";
  const names = (list) => list.map((r) => r.name);

  test("returns the same rows array for an empty or blank filter", () => {
    assert.equal(filterProjects(rows, "", home), rows);
    assert.equal(filterProjects(rows, "   ", home), rows);
  });

  test("matches a substring of the name, ignoring case", () => {
    assert.deepEqual(names(filterProjects(rows, "SIT", home)), ["Site"]);
    assert.deepEqual(names(filterProjects(rows, "pi", home)), ["api"]);
  });

  test("ignores diacritics on both sides", () => {
    assert.deepEqual(names(filterProjects(rows, "prilis", home)), ["Příliš"]);
    assert.deepEqual(names(filterProjects(rows, "PŘÍL", home)), ["Příliš"]);
  });

  test("matches a substring of the raw folder path", () => {
    assert.deepEqual(names(filterProjects(rows, "me/projects", home)), ["api"]);
    assert.deepEqual(names(filterProjects(rows, "/srv", home)), ["Site"]);
  });

  test("matches the ~ form of the folder path", () => {
    assert.deepEqual(names(filterProjects(rows, "~/projects", home)), ["api"]);
    assert.deepEqual(names(filterProjects(rows, "~/work", home)), ["Příliš"]);
  });

  test("does not read ~ into folders outside the home folder", () => {
    assert.deepEqual(filterProjects(rows, "~/srv", home), []);
  });

  test("matches a remote row's machine name, ignoring case and diacritics", () => {
    const remoteRows = [
      { key: "/srv/app", machine: "wsl", name: "app", git: true, space: null, busy: false },
      { key: "/srv/site", machine: "vps-příliš", name: "site", git: true, space: null, busy: false },
      { key: "/srv/local", machine: null, name: "local", git: true, space: null, busy: false },
    ];

    assert.deepEqual(names(filterProjects(remoteRows, "wsl", home)), ["app"]);
    assert.deepEqual(names(filterProjects(remoteRows, "VPS-PRILIS", home)), ["site"]);
    assert.deepEqual(names(filterProjects(remoteRows, "WSL", home)), ["app"]);
  });

  test("does not read ~ into a remote row with the same absolute path", () => {
    const mixed = [
      { key: "/home/me/projects/api", machine: null, name: "api", git: true, space: null, busy: false },
      { key: "/home/me/projects/api", machine: "wsl", name: "api-remote", git: true, space: null, busy: false },
    ];

    assert.deepEqual(names(filterProjects(mixed, "~/projects", home)), ["api"]);
    assert.deepEqual(names(filterProjects(mixed, "me/projects", home)), ["api", "api-remote"]);
  });

  test("keeps the order of the rows and returns nothing when nothing matches", () => {
    assert.deepEqual(names(filterProjects(rows, "i", home)), ["Příliš", "api", "Site"]);
    assert.deepEqual(filterProjects(rows, "zzz", home), []);
  });

  test("does not change the rows it was given", () => {
    const frozen = Object.freeze(rows.map((r) => Object.freeze({ ...r })));

    assert.equal(filterProjects(frozen, "api", home).length, 1);
  });
});

describe("TERMINAL", () => {
  test("is the shell chip: its own key, the shell icon, tinted, with nothing to run", () => {
    assert.equal(TERMINAL.key, "terminal");
    assert.equal(TERMINAL.name, "Terminal");
    assert.equal(TERMINAL.icon, "icons/shell.svg");
    assert.equal(TERMINAL.tint, true);
    assert.deepEqual(TERMINAL.run, []);
  });
});

describe("agentArgv for the terminal", () => {
  test("starts the shell with no argv and no task when none is given", () => {
    for (const task of ["", "   ", undefined, null]) {
      const result = agentArgv(TERMINAL, task);

      assert.equal(result.argv, undefined);
      assert.ok(!Object.hasOwn(result, "task"));
      assert.ok(!result.unsupported);
    }
  });

  test("cannot take a task", () => {
    const result = agentArgv(TERMINAL, "  Fix it  ");

    assert.equal(result.unsupported, true);
    assert.ok(!Object.hasOwn(result, "task"));
  });
});

describe("launchPlan for the terminal", () => {
  const project = { key: "/repo/app", name: "app", git: true, space: "sp-1", at: 0 };

  test("opens a bare tab in the project's open space: no argv, task or tab name", () => {
    assert.deepEqual(launchPlan({ project, agent: TERMINAL, task: "", worktree: false }), [
      ["space.select", { id: "sp-1" }],
      ["tab.new", { space: "sp-1", folder: "/repo/app" }],
    ]);
  });

  test("opens a bare space on the project when it has no space", () => {
    const noSpace = { key: "/repo/app", name: "app", git: true, space: null, at: 0 };

    assert.deepEqual(launchPlan({ project: noSpace, agent: TERMINAL, task: "", worktree: false }), [
      ["space.new", { folder: "/repo/app" }],
    ]);
  });

  test("starts the shell in the new worktree with a bare space", () => {
    assert.deepEqual(
      launchPlan({ project, agent: TERMINAL, task: "", worktree: true, path: "/home/me/.herdr/worktrees/app/agent-x" }),
      [["space.new", { folder: "/home/me/.herdr/worktrees/app/agent-x" }]],
    );
  });
});

describe("pickAgent with the terminal", () => {
  const terminal = { key: "terminal" };
  const agents = [{ key: "claude" }, { key: "codex" }, terminal];

  test("picks the terminal as the preferred agent", () => {
    assert.equal(pickAgent(agents, "terminal", "claude"), "terminal");
  });

  test("picks the terminal as the last used agent", () => {
    assert.equal(pickAgent(agents, "aider", "terminal"), "terminal");
  });

  test("picks the terminal when it is the only choice", () => {
    assert.equal(pickAgent([terminal], "claude", "codex"), "terminal");
    assert.equal(pickAgent([terminal], null, null), "terminal");
  });
});
