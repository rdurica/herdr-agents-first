import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { loadMod } from "./load.mjs";

const {
  slugify,
  branchName,
  uniqueBranch,
  worktreePath,
  projectsFromSpaces,
  AGENTS,
  TERMINAL,
  agentProbe,
  installedAgents,
  wantsWorktree,
  pickAgent,
  agentArgv,
  launchPlan,
  parseRepo,
  readRecent,
  rememberProject,
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
      { key: "/repo/app", name: "app", git: true, space: "sp-1", busy: false },
      { key: "/work/plain", name: "plain", git: false, space: "sp-2", busy: true },
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

  test("skips remote spaces and spaces with neither a cwd nor a folder", () => {
    const rows = projectsFromSpaces(
      [
        space({ id: "sp-local", cwd: "/repo/local" }),
        space({ id: "sp-remote", machine: "vps", cwd: "/repo/remote" }),
        space({ id: "sp-empty", cwd: null, folder: "" }),
        space({ id: "sp-undefined", cwd: undefined, folder: undefined }),
      ],
      null,
    );

    assert.deepEqual(
      rows.map((r) => r.space),
      ["sp-local"],
    );
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
      { key: "/repo/app", name: "first", git: false, space: "sp-first", busy: false },
    ]);
    assert.deepEqual(projectsFromSpaces([first, second], "sp-second"), [
      { key: "/repo/app", name: "second", git: true, space: "sp-second", busy: true },
    ]);
    assert.deepEqual(projectsFromSpaces([second, first], "sp-first"), [
      { key: "/repo/app", name: "first", git: false, space: "sp-first", busy: false },
    ]);
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

  test("keeps space order when no space is active", () => {
    const rows = projectsFromSpaces(
      [
        space({ id: "sp-a", folder: "/repo/a", cwd: "/repo/a", active: false }),
        space({ id: "sp-b", folder: "/repo/b", cwd: "/repo/b", active: true }),
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

describe("agent discovery without knownAgents", () => {
  test("the probe names each agent's command once, safely quoted for sh", () => {
    const [cmd, args] = agentProbe();
    assert.equal(cmd, "sh");
    assert.equal(args[0], "-c");
    for (const a of AGENTS) assert.match(args[1], new RegExp(`'${a.run[0]}'`));
  });

  test("keeps the agents whose command the probe found, in table order", () => {
    const stdout = "/usr/bin/opencode\n/home/x/.local/bin/claude\n/opt/agy\n";
    assert.deepEqual(installedAgents(stdout).map((a) => a.key), ["claude", "opencode", "antigravity"]);
  });

  test("matches the command, not a path that merely contains it", () => {
    assert.deepEqual(installedAgents("/home/claude/bin/opencode\n").map((a) => a.key), ["opencode"]);
  });

  test("finds nothing in empty output", () => {
    assert.deepEqual(installedAgents(""), []);
  });
});

describe("readRecent", () => {
  const entry = (folder, name, git = false) => ({ folder, name, git });

  test("reads a stored list of projects as it is", () => {
    const stored = [entry("/work/api", "api", true), entry("/work/site", "site", false)];

    assert.deepEqual(readRecent(stored), stored);
  });

  test("reads a missing or garbage stored value as an empty list", () => {
    for (const value of [undefined, null, "not json", 42, true, {}, { folder: "/work/api" }]) {
      assert.deepEqual(readRecent(value), [], `value: ${JSON.stringify(value)}`);
    }
  });

  test("drops invalid entries and keeps the valid ones in order", () => {
    const good = entry("/work/api", "api", true);
    const also = entry("/work/site", "site", false);

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

describe("rememberProject", () => {
  const entry = (folder, name = folder.split("/").pop(), git = false) => ({ folder, name, git });

  test("puts the project first in an empty list", () => {
    assert.deepEqual(rememberProject([], entry("/work/api", "api", true)), [entry("/work/api", "api", true)]);
  });

  test("puts the newest project first", () => {
    const list = rememberProject([entry("/work/api")], entry("/work/site"));

    assert.deepEqual(
      list.map((p) => p.folder),
      ["/work/site", "/work/api"],
    );
  });

  test("dedupes by folder, moving the project to the front with its new values", () => {
    const before = [entry("/work/api", "api", false), entry("/work/site"), entry("/work/blog")];

    const list = rememberProject(before, entry("/work/site", "site", true));

    assert.deepEqual(list, [entry("/work/site", "site", true), entry("/work/api", "api", false), entry("/work/blog")]);
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
  const row = (over = {}) => ({ key: "/repo/app", name: "app", git: true, space: "sp-1", busy: false, ...over });
  const space = (over = {}) => ({ id: "sp-1", name: "app", folder: "/repo/app", cwd: "/repo/app", machine: null, ...over });
  const hist = (folder, name = folder.split("/").pop(), git = false) => ({ folder, name, git });

  test("lists the open spaces first, then remembered projects without a space", () => {
    const rows = projectList(
      [row({ key: "/a", name: "a", space: "sp-a" }), row({ key: "/b", name: "b", space: "sp-b" })],
      [hist("/work/api", "api", true), hist("/work/site", "site", false)],
    );

    assert.deepEqual(rows, [
      { key: "/a", name: "a", git: true, space: "sp-a", busy: false },
      { key: "/b", name: "b", git: true, space: "sp-b", busy: false },
      { key: "/work/api", name: "api", git: true, space: null, busy: false },
      { key: "/work/site", name: "site", git: false, space: null, busy: false },
    ]);
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

    assert.deepEqual(rows, [{ key: "/repo/app/packages/web", name: "web", git: true, space: "sp-1", busy: true }]);
  });

  test("merges a remembered project into the open space whose folder matches, not its live cwd", () => {
    const rows = projectList(
      [row({ key: "/repo/app/packages/web", name: "app", space: "sp-1" })],
      [hist("/repo/app", "app", true), hist("/work/api", "api", true)],
      [space({ id: "sp-1", folder: "/repo/app", cwd: "/repo/app/packages/web" })],
    );

    assert.deepEqual(
      rows.map((r) => [r.key, r.space]),
      [
        ["/repo/app/packages/web", "sp-1"],
        ["/work/api", null],
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

describe("filterProjects", () => {
  const rows = [
    { key: "/home/me/work/Příliš", name: "Příliš", git: true, space: "sp-1", busy: false },
    { key: "/home/me/projects/api", name: "api", git: true, space: null, busy: false },
    { key: "/srv/Site", name: "Site", git: false, space: null, busy: false },
  ];
  const home = "/home/me";
  const names = (list) => list.map((r) => r.name);

  test("returns every row for an empty or blank filter", () => {
    assert.deepEqual(filterProjects(rows, "", home), rows);
    assert.deepEqual(filterProjects(rows, "   ", home), rows);
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

  test("is not part of the probe table", () => {
    assert.ok(!AGENTS.some((a) => a.key === "terminal"));
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
