// New agent: pick an open space, an installed agent and an optional task. It
// starts a tab in the space's folder by default; the worktree switch adds a
// linked checkout on its own branch. Everything the dialog draws on open comes
// from memory: no exec, git or scans hold up the first frame.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import {
  spaces, panes, exec, home,
  run, theme, props, closeOverlay, shared, setShared,
} from "herdr";
import {
  agentProbe, installedAgents, branchName, uniqueBranch, worktreePath, projectsFromSpaces,
  wantsWorktree, pickAgent, agentArgv, launchPlan, parseRepo,
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

// Home as ~ (git says C:/Users/x where Windows says C:\Users\x).
const tilde = (path, userHome) => {
  const [p, h] = [path, userHome].map((s) => String(s ?? "").replace(/\\/g, "/"));
  if (!h || !p.startsWith(`${h}/`)) return p === h ? "~" : path;
  return `~${p.slice(h.length)}`;
};

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
    this.projects = projectsFromSpaces(
      list.map((s) => ({ ...s, cwd: place(s, cwdByTab) })),
      list.find((s) => s.active)?.id ?? null,
    );
    this.selKey = this.projects[0]?.key ?? null;
    this.choice = false; // a worktree starts off; only a click or alt-w turns it on
    this.task = "";
    this.branchEdited = false;
    this.autoBranch = "";
    this.preferred = this.readString("new-agent.preferred");
    this.agentTouched = false; // the person picked an agent
    this.busy = false; // starting, not the space's agent status
    this.error = "";
    this.focused = { task: true, branch: false };

    this.agents = this.readAgents();
    this.agentsJson = JSON.stringify(this.agents);
    this.checking = !this.agents.length;
    this.agentKey = pickAgent(this.agents, this.preferred, this.readString("new-agent.agent"));

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
          if (!this.agentTouched || !this.agents.some((a) => a.key === this.agentKey)) {
            this.agentKey = pickAgent(this.agents, this.preferred, this.readString("new-agent.agent"));
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

  project() {
    return this.projects.find((p) => p.key === this.selKey) ?? null;
  }

  select(project, cx) {
    if (!project) return;
    const changed = project.key !== this.selKey;
    this.selKey = project.key;
    if (changed) {
      this.choice = false;
      this.branchEdited = false;
      this.syncBranch();
    }
    this.error = "";
    cx.notify();
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
    const rows = this.projects;
    if (!rows.length) return;
    const i = rows.findIndex((p) => p.key === this.selKey);
    this.select(rows[((i < 0 ? 0 : i) + delta + rows.length) % rows.length], cx);
  }

  cycleAgent(cx) {
    if (!this.agents.length) return;
    const i = this.agents.findIndex((a) => a.key === this.agentKey);
    this.agentKey = this.agents[(i + 1) % this.agents.length].key;
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
    const order = [["task", this.taskInput]];
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
    if (e.key === "w" && e.modifiers.alt) {
      cx.stop_propagation();
      return this.toggleWorktree(cx);
    }
    // An input that has the keyboard turns Enter into its own submit. With no
    // input focused (after a click on a row, say), Enter still starts.
    if (e.key === "enter" && !this.focused.task && !this.focused.branch) {
      cx.stop_propagation();
      return this.start(cx);
    }
    // Arrows page the list unless the task or branch input is using them for
    // the caret.
    if ((e.key === "down" || e.key === "up") && !this.focused.branch) {
      cx.stop_propagation();
      this.move(e.key === "down" ? 1 : -1, cx);
    }
  }

  start(cx) {
    if (this.busy) return;
    const project = this.project();
    const agent = this.agents.find((a) => a.key === this.agentKey);
    if (!project) {
      this.error = "Choose a space.";
      return cx.notify();
    }
    if (!agent) {
      this.error = "Choose an installed agent.";
      return cx.notify();
    }
    // Some agents cannot take a task at startup; refuse before any git work so
    // nothing is created for a launch that would ignore or misread it.
    if (agentArgv(agent, this.taskInput.value()).unsupported) {
      this.error = `${agent.name} can't start with a task. Clear it or pick another agent.`;
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
        if (worktree) {
          const repo = await repoOf(project.key);
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
        if (this.readString("new-agent.agent") !== agent.key) setShared("new-agent.agent", agent.key);
        closeOverlay(props().overlay);
      } catch (error) {
        this.error = String(error);
        this.busy = false;
        cx.notify();
      }
    });
  }

  render() {
    const t = theme();
    const project = this.project();
    const rows = this.projects;
    const worktree = this.worktreeOn(project);
    const gitRepo = Boolean(project?.git);
    const canStart = Boolean(project && this.agentKey && this.agents.some((a) => a.key === this.agentKey));

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
      .child(
        v_flex()
          .id("na-projects")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .children(rows.map(projectRow))
          .when(rows.length === 0, (el) => el.child(div().px(10).py(6).text_size(12).text_color(t.dim).child("No open spaces."))),
      )
      .child(
        h_flex()
          .h(20)
          .items_center()
          .child(div().text_size(11).text_color(t.dim).child("Agent"))
          .child(div().flex_1())
          .when(Boolean(this.agents.length && this.agentKey), (el) =>
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
          .children(this.agents.map(chip)),
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
              .child("alt-w worktree \u00b7 alt-a agent \u00b7 esc close"),
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
