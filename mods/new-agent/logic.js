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

// A row on one machine: the same folder on two machines stays two rows.
export function projectId(row) {
  return JSON.stringify([row.machine ?? null, row.key]);
}

// How a machine is keyed in the stored agent lists: this computer is "".
export function machineKey(machine) {
  return machine ?? "";
}

// One row per open space, local or remote: keyed by its live folder, git from
// the branch it shows, busy from its agents. A folder open twice on one machine
// keeps one row, the active space's, and the active row comes first.
export function projectsFromSpaces(spaces, active = null) {
  const rows = new Map();
  for (const s of spaces) {
    const key = s.cwd || s.folder;
    if (!key) continue;
    const machine = s.machine ?? null;
    const row = {
      key,
      machine,
      name: s.name,
      git: Boolean(s.branch),
      space: s.id,
      busy: s.status === "working" || s.status === "blocked",
    };
    const id = projectId(row);
    const seen = rows.get(id);
    if (!seen || (s.id === active && seen.space !== active)) rows.set(id, row);
  }
  const list = [...rows.values()];
  const i = list.findIndex((r) => r.space === active);
  if (i > 0) list.unshift(...list.splice(i, 1));
  return list;
}

// The folder above a path, in the path's own separator style. null at a root
// or when there is no segment to drop, so a browser has nowhere to go up.
export function parentFolder(path) {
  if (typeof path !== "string" || !path) return null;
  const drive = /^[A-Za-z]:/.exec(path);
  if (drive) {
    const rest = path.slice(2);
    if (!rest) return null;
    const sep = rest.includes("\\") ? "\\" : "/";
    const trimmed = rest.replace(/[\\/]+$/, "");
    if (!trimmed) return null;
    const i = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
    if (i < 0) return null;
    const parent = trimmed.slice(0, i);
    return parent ? drive[0] + parent : drive[0] + sep;
  }
  // A leading // or \\ is a UNC server, not a root to collapse away. Windows
  // Resolve-Path prints the latter, so both styles are walked up.
  const backslash = path.startsWith("\\\\");
  const unc = backslash || path.startsWith("//");
  const trimmed = backslash ? path.replace(/[\\/]+$/, "") : path.replace(/\/+$/, "");
  if (!trimmed) return null;
  const i = backslash
    ? Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
    : trimmed.lastIndexOf("/");
  if (i < 0) return null;
  if (i === 0) return "/";
  if (unc && i === 1) return null;
  return trimmed.slice(0, i);
}

// A folder name joined to a path with one separator, keeping the separator
// style the path already uses.
export function joinFolder(path, name) {
  const base = String(path ?? "");
  const child = String(name ?? "");
  if (!base) return child;
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  if (base.endsWith("/") || base.endsWith("\\")) return base + child;
  return `${base}${sep}${child}`;
}

// What a folder listing prints: the canonical path on the first line, then one
// line per directory ending in "/". Names keep the shell's order.
export function folderListing(stdout) {
  const lines = String(stdout ?? "").split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  const names = [];
  for (const line of lines.slice(1)) {
    if (!line.endsWith("/")) continue;
    const name = line.slice(0, -1);
    if (!name || name === "." || name === "..") continue;
    names.push(name);
  }
  return { path: lines[0] ?? "", names };
}

// Home as ~ (git says C:/Users/x where Windows says C:\Users\x).
export function tilde(path, userHome) {
  const [p, h] = [path, userHome].map((s) => String(s ?? "").replace(/\\/g, "/"));
  if (!h || !p.startsWith(`${h}/`)) return p === h ? "~" : path;
  return `~${p.slice(h.length)}`;
}

// A stored machine is a non-empty string; anything else is this computer.
const storedMachine = (machine) => (typeof machine === "string" && machine ? machine : null);

// The remembered projects as plain { folder, machine, name, git } entries. A
// missing or garbage stored value is an empty list; an entry without a folder is
// dropped.
export function readRecent(value) {
  if (!Array.isArray(value)) return [];
  const list = [];
  for (const e of value) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    if (typeof e.folder !== "string" || !e.folder) continue;
    list.push({
      folder: e.folder,
      machine: storedMachine(e.machine),
      name: typeof e.name === "string" && e.name ? e.name : e.folder.split(/[\\/]/).filter(Boolean).pop() ?? e.folder,
      git: Boolean(e.git),
    });
  }
  return list;
}

// Favourites are stored like history: the same plain entries and normalizer.
export const readFavorites = readRecent;

// The project first, once per folder and machine, the oldest dropped past the
// cap.
export function rememberProject(recent, entry, cap = 30) {
  const machine = storedMachine(entry.machine);
  const rest = recent.filter((e) => !(e.folder === entry.folder && storedMachine(e.machine) === machine));
  return [{ folder: entry.folder, machine, name: entry.name, git: Boolean(entry.git) }, ...rest].slice(0, cap);
}

// A star click: a folder already on that machine leaves the list, keeping the
// order of the rest; a new one joins at the front. The list it was given stays.
export function toggleFavorite(list, entry, cap = 50) {
  const machine = storedMachine(entry.machine);
  const stored = list.filter((e) => e.folder === entry.folder && storedMachine(e.machine) === machine);
  if (stored.length) return list.filter((e) => !(e.folder === entry.folder && storedMachine(e.machine) === machine));
  return rememberProject(list, entry, cap);
}

// The nth starred row, 1-based, or null out of range. The dialog numbers the
// favourites it shows without counting the plain rows.
export function pickFavorite(rows, n) {
  if (!Number.isInteger(n) || n < 1) return null;
  return rows.filter((r) => r.starred === true)[n - 1] ?? null;
}

// The open spaces' rows, then remembered projects that no open space shows. A
// space shows a folder by its live folder (the row's key) or the folder it was
// made in, but only on its own machine. A folder is listed once per machine.
// Favourites lead in their stored order and carry `starred`/`favorite`; without
// them the list is exactly the space rows plus history.
export function projectList(spaceRows, recent, spaces = [], favorites = []) {
  const taken = new Set();
  for (const row of spaceRows) {
    const machine = row.machine ?? null;
    taken.add(projectId(row));
    const folder = spaces.find((s) => s.id === row.space)?.folder;
    if (folder) taken.add(projectId({ key: folder, machine }));
  }
  const base = [...spaceRows];
  for (const e of recent) {
    const machine = storedMachine(e.machine);
    const id = projectId({ key: e.folder, machine });
    if (taken.has(id)) continue;
    taken.add(id);
    base.push({ key: e.folder, machine, name: e.name, git: Boolean(e.git), space: null, busy: false });
  }
  if (!favorites.length) return base;

  const used = new Set();
  const rows = [];
  for (const fav of favorites) {
    const machine = storedMachine(fav.machine);
    const id = projectId({ key: fav.folder, machine });
    const row = base.find(
      (r) =>
        (r.machine ?? null) === machine &&
        !used.has(projectId(r)) &&
        (r.key === fav.folder || spaces.find((s) => s.id === r.space)?.folder === fav.folder),
    );
    if (row) {
      used.add(projectId(row));
      rows.push({ ...row, starred: true, favorite: { folder: fav.folder, machine } });
      continue;
    }
    // An earlier favourite already claimed this folder and machine.
    if (taken.has(id)) continue;
    taken.add(id);
    rows.push({
      key: fav.folder,
      machine,
      name: fav.name,
      git: Boolean(fav.git),
      space: null,
      busy: false,
      starred: true,
      favorite: { folder: fav.folder, machine },
    });
  }
  for (const row of base) if (!used.has(projectId(row))) rows.push(row);
  return rows;
}

const simple = (text) => fold(text).toLowerCase();

// Rows whose name, folder (as written, or with home as ~) or machine holds the
// query, ignoring case and accents. The ~ form only makes sense on this
// computer. A blank query keeps every row.
export function filterProjects(rows, query, home) {
  const q = simple(String(query ?? "").trim());
  if (!q) return rows;
  return rows.filter((r) => {
    const parts = [r.name, r.key];
    if (r.machine != null) parts.push(r.machine);
    else parts.push(tilde(r.key, home));
    return parts.some((s) => simple(s).includes(q));
  });
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

// What a chip and shared.json need, and nothing else: no runtime objects and no
// installed flag, so a stored list loads as plain data.
export function plainAgent(a) {
  return {
    key: a.key,
    name: a.name,
    icon: typeof a.icon === "string" ? a.icon : null,
    tint: Boolean(a.tint),
    run: Array.isArray(a.run) ? [...a.run] : [],
  };
}

export const validAgent = (a) =>
  Boolean(a) &&
  typeof a.key === "string" &&
  typeof a.name === "string" &&
  Array.isArray(a.run) &&
  a.run.every((s) => typeof s === "string");

// The stored agent lists, keyed by machine ("" is this computer). The old
// stored shape was one array: it becomes this computer's list.
export function agentLists(value) {
  if (Array.isArray(value)) return { "": value.filter(validAgent).map(plainAgent) };
  if (!value || typeof value !== "object") return {};
  const lists = {};
  for (const [machine, list] of Object.entries(value)) {
    if (!Array.isArray(list)) continue;
    lists[machine] = list.filter(validAgent).map(plainAgent);
  }
  return lists;
}

export function agentsOn(lists, machine) {
  return lists[machineKey(machine)] ?? [];
}

// A new map, so a running dialog can swap one machine's chips without touching
// the lists it still reads.
export function setAgentsOn(lists, machine, agents) {
  return { ...lists, [machineKey(machine)]: (Array.isArray(agents) ? agents : []).map(plainAgent) };
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
// names them after their folder and nests worktrees under their repo. A remote
// project's new spaces are made on its machine; a tab in an existing space
// already lives there.
export function launchPlan({ project, agent, task, worktree, path }) {
  const on = typeof project.machine === "string" && project.machine ? { machine: project.machine } : {};
  // A terminal is a bare tab or space: no argv, task or name, so Herdr opens
  // its shell and names the tab itself.
  if (agent.key === TERMINAL.key) {
    if (worktree) return [["space.new", { folder: path, ...on }]];
    if (project.space) {
      return [
        ["space.select", { id: project.space }],
        ["tab.new", { space: project.space, folder: project.key }],
      ];
    }
    return [["space.new", { folder: project.key, ...on }]];
  }
  const delivery = agentArgv(agent, task);
  const withTask = delivery.task ? { task: delivery.task } : {};
  if (worktree) {
    return [["space.new", { folder: path, ...on, tab: agent.name, argv: delivery.argv, ...withTask }]];
  }
  if (project.space) {
    return [
      ["space.select", { id: project.space }],
      ["tab.new", { name: agent.name, space: project.space, folder: project.key, argv: delivery.argv, ...withTask }],
    ];
  }
  return [["space.new", { folder: project.key, ...on, tab: agent.name, argv: delivery.argv, ...withTask }]];
}

// The shell chip, always offered last: it runs nothing, so Herdr opens its
// shell. Not part of the probed agents and never stored with them.
export const TERMINAL = { key: "terminal", name: "Terminal", icon: "icons/shell.svg", tint: true, run: [] };
