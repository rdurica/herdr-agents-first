// New agent: pick a project (an open space, a remembered project, a picked
// folder or a folder browsed on a remote machine), an installed agent and an
// optional task. It starts a tab in the space's folder by default, or a new
// space for a project without one; the worktree switch adds a linked checkout
// on its own branch. Everything the dialog draws on open comes from memory: no
// exec, git or scans hold up the first frame.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import {
  spaces, panes, exec, home, machines, knownAgents,
  run, theme, props, closeOverlay, shared, setShared, pickFolder,
} from "herdr";
import {
  TERMINAL, projectId, parentFolder, joinFolder, folderListing, machineKey, branchName, uniqueBranch,
  worktreePath, projectsFromSpaces,
  wantsWorktree, pickAgent, agentArgv, launchPlan, parseRepo, validAgent, agentLists, agentsOn, setAgentsOn,
  tilde, readRecent, readFavorites, rememberProject, toggleFavorite, pickFavorite, projectList, filterProjects,
} from "./logic.js";


// The live folder of a space's first tab that has one, else where it was made.
function place(s, cwdByTab) {
  for (const tab of s.tabs ?? []) {
    const cwd = cwdByTab.get(tab.id);
    if (cwd) return cwd;
  }
  return s.folder;
}

// One panes() call for every space on open: tab id -> its first live folder.
function tabFolders() {
  const map = new Map();
  for (const pane of panes()) {
    if (pane.cwd && !map.has(pane.tab)) map.set(pane.tab, pane.cwd);
  }
  return map;
}

// The last segment of a folder, which names a project that has no space.
const baseName = (folder) => folder.split(/[\\/]/).filter(Boolean).pop() ?? folder;

async function git(cwd, args, on) {
  const r = await exec("git", args, { cwd, on });
  return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? r.stdout ?? "").trim() };
}

// The repo a folder belongs to: its main checkout and name, and whether the
// folder is itself a linked worktree. null outside git. One exec: two would
// cost about 300 ms each, and only Start with a worktree asks.
async function repoOf(folder, on) {
  try {
    const r = await git(folder, ["rev-parse", "--show-toplevel", "--path-format=absolute", "--git-common-dir"], on);
    return r.ok ? parseRepo(r.out) : null;
  } catch {
    return null;
  }
}

// The folders in a folder on a machine. `ls -L` follows a symlink so a link to
// a directory keeps the trailing slash the parser expects; an ls error (a broken
// symlink, say) only loses that entry, never the whole folder. Windows falls
// back to PowerShell, which lists directories the same way.
async function readFolder(folder, machine) {
  try {
    const r = await exec(
      "sh",
      ["-c", 'cd "$1" || exit 1; pwd -P; ls -1ApL 2>/dev/null; true', "sh", folder],
      { on: machine },
    );
    const listing = folderListing(r.stdout ?? "");
    if (r.code === 0 && listing.path) return listing;
  } catch {
    // No sh over there; try Windows.
  }
  try {
    const r = await exec(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "$p = $args[0]; if (-not (Test-Path -LiteralPath $p -PathType Container)) { exit 1 }; (Resolve-Path -LiteralPath $p).Path; Get-ChildItem -LiteralPath $p -Directory -Force | ForEach-Object { $_.Name + '/' }",
        folder,
      ],
      { on: machine },
    );
    const listing = folderListing(r.stdout ?? "");
    if (r.code === 0 && listing.path) return listing;
  } catch {
    // Neither shell could look; the caller reports no such folder.
  }
  throw new Error(`Could not read ${folder} on ${machine}.`);
}

export default class NewAgent extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    const list = spaces();
    const cwdByTab = tabFolders();
    this.openSpaces = list;
    this.spaceRows = projectsFromSpaces(
      list.map((s) => ({ ...s, cwd: place(s, cwdByTab) })),
      list.find((s) => s.active)?.id ?? null,
    );
    this.recent = this.readRecentProjects();
    this.favorites = this.readFavoriteProjects();
    this.picked = []; // folders picked or browsed, until Start remembers one
    this.projects = projectList(this.spaceRows, this.recent, this.openSpaces, this.favorites);
    // Favourites lead the list, but the active space is still the default pick.
    const active = list.find((s) => s.active)?.id;
    const initialProject = this.projects.find((p) => p.space === active) ?? this.projects[0] ?? null;
    this.selId = initialProject ? projectId(initialProject) : null;
    this.query = "";
    this.picking = false;
    this.choice = false; // a worktree starts off; only a click or alt-w turns it on
    this.task = "";
    this.branchEdited = false;
    this.autoBranch = "";
    this.preferred = this.readString("new-agent.preferred");
    // The opener's choice (the Terminals +) is for this launch only: it is not
    // written to the preferred agent until Start.
    this.requested = props()?.agent;
    this.agentTouched = false; // the person picked an agent
    this.busy = false; // starting, not the space's agent status
    this.error = "";
    this.focused = { filter: false, task: true, branch: false };

    // Agent chips are remembered per machine; the old shape was one array for
    // this computer.
    this.agentLists = this.readAgentLists();
    this.homes = {}; // machine -> its home folder, asked once
    this.probing = new Set(); // machines a probe is running for
    this.checking = new Set(); // machines the dialog is waiting on
    this.agentKey = pickAgent(this.choices(), this.preferred, this.readString("new-agent.agent"), this.requested);

    // The machine the dialog opened on, refreshed once after the first paint.
    const initialMachine = this.currentMachine();
    if (!Object.hasOwn(this.agentLists, machineKey(initialMachine))) this.checking.add(machineKey(initialMachine));

    // A folder browser for a remote machine, and whether its folder is being
    // added: while either owns the list, Start cannot launch the old project.
    this.browser = null; // { machine, at, path, parent, entries, index, hidden, loading, error }
    this.browserBusy = false;
    this.browserNav = 0; // a newer navigation invalidates an older read or home lookup

    this.filterInput = InputState.new({ placeholder: "Filter projects" });
    this.filterInput.on("change", (_e, cx) => {
      this.query = this.filterInput.value();
      this.applyFilter(cx);
    });
    this.filterInput.on("submit", (_e, cx) => this.start(cx));
    this.filterInput.on("focus", () => { this.focused.filter = true; });
    this.filterInput.on("blur", () => { this.focused.filter = false; });

    this.taskInput = InputState.new({ placeholder: "What should it do? (optional)" });
    this.taskInput.on("change", (_e, cx) => {
      this.task = this.taskInput.value();
      if (!this.branchEdited) this.syncBranch();
      // Typing must not redraw the dialog unless something on it changes.
      if (this.error) {
        this.error = "";
        cx.notify();
      }
    });
    this.taskInput.on("submit", (_e, cx) => this.start(cx));
    this.taskInput.on("focus", () => { this.focused.task = true; });
    this.taskInput.on("blur", () => { this.focused.task = false; });

    this.branchInput = InputState.new({ placeholder: "branch name" });
    this.branchInput.on("change", (_e, cx) => {
      // A value the dialog wrote itself is not the person's edit.
      this.branchEdited = this.branchInput.value() !== this.autoBranch;
      if (this.error) {
        this.error = "";
        cx.notify();
      }
    });
    this.branchInput.on("submit", (_e, cx) => this.start(cx));
    this.branchInput.on("focus", () => { this.focused.branch = true; });
    this.branchInput.on("blur", () => { this.focused.branch = false; });

    // The first frames paint from memory. Every redraw and setShared costs Herdr
    // seconds right after a dialog opens, so the first probe waits; the machine
    // the dialog opened on is refreshed once even when its list is remembered.
    cx.timer.after(800, (cx) => {
      cx.spawn(async (cx) => {
        await this.probeAgents(cx, initialMachine, { force: true });
      });
    });

    this.syncBranch();
    this.taskInput.focus();
  }

  close() {
    closeOverlay(props().overlay);
  }

  // shared() values are plain JSON, not strings.
  readString(key) {
    try {
      const v = shared(key);
      return typeof v === "string" && v ? v : null;
    } catch {
      return null;
    }
  }

  // The remembered chips, keyed by machine. Missing or garbage is no lists.
  readAgentLists() {
    try {
      return agentLists(shared("new-agent.agents"));
    } catch {
      return {};
    }
  }

  // The remembered projects. Missing or garbage is an empty list.
  readRecentProjects() {
    try {
      return readRecent(shared("new-agent.recent"));
    } catch {
      return [];
    }
  }

  // The starred folders, stored like history. Missing or garbage is empty.
  readFavoriteProjects() {
    try {
      return readFavorites(shared("new-agent.favorites"));
    } catch {
      return [];
    }
  }

  // The list again after a pick, a browse or a star: picked folders lead, then
  // history, with favourites still first. Unstarring a favourite that no other
  // row lists removes its row; the first visible row takes over so the dialog
  // is never left without a selection.
  rebuild(cx) {
    this.projects = projectList(this.spaceRows, [...this.picked, ...this.recent], this.openSpaces, this.favorites);
    if (!this.project()) this.choose(this.visible()[0] ?? null, cx);
  }

  project() {
    return this.projects.find((p) => projectId(p) === this.selId) ?? null;
  }

  // The rows the filter lets through, in list order.
  visible() {
    return filterProjects(this.projects, this.query, home());
  }

  // Selecting without drawing; a different project starts with the switch off,
  // and a different machine swaps the agent chips.
  choose(project, cx) {
    const before = this.currentMachine();
    const id = project ? projectId(project) : null;
    const changed = id !== this.selId;
    this.selId = id;
    if (changed) {
      this.choice = false;
      this.branchEdited = false;
      this.syncBranch();
      if (machineKey(this.currentMachine()) !== machineKey(before)) this.syncAgents(cx);
    }
  }

  select(project, cx) {
    if (!project) return;
    this.choose(project, cx);
    this.error = "";
    cx.notify();
  }

  // Typing in the filter: a selection that is filtered out moves to the first
  // visible row, or to nothing when no row matches.
  applyFilter(cx) {
    const rows = this.visible();
    if (!rows.some((p) => projectId(p) === this.selId)) this.choose(rows[0] ?? null, cx);
    this.error = "";
    cx.notify();
  }

  // Other folder: the system picker. A picked folder joins the list (or is
  // found in it), is selected and clears the filter. Nothing is remembered
  // until Start.
  pickOther(cx) {
    // The folder browser owns the list; a picker on top of it would leave it open.
    if (this.picking || this.busy || this.browser || this.browserBusy) return;
    this.picking = true;
    cx.spawn(async (cx) => {
      try {
        const folder = await pickFolder({ prompt: "Choose" });
        if (!folder) return;
        const key = folder.replace(/[\\/]+$/, "") || folder;
        let target = this.findFolder(key, null);
        if (!target) {
          const repo = await repoOf(key, null);
          this.picked = rememberProject(this.picked, { folder: key, machine: null, name: baseName(key), git: Boolean(repo) });
          this.rebuild(cx);
          target = this.findFolder(key, null);
        }
        this.query = "";
        if (this.filterInput.value()) this.filterInput.set_value("");
        this.choose(target, cx);
        this.error = "";
        this.taskInput.focus();
      } catch (error) {
        this.error = String(error);
      } finally {
        this.picking = false;
        cx.notify();
      }
    });
  }

  // Open the folder browser for a remote machine: no system picker exists over
  // there, so the dialog lists folders through that machine's shell. It starts
  // at the selected project when that is on the same machine, else at home.
  openBrowser(machine, cx) {
    if (this.picking || this.busy || this.browser || this.browserBusy) return;
    this.browser = {
      machine,
      at: null,
      path: null,
      parent: null,
      entries: [],
      index: 0,
      hidden: false,
      loading: true,
      error: "",
    };
    this.startBrowser(cx);
  }

  // Start the browser at the selected project's folder when it is on this
  // machine, else at that machine's home. Also the retry path when the home
  // lookup itself failed: there is no folder to read yet.
  startBrowser(cx) {
    const browser = this.browser;
    if (!browser) return;
    const project = this.project();
    const projectKey = project?.machine === browser.machine ? project.key : null;
    const nav = ++this.browserNav;
    browser.loading = true;
    browser.error = "";
    browser.entries = [];
    browser.index = 0;
    browser.at = null;
    browser.path = null;
    browser.parent = null;
    this.handle.focus();
    // The inputs are hidden while the browser owns the list; a blur that lands
    // late must not leave the browser's keys switched off.
    this.focused.filter = false;
    this.focused.task = false;
    this.focused.branch = false;
    cx.notify();
    cx.spawn(async (cx) => {
      if (this.browser !== browser || this.browserNav !== nav) return;
      // A project on this machine is already the answer; its home is only
      // needed for a machine we have to start from the top.
      if (projectKey) {
        await this.loadFolder(browser.machine, projectKey, cx);
        return;
      }
      let home;
      try {
        home = await this.userHomeFor(browser.machine);
      } catch (error) {
        if (this.browser !== browser || this.browserNav !== nav) return;
        browser.loading = false;
        browser.error = String(error);
        cx.notify();
        return;
      }
      if (this.browser !== browser || this.browserNav !== nav) return;
      await this.loadFolder(browser.machine, home, cx);
    });
  }

  // Read one folder into the browser. The path is canonical, so the parent and
  // every child folder can be joined and listed in turn. `at` holds the folder
  // being read, so a read overtaken by a newer navigation is dropped.
  async loadFolder(machine, folder, cx) {
    if (!this.browser || this.browser.machine !== machine) return;
    const browser = this.browser;
    const nav = ++this.browserNav;
    browser.loading = true;
    browser.error = "";
    browser.entries = [];
    browser.index = 0;
    browser.at = folder;
    browser.path = null;
    browser.parent = null;
    cx.notify();
    try {
      const listing = await readFolder(folder, machine);
      if (this.browser !== browser || this.browserNav !== nav || browser.at !== folder) return;
      browser.path = listing.path;
      browser.parent = parentFolder(listing.path);
      browser.entries = listing.names;
      browser.loading = false;
      browser.index = 0;
      this.handle.focus();
      cx.notify();
    } catch (error) {
      if (this.browser !== browser || this.browserNav !== nav || browser.at !== folder) return;
      browser.loading = false;
      browser.error = String(error);
      cx.notify();
    }
  }

  closeBrowser(cx) {
    if (this.browserBusy) return;
    this.browser = null;
    this.error = "";
    this.taskInput.focus();
    cx.notify();
  }

  // Go to a folder in the open browser. A newer navigation claimed before this
  // one starts reading wins, even when both actions arrive in one frame.
  browseTo(browser, folder, cx) {
    if (this.browserBusy || this.browser !== browser) return;
    const nav = ++this.browserNav;
    cx.spawn(async (cx) => {
      if (this.browser !== browser || this.browserNav !== nav) return;
      await this.loadFolder(browser.machine, folder, cx);
    });
  }

  browseParent(cx) {
    const browser = this.browser;
    if (!browser) return;
    const target = parentFolder(browser.path ?? browser.at);
    if (target == null) return;
    this.browseTo(browser, target, cx);
  }

  browseHome(cx) {
    const browser = this.browser;
    if (!browser || this.browserBusy) return;
    const nav = ++this.browserNav;
    cx.spawn(async (cx) => {
      try {
        const home = await this.userHomeFor(browser.machine);
        if (this.browser !== browser || this.browserNav !== nav) return;
        await this.loadFolder(browser.machine, home, cx);
      } catch (error) {
        if (this.browser !== browser || this.browserNav !== nav) return;
        browser.loading = false;
        browser.error = String(error);
        cx.notify();
      }
    });
  }

  retryBrowser(cx) {
    const browser = this.browser;
    if (!browser) return;
    // The first home lookup can fail before there is a folder to retry; after
    // that, prefer the canonical path the list is showing.
    const folder = browser.path ?? browser.at;
    if (!folder) return this.startBrowser(cx);
    this.browseTo(browser, folder, cx);
  }

  toggleBrowserHidden(cx) {
    if (!this.browser) return;
    this.browser.hidden = !this.browser.hidden;
    this.browser.index = 0;
    cx.notify();
  }

  // The rows the browser shows: ".." (null) when there is a parent, then the
  // folders the hidden switch lets through.
  browserRows() {
    const browser = this.browser;
    if (!browser) return [];
    const rows = browser.parent != null ? [null] : [];
    for (const name of browser.entries) {
      if (browser.hidden || !name.startsWith(".")) rows.push(name);
    }
    return rows;
  }

  browserIndex() {
    const index = this.browser?.index ?? 0;
    return Math.min(Math.max(index, 0), Math.max(0, this.browserRows().length - 1));
  }

  moveBrowser(delta, cx) {
    if (!this.browser) return;
    const rows = this.browserRows();
    if (!rows.length) return;
    this.browser.index = (this.browser.index + delta + rows.length) % rows.length;
    cx.notify();
  }

  enterBrowser(cx) {
    const browser = this.browser;
    if (!browser) return;
    const rows = this.browserRows();
    if (!rows.length) return;
    const name = rows[this.browserIndex()];
    if (name === null) return this.browseParent(cx);
    this.browseTo(browser, joinFolder(browser.path, name), cx);
  }

  // Use the folder the browser is in: it joins the list like a picked folder
  // and is selected. Nothing is written to the history until Start.
  chooseBrowserFolder(cx) {
    const browser = this.browser;
    if (!browser || browser.loading || browser.error || !browser.path || this.browserBusy) return;
    const machine = browser.machine;
    const folder = browser.path;
    // Choosing freezes this folder; a pending navigation must not move it.
    ++this.browserNav;
    this.browserBusy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const repo = await repoOf(folder, machine);
        this.picked = rememberProject(this.picked, { folder, machine, name: baseName(folder), git: Boolean(repo) });
        this.rebuild(cx);
        this.query = "";
        if (this.filterInput.value()) this.filterInput.set_value("");
        this.browser = null;
        this.choose(this.findFolder(folder, machine), cx);
        this.error = "";
        this.taskInput.focus();
      } catch (error) {
        // The browser hides this.error; show the failure where it is visible.
        if (this.browser === browser) browser.error = String(error);
        else this.error = String(error);
      } finally {
        this.browserBusy = false;
        cx.notify();
      }
    });
  }

  // The listed row that shows a folder on a machine: by its key, or as the
  // folder an open space on that machine was made in.
  findFolder(folder, machine) {
    const on = machine ?? null;
    return (
      this.projects.find((p) => p.key === folder && (p.machine ?? null) === on) ??
      this.projects.find(
        (p) =>
          p.space &&
          (p.machine ?? null) === on &&
          this.openSpaces.find((s) => s.id === p.space)?.folder === folder,
      ) ??
      null
    );
  }

  // The branch follows the task until the person types their own.
  syncBranch() {
    // Off, nothing shows it, and writing it on every key would redraw the dialog.
    if (this.branchEdited || !this.worktreeOn()) return;
    const project = this.project();
    const value = project?.git ? branchName(this.task, new Date()) : "";
    this.autoBranch = value;
    if (this.branchInput.value() !== value) this.branchInput.set_value(value);
  }

  move(delta, cx) {
    const rows = this.visible();
    if (!rows.length) return;
    const i = rows.findIndex((p) => projectId(p) === this.selId);
    this.select(rows[((i < 0 ? 0 : i) + delta + rows.length) % rows.length], cx);
  }

  // The machine the selected project lives on, null for this computer.
  currentMachine() {
    return this.project()?.machine ?? null;
  }

  // The chips remembered for that machine, without the terminal.
  currentAgents() {
    return agentsOn(this.agentLists, this.currentMachine());
  }

  // The installed agents on the selected machine, then the terminal, which is
  // always there.
  choices() {
    return [...this.currentAgents(), TERMINAL];
  }

  // A different machine's chips: swap to its cache at once, or check it now. The
  // chosen agent stays until the probe knows whether it exists there; the
  // terminal always does.
  syncAgents(cx) {
    const machine = this.currentMachine();
    const key = machineKey(machine);
    if (!Object.hasOwn(this.agentLists, key)) {
      // Unknown chips: keep the chosen key instead of falling back to the
      // terminal, which Start would then launch by accident.
      this.checking.add(key);
      if (cx && !this.probing.has(key)) {
        cx.spawn(async (cx) => {
          await this.probeAgents(cx, machine, {});
        });
      }
      return;
    }
    this.checking.delete(key);
    if (!this.choices().some((a) => a.key === this.agentKey)) {
      this.agentKey = pickAgent(this.choices(), this.preferred, this.readString("new-agent.agent"), this.requested);
    }
  }

  // One probe per machine at a time. `force` refreshes a remembered list once a
  // dialog; a failure keeps it and waits for a later open.
  async probeAgents(cx, machine, { force = false } = {}) {
    const key = machineKey(machine);
    if (this.probing.has(key)) return;
    if (!force && Object.hasOwn(this.agentLists, key)) return;
    this.probing.add(key);
    this.checking.add(key);
    try {
      const found = await knownAgents({ on: machine ?? null });
      const agents = found.filter((a) => a && a.installed && validAgent(a));
      const stored = JSON.stringify(this.agentLists);
      this.agentLists = setAgentsOn(this.agentLists, machine, agents);
      // A refresh that found the same chips must not re-render every mod.
      if (JSON.stringify(this.agentLists) !== stored) setShared("new-agent.agents", this.agentLists);
    } catch {
      // Leave the remembered list and try again on a later open.
    } finally {
      this.probing.delete(key);
      this.checking.delete(key);
    }
    if (machineKey(this.currentMachine()) === key) {
      if (!this.agentTouched || !this.choices().some((a) => a.key === this.agentKey)) {
        this.agentKey = pickAgent(this.choices(), this.preferred, this.readString("new-agent.agent"), this.requested);
      }
    }
    cx.notify();
  }

  // This computer's home immediately; another machine's through its shell,
  // falling back to Windows PowerShell. Cached per machine.
  async userHomeFor(machine) {
    if (!machine) return home();
    if (Object.hasOwn(this.homes, machine)) return this.homes[machine];
    let found = "";
    try {
      const r = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: machine });
      if (r.code === 0) found = (r.stdout ?? "").trim();
    } catch {
      // No sh over there; try Windows.
    }
    if (!found) {
      try {
        const r = await exec("powershell.exe", ["-NoProfile", "-Command", "[Console]::Write($HOME)"], { on: machine });
        if (r.code === 0) found = (r.stdout ?? "").trim();
      } catch {
        // Fall through to the clear error.
      }
    }
    if (!found) throw new Error(`Could not find the home folder on ${machine}.`);
    const slashed = found.replace(/\\/g, "/");
    const normalized = slashed === "/" || /^[A-Za-z]:\/$/.test(slashed) ? slashed : slashed.replace(/\/+$/, "");
    this.homes[machine] = normalized;
    return normalized;
  }

  cycleAgent(cx) {
    const choices = this.choices();
    const i = choices.findIndex((a) => a.key === this.agentKey);
    this.agentKey = choices[(i + 1) % choices.length].key;
    this.agentTouched = true;
    cx.notify();
  }

  worktreeOn(project = this.project()) {
    return wantsWorktree({ git: Boolean(project?.git), choice: this.choice });
  }

  toggleWorktree(cx) {
    const project = this.project();
    if (!project?.git) return;
    this.choice = !this.worktreeOn(project);
    this.syncBranch();
    cx.notify();
  }

  // A star click: remove the exact stored favourite, or add this row's folder.
  // Adding a git worktree later resolves its main checkout, so Settle removing
  // that worktree does not rot the favourite.
  toggleStar(project, cx) {
    if (!project) return;
    const machine = project.machine ?? null;
    const remove = Boolean(project.starred && project.favorite);
    const entry = remove
      ? { folder: project.favorite.folder, machine: project.favorite.machine ?? null }
      : { folder: project.key, machine, name: project.name || baseName(project.key), git: Boolean(project.git) };
    this.favorites = toggleFavorite(this.favorites, entry);
    setShared("new-agent.favorites", this.favorites);
    this.rebuild(cx);
    this.error = "";
    cx.notify();
    if (remove || !project.git) return;
    cx.spawn(async (cx) => {
      try {
        const repo = await repoOf(project.key, machine);
        if (!repo || repo.main === project.key) return;
        // The dialog's own list, not shared: it is the only writer, so a click
        // that landed while git ran is here already and must not be undone.
        const next = this.favorites;
        const i = next.findIndex((e) => e.folder === project.key && (e.machine ?? null) === machine);
        // The person may have unstarred it while git answered.
        if (i < 0) return;
        const replaced = [...next];
        if (replaced.some((e) => e.folder === repo.main && (e.machine ?? null) === machine)) {
          replaced.splice(i, 1);
        } else {
          replaced[i] = { folder: repo.main, machine, name: baseName(repo.main), git: true };
        }
        this.favorites = replaced;
        setShared("new-agent.favorites", this.favorites);
        this.rebuild(cx);
        try {
          cx.notify();
        } catch {
          // The dialog may already be closed.
        }
      } catch {
        // Leave the favourite as it is.
      }
    });
  }

  nextField(cx) {
    const order = [["filter", this.filterInput], ["task", this.taskInput]];
    if (this.worktreeOn()) order.push(["branch", this.branchInput]);
    const i = order.findIndex(([name]) => this.focused[name]);
    order[(i + 1) % order.length][1].focus();
    cx.notify();
  }

  key(e, cx) {
    // The folder browser owns the keyboard unless a text input is using it.
    if (this.browser) {
      if (e.key === "escape") {
        cx.stop_propagation();
        return this.closeBrowser(cx);
      }
      // The browser hides every text input, so Tab has nowhere to go even if
      // one kept its focus flag.
      if (e.key === "tab") {
        cx.stop_propagation();
        return;
      }
      if (!this.focused.filter && !this.focused.task && !this.focused.branch) {
        if (e.key === "enter" && e.modifiers.alt) {
          cx.stop_propagation();
          return this.chooseBrowserFolder(cx);
        }
        if (e.key === "h" && e.modifiers.alt) {
          cx.stop_propagation();
          return this.browseHome(cx);
        }
        if (e.key === "." && e.modifiers.alt) {
          cx.stop_propagation();
          return this.toggleBrowserHidden(cx);
        }
        if (e.key === "backspace") {
          cx.stop_propagation();
          return this.browseParent(cx);
        }
        if (e.key === "down" || e.key === "up") {
          cx.stop_propagation();
          return this.moveBrowser(e.key === "down" ? 1 : -1, cx);
        }
        if (e.key === "enter") {
          cx.stop_propagation();
          return this.enterBrowser(cx);
        }
      }
    }
    if (e.key === "escape") return this.close();
    if (!this.browser && e.key === "f" && e.modifiers.alt) {
      cx.stop_propagation();
      return this.toggleStar(this.project(), cx);
    }
    if (!this.browser && e.modifiers.alt && /^[1-9]$/.test(e.key)) {
      cx.stop_propagation();
      const row = pickFavorite(this.visible(), Number(e.key));
      if (row) {
        this.select(row, cx);
        this.taskInput.focus();
      }
      return;
    }
    if (e.key === "tab") {
      cx.stop_propagation();
      return this.nextField(cx);
    }
    if (e.key === "a" && e.modifiers.alt) {
      cx.stop_propagation();
      return this.cycleAgent(cx);
    }
    if (e.key === "o" && e.modifiers.alt) {
      cx.stop_propagation();
      return this.pickOther(cx);
    }
    if (e.key === "w" && e.modifiers.alt) {
      cx.stop_propagation();
      return this.toggleWorktree(cx);
    }
    // An input that has the keyboard turns Enter into its own submit. With no
    // input focused (after a click on a row, say), Enter still starts.
    if (e.key === "enter" && !this.focused.filter && !this.focused.task && !this.focused.branch) {
      cx.stop_propagation();
      return this.start(cx);
    }
    // Arrows page the list unless an input is using them for the caret.
    if ((e.key === "down" || e.key === "up") && !this.focused.branch) {
      cx.stop_propagation();
      this.move(e.key === "down" ? 1 : -1, cx);
    }
  }

  start(cx) {
    if (this.busy) return;
    // The folder browser, or a folder still being added, owns the next Enter:
    // never start the project that was selected before it.
    if (this.browser) {
      this.error = "Choose or cancel the folder first.";
      return cx.notify();
    }
    if (this.browserBusy || this.picking) {
      this.error = "Still adding the folder.";
      return cx.notify();
    }
    const project = this.project();
    if (!project) {
      this.error = "Choose a project.";
      return cx.notify();
    }
    // A remote project can only launch on a machine that is actually there.
    const machine = project.machine ?? null;
    if (machine) {
      const listed = machines().find((m) => m.name === machine);
      if (!listed || listed.layout === "unavailable") {
        this.error = `${machine} is not connected.`;
        return cx.notify();
      }
      if (listed.layout === "loading") {
        this.error = `${machine} is still connecting.`;
        return cx.notify();
      }
    }
    // Until the probe answers, the chips show only the terminal: starting now
    // would launch it by accident.
    const key = machineKey(machine);
    if (this.checking.has(key) && !Object.hasOwn(this.agentLists, key)) {
      this.error = machine ? `Still checking installed agents on ${machine}.` : "Still checking installed agents.";
      return cx.notify();
    }
    const agent = this.choices().find((a) => a.key === this.agentKey);
    if (!agent) {
      this.error = "Choose an installed agent.";
      return cx.notify();
    }
    // Some agents cannot take a task at startup; refuse before any git work so
    // nothing is created for a launch that would ignore or misread it.
    if (agentArgv(agent, this.taskInput.value()).unsupported) {
      this.error =
        agent.key === TERMINAL.key
          ? `${agent.name} can't take a task. Clear it or pick an agent.`
          : `${agent.name} can't start with a task. Clear it or pick another agent.`;
      return cx.notify();
    }
    const worktree = this.worktreeOn(project);
    // What was chosen when Start was pressed, not what the dialog says after the
    // git calls return.
    const task = this.taskInput.value();
    const edited = this.branchEdited;
    const typedBranch = this.branchInput.value().trim();
    this.error = "";
    this.busy = true;
    cx.notify();

    cx.spawn(async (cx) => {
      try {
        let path;
        let repo = null;
        if (worktree) {
          repo = await repoOf(project.key, machine);
          if (!repo) {
            this.error = "Not a git repository";
            this.busy = false;
            return cx.notify();
          }
          // Read the branches again so an automatic name never quietly adopts
          // one that already exists.
          let existing = [];
          if (!edited) {
            const refs = await git(repo.main, ["for-each-ref", "--format=%(refname:short)", "refs/heads"], machine);
            if (refs.ok) existing = refs.out ? refs.out.split("\n").map((s) => s.trim()).filter(Boolean) : [];
          }
          const branch = (edited ? typedBranch : "") || uniqueBranch(branchName(task, new Date()), existing);
          const repoHome = machine ? await this.userHomeFor(machine) : home();
          path = worktreePath(repoHome, repo.name, branch);
          const exists = await git(repo.main, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], machine);
          const add = exists.ok
            ? ["worktree", "add", path, branch]
            : ["worktree", "add", "-b", branch, path, "HEAD"];
          const r = await git(repo.main, add, machine);
          if (!r.ok) {
            this.error = r.err || "git worktree add failed.";
            this.busy = false;
            return cx.notify();
          }
        }
        // The space may have been closed while git ran; then open a new one.
        const target = { ...project };
        if (!spaces().some((s) => s.id === project.space)) target.space = null;
        const plan = launchPlan({ project: target, agent, task, worktree, path });
        for (const [name, args] of plan) run(name, args);
        if (this.readString("new-agent.agent") !== agent.key) setShared("new-agent.agent", agent.key);
        // Close first: remembering the history is a convenience and must not
        // hold the dialog open while a remote machine's git answers.
        closeOverlay(props().overlay);
        void this.remember(project, repo);
      } catch (error) {
        this.error = String(error);
        this.busy = false;
        cx.notify();
      }
    });
  }

  // Start remembers the project: the main checkout when it is in git, else the
  // folder itself. A failure here must not undo a launch that has happened.
  async remember(project, repo) {
    try {
      const machine = typeof project.machine === "string" && project.machine ? project.machine : null;
      let folder = project.key;
      let inGit = false;
      if (project.git || repo) {
        const found = repo ?? (await repoOf(project.key, machine));
        if (found) {
          folder = found.main;
          inGit = true;
        }
      }
      const stored = this.readRecentProjects();
      // The sidebar grows the same key to 50; Start must not trim it back.
      setShared("new-agent.recent", rememberProject(stored, { folder, name: baseName(folder), git: inGit, machine }, 50));
    } catch {
      // The history is a convenience.
    }
  }

  render() {
    const t = theme();
    const project = this.project();
    const rows = this.visible();
    const worktree = this.worktreeOn(project);
    const gitRepo = Boolean(project?.git);
    const machine = project?.machine ?? null;
    const machineCached = Object.hasOwn(this.agentLists, machineKey(machine));
    const waiting = this.checking.has(machineKey(machine)) && !machineCached;
    const browser = this.browser;
    const browserPath = browser ? browser.path ?? browser.at : null;
    const browserRows = browser ? this.browserRows() : [];
    const browserSelected = Math.min(
      Math.max(browser?.index ?? 0, 0),
      Math.max(0, browserRows.length - 1),
    );
    const canStart = Boolean(
      project &&
      this.agentKey &&
      this.choices().some((a) => a.key === this.agentKey) &&
      !waiting &&
      !browser &&
      !this.browserBusy &&
      !this.picking,
    );
    const remoteMachines = machines().filter((m) => m.name).map((m) => m.name);

    const projectRow = (p) => {
      const on = projectId(p) === this.selId;
      const starred = Boolean(p.starred);
      // A remote row's folder says nothing without its machine.
      const where = p.machine ? `${p.machine} \u00b7 ${p.key}` : tilde(p.key, home());
      return h_flex()
        .id(`na-project-${projectId(p)}`)
        .h(34)
        .px(10)
        .gap(8)
        .flex_none()
        .items_center()
        .rounded(7)
        .cursor_pointer()
        .when(on, (el) => el.bg(t.selected))
        .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => {
          this.select(p, cx);
          this.taskInput.focus();
        })
        .child(div().flex_1().min_w(0).truncate().text_color(on ? t.foreground : t.muted).child(p.name))
        .child(div().max_w(230).min_w(0).truncate().text_size(11.5).text_color(t.dim).child(where))
        .child(
          div()
            .id(`na-star-${projectId(p)}`)
            .size(22)
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .rounded(5)
            .cursor_pointer()
            .hover((s) => s.bg(t.hover))
            .tooltip(starred ? "Remove from favorites" : "Add to favorites")
            .on_click((_e, cx) => {
              cx.stop_propagation();
              this.toggleStar(p, cx);
            })
            .child(
              svg(starred ? "mods/new-agent/star-filled.svg" : "mods/new-agent/star.svg")
                .size(13)
                .text_color(starred ? t.accent : t.dim),
            ),
        );
    };

    // Favourites lead, so a small heading keeps the two groups readable. Only
    // shown when a starred row is actually in the filtered list.
    const sectionLabel = (text) =>
      div().px(10).pt(4).pb(2).text_size(10).text_color(t.dim).child(text);
    const rowChildren = [];
    if (rows.some((p) => p.starred)) {
      let favoritesDone = false;
      let projectsDone = false;
      for (const p of rows) {
        if (p.starred && !favoritesDone) {
          rowChildren.push(sectionLabel("Favorites"));
          favoritesDone = true;
        }
        if (!p.starred && favoritesDone && !projectsDone) {
          rowChildren.push(sectionLabel("Projects"));
          projectsDone = true;
        }
        rowChildren.push(projectRow(p));
      }
    } else {
      rowChildren.push(...rows.map(projectRow));
    }

    const folderRow = (id, label, hint, onClick) =>
      h_flex()
        .id(id)
        .h(34)
        .px(10)
        .gap(8)
        .flex_none()
        .items_center()
        .rounded(7)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => onClick(cx))
        .child(div().flex_1().text_color(t.muted).child(label))
        .when(Boolean(hint), (el) => el.child(div().text_size(11.5).text_color(t.dim).child(hint)));

    const otherRow = folderRow("na-other-folder", "Other folder\u2026", "alt-o", (cx) => this.pickOther(cx));
    const remoteRows = remoteMachines.map((name) =>
      folderRow(`na-folder-${name}`, `Folder on ${name}\u2026`, null, (cx) => this.openBrowser(name, cx)),
    );

    const chip = (a) => {
      const on = a.key === this.agentKey;
      const pic = a.icon
        ? a.tint
          ? svg(a.icon).size(14).flex_none().text_color(on ? t.foreground : t.muted)
          : image(a.icon).w(14).h(14).flex_none()
        : null;
      return h_flex()
        .id(`na-agent-${a.key}`)
        .h(28)
        .px(8)
        .gap(6)
        .flex_none()
        .items_center()
        .rounded(6)
        .cursor_pointer()
        .when(on, (el) => el.bg(t.selected))
        .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => {
          this.agentKey = a.key;
          this.agentTouched = true;
          this.taskInput.focus();
          cx.notify();
        })
        .when(Boolean(pic), (el) => el.child(pic))
        .child(div().text_size(12).text_color(on ? t.foreground : t.muted).child(a.name))
        .when(a.key === this.preferred, (el) =>
          el.child(div().text_size(10).text_color(t.dim).child(" \u00b7 default")),
        );
    };

    // Checkbox and Switch are unstyled in gpui-base, so the box is drawn here.
    const box = div()
      .size(14)
      .flex_none()
      .rounded(4)
      .border(1)
      .border_color(gitRepo && worktree ? t.accent : t.input)
      .when(gitRepo && worktree, (el) => el.bg(t.accent))
      .flex()
      .items_center()
      .justify_center()
      .when(gitRepo && worktree, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(10).text_color(t.background)));

    const input = (state) => Input.new(state)
      .h(34)
      .px(10)
      .items_center()
      .rounded(6)
      .border(1)
      .border_color(t.input)
      .bg(t.background)
      .text_color(t.foreground);

    // No system picker exists on a remote machine, so its folder is browsed
    // here: the path bar replaces the filter, and the list area shows folders.
    const pathBar = browser
      ? h_flex()
          .h(34)
          .px(10)
          .gap(8)
          .flex_none()
          .items_center()
          .rounded(6)
          .border(1)
          .border_color(t.input)
          .bg(t.background)
          .child(svg("mods/workspace-chrome/server.svg").size(13).text_color(t.dim))
          .child(
            div()
              .flex_1()
              .min_w(0)
              .truncate()
              .text_color(t.foreground)
              .child(browserPath ? `${browser.machine} \u00b7 ${browserPath}` : `${browser.machine}\u2026`),
          )
          .child(
            div()
              .id("na-browse-home")
              .size(24)
              .flex_none()
              .flex()
              .items_center()
              .justify_center()
              .rounded(5)
              .cursor_pointer()
              .hover((s) => s.bg(t.hover))
              .tooltip("Home")
              .on_click((_e, cx) => this.browseHome(cx))
              .child(div().text_size(13).text_color(t.muted).child("~")),
          )
          .when(browser.parent != null, (el) =>
            el.child(
              div()
                .id("na-browse-up")
                .size(24)
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .rounded(5)
                .cursor_pointer()
                .hover((s) => s.bg(t.hover))
                .tooltip("Up")
                .on_click((_e, cx) => this.browseParent(cx))
                .child(svg("mods/workspace-chrome/chevron-left.svg").size(14).text_color(t.muted)),
            ),
          )
      : null;

    const browserRow = (i, name) => {
      const up = name === null;
      const selected = i === browserSelected;
      return h_flex()
        .id(`na-browse-row-${i}`)
        .h(30)
        .px(8)
        .gap(8)
        .flex_none()
        .items_center()
        .rounded(6)
        .cursor_pointer()
        .when(selected, (el) => el.bg(t.selected))
        .when(!selected, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => {
          if (this.browser !== browser) return;
          if (up) return this.browseParent(cx);
          // Use the row that was drawn, not its index in a possibly newer list.
          this.browseTo(browser, joinFolder(browserPath, name), cx);
        })
        .child(
          svg(up ? "mods/workspace-chrome/chevron-left.svg" : "mods/workspace-chrome/folder.svg")
            .size(13)
            .text_color(t.dim),
        )
        .child(
          div()
            .flex_1()
            .min_w(0)
            .truncate()
            .text_color(selected ? t.foreground : t.muted)
            .child(up ? ".." : name),
        );
    };

    const canChoose = Boolean(browser && !browser.loading && !browser.error && !this.browserBusy && browser.path);
    const browserView = browser
      ? v_flex()
          .flex_1()
          .min_h(0)
          .child(
            v_flex()
              .id("na-browser")
              .flex_1()
              .min_h(0)
              .overflow_y_scrollbar()
              .children(browserRows.map((name, i) => browserRow(i, name)))
              .when(browser.loading, (el) =>
                el.child(
                  div().px(10).py(6).text_size(12).text_color(t.dim).child(`Reading ${browser.machine}\u2026`),
                ),
              )
              .when(Boolean(browser.error), (el) =>
                el
                  .child(div().px(10).py(6).text_size(12).text_color(t.blocked).child(browser.error))
                  .child(
                    h_flex()
                      .id("na-browse-retry")
                      .h(30)
                      .px(8)
                      .gap(8)
                      .flex_none()
                      .items_center()
                      .rounded(6)
                      .cursor_pointer()
                      .hover((s) => s.bg(t.hover))
                      .on_click((_e, cx) => this.retryBrowser(cx))
                      .child(div().text_size(12).text_color(t.muted).child("Try again")),
                  ),
              )
              .when(!browser.loading && !browser.error && browserRows.every((name) => name === null), (el) =>
                el.child(div().px(10).py(6).text_size(12).text_color(t.dim).child("No folders here.")),
              ),
          )
          .child(
            h_flex()
              .flex_none()
              .items_center()
              .gap(8)
              .px(10)
              .py(6)
              .child(
                div()
                  .flex_1()
                  .min_w(0)
                  .truncate()
                  .text_size(11)
                  .text_color(t.dim)
                  .child("Enter open \u00b7 backspace up \u00b7 alt-enter choose \u00b7 esc cancel"),
              )
              .child(
                div()
                  .id("na-browse-hidden")
                  .flex_none()
                  .cursor_pointer()
                  .text_size(11)
                  .text_color(t.dim)
                  .hover((s) => s.text_color(t.foreground))
                  .on_click((_e, cx) => this.toggleBrowserHidden(cx))
                  .child(browser.hidden ? "Hide hidden" : "Show hidden"),
              )
              .child(
                h_flex()
                  .id("na-browse-choose")
                  .h(30)
                  .px(14)
                  .flex_none()
                  .items_center()
                  .rounded(7)
                  .bg(t.solid)
                  .text_color(t.solid_foreground)
                  .text_size(12)
                  .when(canChoose, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)))
                  .when(!canChoose, (el) => el.opacity(0.5))
                  .on_click((_e, cx) => {
                    if (!canChoose) return;
                    this.chooseBrowserFolder(cx);
                  })
                  .child(this.browserBusy ? "Adding\u2026" : "Use this folder"),
              ),
          )
      : null;

    return v_flex()
      .id("new-agent")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .p(18)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(
        h_flex()
          .items_center()
          .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("New agent"))
          .child(div().text_size(11).text_color(t.dim).child("Esc")),
      )
      .child(browser ? pathBar : input(this.filterInput))
      .child(
        browser
          ? browserView
          : v_flex()
              .id("na-projects")
              .flex_1()
              .min_h(0)
              .overflow_y_scrollbar()
              .children(rowChildren)
              .when(rows.length === 0, (el) =>
                el.child(
                  div()
                    .px(10)
                    .py(6)
                    .text_size(12)
                    .text_color(t.dim)
                    .child(this.projects.length ? "No matching projects." : "No projects yet. Use Other folder\u2026 to add one."),
                ),
              )
              .child(otherRow)
              .children(remoteRows),
      )
      .when(!browser, (el) =>
        el.child(
          h_flex()
            .h(20)
            .items_center()
            .child(div().text_size(11).text_color(t.dim).child("Agent"))
            .child(div().flex_1())
            .when(Boolean(this.agentKey), (el) =>
              el.child(
                h_flex()
                  .id("na-default-agent")
                  .cursor_pointer()
                  .text_size(11)
                  .text_color(t.dim)
                  .hover((s) => s.text_color(t.foreground))
                  .on_click((_e, cx) => {
                    if (this.preferred === this.agentKey) {
                      this.preferred = null;
                      setShared("new-agent.preferred", null);
                    } else {
                      this.preferred = this.agentKey;
                      setShared("new-agent.preferred", this.agentKey);
                    }
                    this.taskInput.focus();
                    cx.notify();
                  })
                  .child(
                    div().child(this.preferred === this.agentKey ? "Default \u00b7 clear" : "Set as default"),
                  ),
              ),
            ),
        ),
      )
      .when(!browser, (el) =>
        el.child(
          h_flex()
            .gap(6)
            .flex_none()
            .flex_wrap()
            .items_center()
            .when(waiting, (el) => el.child(div().text_size(12).text_color(t.dim).child("Checking installed agents\u2026")))
            .when(!waiting && this.currentAgents().length === 0, (el) =>
              el.child(
                div()
                  .text_size(12)
                  .text_color(t.dim)
                  .child(machine ? `No agents found on ${machine}` : "No agents found"),
              ),
            )
            .children(this.choices().map(chip)),
        ),
      )
      .when(!browser, (el) => el.child(input(this.taskInput)))
      .when(!browser, (el) =>
        el.child(
          h_flex()
            .id("na-worktree")
            .h(30)
            .gap(8)
            .flex_none()
            .items_center()
            .when(gitRepo, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground)))
            .on_click((_e, cx) => {
              if (!gitRepo) return this.taskInput.focus();
              const before = this.worktreeOn();
              this.toggleWorktree(cx);
              (this.worktreeOn() && !before ? this.branchInput : this.taskInput).focus();
            })
            .child(box)
            .child(div().text_color(gitRepo ? t.foreground : t.dim).child("New worktree"))
            .when(!gitRepo, (el) => el.child(div().text_size(11).text_color(t.dim).child("Not a git repository")))
            .when(
              gitRepo && !worktree && project?.busy,
              (el) => el.child(div().text_size(11).text_color(t.dim).child("An agent is working in this space")),
            ),
        ),
      )
      .when(!browser && worktree, (el) => el.child(input(this.branchInput)))
      .when(!browser && Boolean(this.error), (el) => el.child(div().text_size(12).text_color(t.blocked).child(this.error)))
      .when(!browser, (el) =>
        el.child(
          h_flex()
            .items_center()
            .text_size(11)
            .child(
              div()
                .flex_1()
                .text_color(t.dim)
                .child("alt-f star \u00b7 alt-1-9 favorite \u00b7 alt-o folder \u00b7 alt-w worktree \u00b7 alt-a agent \u00b7 esc close"),
            )
            .child(
              h_flex()
                .id("na-start")
                .h(30)
                .px(14)
                .items_center()
                .rounded(7)
                .bg(t.solid)
                .text_color(t.solid_foreground)
                .text_size(12)
                .when(canStart, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)))
                .when(!canStart, (el) => el.opacity(0.5))
                .on_click((_e, cx) => {
                  if (!canStart || this.busy) return;
                  this.start(cx);
                })
                .child(this.busy ? "Starting\u2026" : "Start"),
            ),
        ),
      );
  }
}
