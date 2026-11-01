// Pure helpers for the New agent dialog: names, paths, space rows and the
// commands to run. No Herdr API here, so the test can import it directly.

// Fold accents so "Oprav přihlášení" makes a branch git and a person can read.
const fold = (text) => String(text ?? "").normalize("NFD").replace(/\p{M}/gu, "");

export function slugify(text) {
  const slug = fold(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, 40).replace(/-+$/g, "");
}

const pad = (n) => String(n).padStart(2, "0");

// A branch from the task, or from when it started when the task has no words.
export function branchName(task, date) {
  const slug = slugify(task);
  if (slug) return `agent/${slug}`;
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  return `agent/${day}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function uniqueBranch(branch, existing = []) {
  if (!existing.includes(branch)) return branch;
  let n = 2;
  while (existing.includes(`${branch}-${n}`)) n++;
  return `${branch}-${n}`;
}

// Herdr's stock layout: ~/.herdr/worktrees/<repo>/<branch with / as ->.
export function worktreePath(home, name, branch) {
  const flat = branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${String(home).replace(/[\\/]+$/, "")}/.herdr/worktrees/${name}/${flat}`;
}

// One row per open local space: keyed by its live folder, git from the branch
// it shows, busy from its agents. A folder open twice keeps one row, the
// active space's, and the active row comes first.
export function projectsFromSpaces(spaces, active = null) {
  const rows = new Map();
  for (const s of spaces) {
    if (s.machine != null) continue;
    const key = s.cwd || s.folder;
    if (!key) continue;
    const row = {
      key,
      name: s.name,
      git: Boolean(s.branch),
      space: s.id,
      busy: s.status === "working" || s.status === "blocked",
    };
    const seen = rows.get(key);
    if (!seen || (s.id === active && seen.space !== active)) rows.set(key, row);
  }
  const list = [...rows.values()];
  const i = list.findIndex((r) => r.space === active);
  if (i > 0) list.unshift(...list.splice(i, 1));
  return list;
}

// Home as ~ (git says C:/Users/x where Windows says C:\Users\x).
export function tilde(path, userHome) {
  const [p, h] = [path, userHome].map((s) => String(s ?? "").replace(/\\/g, "/"));
  if (!h || !p.startsWith(`${h}/`)) return p === h ? "~" : path;
  return `~${p.slice(h.length)}`;
}

// The remembered projects as plain { folder, name, git } entries. A missing or
// garbage stored value is an empty list; an entry without a folder is dropped.
export function readRecent(value) {
  if (!Array.isArray(value)) return [];
  const list = [];
  for (const e of value) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    if (typeof e.folder !== "string" || !e.folder) continue;
    list.push({
      folder: e.folder,
      name: typeof e.name === "string" && e.name ? e.name : e.folder.split(/[\\/]/).filter(Boolean).pop() ?? e.folder,
      git: Boolean(e.git),
    });
  }
  return list;
}

// The project first, once per folder, the oldest dropped past the cap.
export function rememberProject(recent, entry, cap = 30) {
  const rest = recent.filter((e) => e.folder !== entry.folder);
  return [{ folder: entry.folder, name: entry.name, git: Boolean(entry.git) }, ...rest].slice(0, cap);
}

// The open spaces' rows, then remembered projects that no open space shows. A
// space shows a folder by its live folder (the row's key) or the folder it was
// made in; either one swallows the history entry. A folder is listed once.
export function projectList(spaceRows, recent, spaces = []) {
  const taken = new Set();
  for (const row of spaceRows) {
    taken.add(row.key);
    const folder = spaces.find((s) => s.id === row.space)?.folder;
    if (folder) taken.add(folder);
  }
  const rows = [...spaceRows];
  for (const e of recent) {
    if (taken.has(e.folder)) continue;
    taken.add(e.folder);
    rows.push({ key: e.folder, name: e.name, git: Boolean(e.git), space: null, busy: false });
  }
  return rows;
}

const simple = (text) => fold(text).toLowerCase();

// Rows whose name or folder (as written, or with home as ~) holds the query,
// ignoring case and accents. A blank query keeps every row.
export function filterProjects(rows, query, home) {
  const q = simple(String(query ?? "").trim());
  if (!q) return rows;
  return rows.filter((r) => [r.name, r.key, tilde(r.key, home)].some((s) => simple(s).includes(q)));
}

// A worktree is only possible in git, and it starts off: only an explicit
// choice turns it on, whatever the other agents are doing.
export function wantsWorktree({ git, choice }) {
  return Boolean(git && choice);
}

// The agent the opener asked for when it is installed (the Terminals + asks for
// a terminal), else the preferred one, else the last one used, else the first
// installed one. null when there is nothing to start.
export function pickAgent(agents, preferred, last, requested) {
  const keys = agents.map((a) => a.key);
  if (requested && keys.includes(requested)) return requested;
  if (preferred && keys.includes(preferred)) return preferred;
  if (last && keys.includes(last)) return last;
  return keys[0] ?? null;
}

// How a task reaches each agent. Herdr's stock delivery appends it as a
// positional argument, which most agents read as their first prompt; these
// need their own flag instead, and one cannot take a task at startup at all.
const taskFlags = {
  // opencode treats a positional argument as a folder, so its prompt goes
  // through --prompt.
  opencode: ["--prompt"],
  // Copilot and Antigravity take an interactive first prompt with -i.
  copilot: ["-i"],
  antigravity: ["-i"],
};

// What start with a task looks like: argv to run, the stock task when Herdr
// should append it itself, or unsupported when the agent takes no task.
export function agentArgv(agent, task) {
  const trimmed = String(task ?? "").trim();
  const run = agent.run;
  // A terminal has nothing to run, so Herdr opens its shell, and nothing to
  // hand a task to.
  if (agent.key === TERMINAL.key) return trimmed ? { unsupported: true } : {};
  if (!trimmed) return { argv: run };
  // Kimi has no flag for a first prompt, so it must start without a task.
  if (agent.key === "kimi") return { argv: run, unsupported: true };
  const flag = taskFlags[agent.key];
  if (flag) return { argv: [...run, ...flag, trimmed] };
  return { argv: run, task: trimmed };
}

// The main checkout from `git rev-parse --show-toplevel --path-format=absolute
// --git-common-dir`: the top line and the common dir, one per line.
export function parseRepo(text) {
  const lines = String(text ?? "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;
  const top = lines[0].trim();
  const common = lines[1].trim();
  const main = common.replace(/[\\/]\.git$/, "");
  return { top, main, name: main.split(/[\\/]/).pop() ?? main, linked: main !== top };
}

// The commands that start the agent, in order. Spaces stay unnamed so Herdr
// names them after their folder and nests worktrees under their repo.
export function launchPlan({ project, agent, task, worktree, path }) {
  // A terminal is a bare tab or space: no argv, task or name, so Herdr opens
  // its shell and names the tab itself.
  if (agent.key === TERMINAL.key) {
    if (worktree) return [["space.new", { folder: path }]];
    if (project.space) {
      return [
        ["space.select", { id: project.space }],
        ["tab.new", { space: project.space, folder: project.key }],
      ];
    }
    return [["space.new", { folder: project.key }]];
  }
  const delivery = agentArgv(agent, task);
  const withTask = delivery.task ? { task: delivery.task } : {};
  if (worktree) {
    return [["space.new", { folder: path, tab: agent.name, argv: delivery.argv, ...withTask }]];
  }
  if (project.space) {
    return [
      ["space.select", { id: project.space }],
      ["tab.new", { name: agent.name, space: project.space, folder: project.key, argv: delivery.argv, ...withTask }],
    ];
  }
  return [["space.new", { folder: project.key, tab: agent.name, argv: delivery.argv, ...withTask }]];
}

// Herdr's program table, checked with one `exec` when the dialog has no list.
// Keep in step with Herdr's table when it grows.
const agent = (key, name, command, tint) => ({ key, name, icon: `icons/${key}.svg`, tint, run: [command] });
export const AGENTS = [
  agent("claude", "Claude Code", "claude", false),
  agent("codex", "Codex", "codex", false),
  agent("opencode", "OpenCode", "opencode", true),
  agent("cursor", "Cursor", "cursor-agent", true),
  agent("copilot", "Copilot", "copilot", true),
  agent("gemini", "Gemini", "gemini", true),
  agent("antigravity", "Antigravity", "agy", false),
  agent("kimi", "Kimi", "kimi", false),
  agent("pi", "Pi", "pi", true),
  agent("amp", "Amp", "amp", false),
  agent("grok", "Grok", "grok", true),
  agent("kiro", "Kiro", "kiro-cli", false),
  agent("hermes", "Hermes", "hermes", true),
  agent("qoder", "Qoder", "qodercli", true),
  agent("crush", "Crush", "crush", false),
];

// The shell chip, always offered last: it runs nothing, so Herdr opens its
// shell. Not part of the probe table and never stored with the agents.
export const TERMINAL = { key: "terminal", name: "Terminal", icon: "icons/shell.svg", tint: true, run: [] };

// One `exec` that prints the path of every agent command on PATH.
export function agentProbe() {
  const names = AGENTS.map((a) => `'${a.run[0]}'`).join(" ");
  return ["sh", ["-c", `for c in ${names}; do command -v "$c"; done; true`]];
}

export function installedAgents(stdout) {
  const found = new Set(String(stdout).split("\n").map((l) => l.trim().split("/").pop()).filter(Boolean));
  return AGENTS.filter((a) => found.has(a.run[0]));
}
