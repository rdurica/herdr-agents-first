// New agent: pick a project (an open space, a remembered project or any folder),
// an installed agent and an optional task. It starts a tab in the space's
// folder by default, or a new space for a project without one; the worktree
// switch adds a linked checkout on its own branch. Everything the dialog draws
// on open comes from memory: no exec, git or scans hold up the first frame.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import {
  spaces, panes, exec, home,
  run, theme, props, closeOverlay, shared, setShared, pickFolder,
} from "herdr";
import {
  TERMINAL, agentProbe, installedAgents, branchName, uniqueBranch, worktreePath, projectsFromSpaces,
  wantsWorktree, pickAgent, agentArgv, launchPlan, parseRepo,
  tilde, readRecent, rememberProject, projectList, filterProjects,
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

async function git(cwd, args) {
  const r = await exec("git", args, { cwd });
  return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? r.stdout ?? "").trim() };
}

// The repo a folder belongs to: its main checkout and name, and whether the
// folder is itself a linked worktree. null outside git. One exec: two would
// cost about 300 ms each, and only Start with a worktree asks.
async function repoOf(folder) {
  try {
    const r = await git(folder, ["rev-parse", "--show-toplevel", "--path-format=absolute", "--git-common-dir"]);
    return r.ok ? parseRepo(r.out) : null;
  } catch {
    return null;
  }
}

// What a chip and shared.json need, and nothing else: no runtime objects and
// no installed flag, so a stored list loads as plain data.
const plainAgent = (a) => ({
  key: a.key,
  name: a.name,
  icon: typeof a.icon === "string" ? a.icon : null,
  tint: Boolean(a.tint),
  run: Array.isArray(a.run) ? [...a.run] : [],
});
const validAgent = (a) =>
  Boolean(a) &&
  typeof a.key === "string" &&
  typeof a.name === "string" &&
  Array.isArray(a.run) &&
  a.run.every((s) => typeof s === "string");

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
    this.picked = []; // folders chosen with Other folder, until Start remembers one
    this.projects = projectList(this.spaceRows, this.recent, this.openSpaces);
    this.selKey = this.projects[0]?.key ?? null;
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

    this.agents = this.readAgents();
    this.agentsJson = JSON.stringify(this.agents);
    this.checking = !this.agents.length;
    this.agentKey = pickAgent(this.choices(), this.preferred, this.readString("new-agent.agent"), this.requested);

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
    // seconds right after a dialog opens, so only a missing list is asked for.
    if (this.checking) {
      cx.timer.after(800, (cx) => {
        cx.spawn(async (cx) => {
          try {
            const [command, args] = agentProbe();
            const r = await exec(command, args);
            const installed = installedAgents(r.stdout).map(plainAgent);
            // An empty answer is a failed probe, not a computer without agents.
            if (!installed.length) throw new Error("no agents found");
            const json = JSON.stringify(installed);
            this.agents = installed;
            if (json !== this.agentsJson) {
              this.agentsJson = json;
              setShared("new-agent.agents", installed);
            }
          } catch {
            // Leave the remembered list and try again on a later open.
          }
          this.checking = false;
          if (!this.agentTouched || !this.choices().some((a) => a.key === this.agentKey)) {
            this.agentKey = pickAgent(this.choices(), this.preferred, this.readString("new-agent.agent"), this.requested);
          }
          cx.notify();
        });
      });
    }

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

  // The remembered chips. Missing or garbage is an empty list, which refreshes.
  readAgents() {
    try {
      const v = shared("new-agent.agents");
      return Array.isArray(v) ? v.filter(validAgent).map(plainAgent) : [];
    } catch {
      return [];
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

  project() {
    return this.projects.find((p) => p.key === this.selKey) ?? null;
  }

  // The rows the filter lets through, in list order.
  visible() {
    return filterProjects(this.projects, this.query, home());
  }

  // Selecting without drawing; a different project starts with the switch off.
  choose(project) {
    const key = project?.key ?? null;
    const changed = key !== this.selKey;
    this.selKey = key;
    if (changed) {
      this.choice = false;
      this.branchEdited = false;
      this.syncBranch();
    }
  }

  select(project, cx) {
    if (!project) return;
    this.choose(project);
    this.error = "";
    cx.notify();
  }

  // Typing in the filter: a selection that is filtered out moves to the first
  // visible row, or to nothing when no row matches.
  applyFilter(cx) {
    const rows = this.visible();
    if (!rows.some((p) => p.key === this.selKey)) this.choose(rows[0] ?? null);
    this.error = "";
    cx.notify();
  }

  // Other folder: the system picker. A picked folder joins the list (or is
  // found in it), is selected and clears the filter. Nothing is remembered
  // until Start.
  pickOther(cx) {
    if (this.picking || this.busy) return;
    this.picking = true;
    cx.spawn(async (cx) => {
      try {
        const folder = await pickFolder({ prompt: "Choose" });
        if (!folder) return;
        const key = folder.replace(/[\\/]+$/, "") || folder;
        let target = this.findFolder(key);
        if (!target) {
          const repo = await repoOf(key);
          this.picked = rememberProject(this.picked, { folder: key, name: baseName(key), git: Boolean(repo) });
          this.projects = projectList(this.spaceRows, [...this.picked, ...this.recent], this.openSpaces);
          target = this.findFolder(key);
        }
        this.query = "";
        if (this.filterInput.value()) this.filterInput.set_value("");
        this.choose(target);
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

  // The listed row that shows a folder: by its key, or as the folder an open
  // space was made in.
  findFolder(folder) {
    return (
      this.projects.find((p) => p.key === folder) ??
      this.projects.find((p) => p.space && this.openSpaces.find((s) => s.id === p.space)?.folder === folder) ??
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
    const i = rows.findIndex((p) => p.key === this.selKey);
    this.select(rows[((i < 0 ? 0 : i) + delta + rows.length) % rows.length], cx);
  }

  // The installed agents, then the terminal, which is always there.
  choices() {
    return [...this.agents, TERMINAL];
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

  nextField(cx) {
    const order = [["filter", this.filterInput], ["task", this.taskInput]];
    if (this.worktreeOn()) order.push(["branch", this.branchInput]);
    const i = order.findIndex(([name]) => this.focused[name]);
    order[(i + 1) % order.length][1].focus();
    cx.notify();
  }

  key(e, cx) {
    if (e.key === "escape") return this.close();
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
    // Arrows page the list unless the branch input is using them for the caret.
    if ((e.key === "down" || e.key === "up") && !this.focused.branch) {
      cx.stop_propagation();
      this.move(e.key === "down" ? 1 : -1, cx);
    }
  }

  start(cx) {
    if (this.busy) return;
    const project = this.project();
    const agent = this.choices().find((a) => a.key === this.agentKey);
    if (!project) {
      this.error = "Choose a project.";
      return cx.notify();
    }
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
          repo = await repoOf(project.key);
          if (!repo) {
            this.error = "Not a git repository";
            this.busy = false;
            return cx.notify();
          }
          // Read the branches again so an automatic name never quietly adopts
          // one that already exists.
          let existing = [];
          if (!edited) {
            const refs = await git(repo.main, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
            if (refs.ok) existing = refs.out ? refs.out.split("\n").map((s) => s.trim()).filter(Boolean) : [];
          }
          const branch = (edited ? typedBranch : "") || uniqueBranch(branchName(task, new Date()), existing);
          path = worktreePath(home(), repo.name, branch);
          const exists = await git(repo.main, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
          const add = exists.ok
            ? ["worktree", "add", path, branch]
            : ["worktree", "add", "-b", branch, path, "HEAD"];
          const r = await git(repo.main, add);
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
        await this.remember(project, repo);
        if (this.readString("new-agent.agent") !== agent.key) setShared("new-agent.agent", agent.key);
        closeOverlay(props().overlay);
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
      let folder = project.key;
      let inGit = false;
      if (project.git || repo) {
        const found = repo ?? (await repoOf(project.key));
        if (found) {
          folder = found.main;
          inGit = true;
        }
      }
      const stored = this.readRecentProjects();
      setShared("new-agent.recent", rememberProject(stored, { folder, name: baseName(folder), git: inGit }));
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
    const canStart = Boolean(project && this.agentKey && this.choices().some((a) => a.key === this.agentKey));

    const projectRow = (p) => {
      const on = p.key === this.selKey;
      return h_flex()
        .id(`na-project-${p.key}`)
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
        .child(div().max_w(230).min_w(0).truncate().text_size(11.5).text_color(t.dim).child(tilde(p.key, home())));
    };

    const otherRow = h_flex()
      .id("na-other-folder")
      .h(34)
      .px(10)
      .gap(8)
      .flex_none()
      .items_center()
      .rounded(7)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.pickOther(cx))
      .child(div().flex_1().text_color(t.muted).child("Other folder\u2026"))
      .child(div().text_size(11.5).text_color(t.dim).child("alt-o"));

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
      .child(input(this.filterInput))
      .child(
        v_flex()
          .id("na-projects")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .children(rows.map(projectRow))
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
          .child(otherRow),
      )
      .child(
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
      )
      .child(
        h_flex()
          .gap(6)
          .flex_none()
          .flex_wrap()
          .items_center()
          .when(this.checking && !this.agents.length, (el) => el.child(div().text_size(12).text_color(t.dim).child("Checking installed agents\u2026")))
          .when(!this.checking && !this.agents.length, (el) => el.child(div().text_size(12).text_color(t.dim).child("No agents found")))
          .children(this.choices().map(chip)),
      )
      .child(input(this.taskInput))
      .child(
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
      )
      .when(worktree, (el) => el.child(input(this.branchInput)))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(t.blocked).child(this.error)))
      .child(
        h_flex()
          .items_center()
          .text_size(11)
          .child(
            div()
              .flex_1()
              .text_color(t.dim)
              .child("alt-o folder \u00b7 alt-w worktree \u00b7 alt-a agent \u00b7 esc close"),
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
      );
  }
}
