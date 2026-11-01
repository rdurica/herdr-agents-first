<h1 align="center">Herdr · Agents first</h1>

<p align="center">
  A <a href="https://herdr.dev">Herdr</a> sidebar for working with coding agents:<br/>
  your agents on top, your terminals under them, and no Spaces to manage.
</p>

<p align="center">
  <img alt="Herdr" src="https://img.shields.io/badge/Herdr-0.9.x-5b8def" />
  <img alt="Mod" src="https://img.shields.io/badge/format-herdr--mod-2ea44f" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue" />
</p>

<p align="center">
  <img src="assets/overview.png" alt="Herdr with Agents first: agents grouped by state on top, terminals below, a dev server in the main pane" width="860" />
</p>

## Why

Herdr's stock window is organized around **spaces**. When most of your work is
agents, you mostly want to know three things: which agent needs you, which
are still working, and where your plain terminals are. Spaces get in the way,
and finished agents pile up as tabs nobody closes.

Agents first keeps only what you work with in the sidebar, starts new work
from one dialog, and cleans up when the work is done.

## What you get

| | |
|---|---|
| **Agents** | The stock Agents panel: *Needs you*, *Working*, *Done*, *Idle*, pins, sub-agents, sort by priority or project. |
| **Terminals** | Every tab without an agent, with its project and folder. Click to focus it; hover to close it. |
| **New agent** (`ctrl-shift-a`) | Pick a project, an agent (or a plain terminal) and a task; optionally a new git worktree. |
| **Settle closes** | The archive button on a finished agent closes its tab. Settling a merged worktree removes it. |
| **No Spaces** | Spaces still exist inside Herdr, but you never manage them: New agent makes them, Settle closes them. |

## A quick tour

1. **`ctrl-shift-a`** (or `+` in the Agents header). Type what the agent should
   do, press Enter. The project defaults to the one you are in.
2. **Watch the Agents list.** Rows move between *Needs you*, *Working* and
   *Done*; the status bar counts them. Click a row to jump to it.
3. **Need a shell?** `+` in the Terminals header opens the same dialog with
   *Terminal* selected.
4. **Done?** Hover the agent and click archive (or *Settle all* on the group).
   The tab closes; a clean, merged worktree is removed with it.

<p align="center">
  <img src="assets/new-agent.png" alt="The New agent dialog: a project list with a filter, agent chips, a task input and a New worktree switch" width="480" />
</p>

## New agent

The dialog picks a project, not a space; Herdr's space for it is made for
you, so a project does not need a space first.

- **Project:** the open local spaces first (the active one on top), named
  after the space and keyed by its live folder, then the projects you have
  started an agent in before that have no open space, most recent first. A
  folder is listed once. Nothing is scanned or asked of git while the dialog
  opens, so it paints at once. Remote spaces are not listed. A project without
  a space gets a new space when you start.
- **History:** Start remembers the project (30 at most) in `new-agent.recent`
  in `~/.config/herdr-app/shared.json`: the repo's main checkout when the folder
  is in git, else the folder itself. Remove the key to forget them.
- **Filter:** the *Filter projects* input above the list narrows it as you
  type, by name or folder path (also as `~/...`), ignoring case and accents.
  The selection moves to the first match; with no match Start is dimmed.
  Typing in the task box stays the fast path: `ctrl-shift-a`, type, Enter.
  `tab` goes filter, task, branch (when the worktree is on) and round.
- **Other folder…:** the last row, or `alt-o`, opens the system folder picker.
  The folder joins the list, is selected and is remembered when you start. No
  folder is scanned for, and there is no root to configure.
- **Agent:** installed agents as chips. The list is stored the first time, so
  the dialog does not ask again; to pick up a newly installed agent, remove
  `new-agent.agents` from `~/.config/herdr-app/shared.json`.
  *Set as default* above the list remembers one; otherwise the last agent used
  is selected. Picking another chip for one launch does not change the default.
  A **Terminal** chip always comes last, even with no agents installed: Start
  opens a plain shell in the project (or its new worktree), named by Herdr. It
  can be the default too, but it can't take a task, so Start asks you to clear
  it or pick an agent.
- **New worktree off:** a new tab in the space's live folder (a new space when
  the project has none or the space has gone).
- **New worktree on:** a branch, a checkout in
  `~/.herdr/worktrees/<repo>/<branch>`, and a space nested under the repo. The
  branch name comes from the task (`agent/fix-login`), follows the task until
  edited, and can be typed. The switch is only available for a project in git.
- **The switch starts off.** A space with an agent working or blocked is
  noted, but only a click or `alt-w` turns the switch on. Git runs only when
  it is on.

A task reaches OpenCode through `--prompt` and Copilot/Antigravity through
`-i`; the rest take Herdr's positional argument. Kimi cannot take a task at
startup, so Start asks you to clear it or pick another agent.

Enter or the **Start** button starts the agent, `tab` moves between fields,
`alt-w` toggles the worktree and `alt-a` picks the next agent. Start is dimmed
until a space and an agent are chosen. The dialog works on this computer
only; spaces on other machines are not listed yet. A worktree starts empty of
ignored files, so a project that needs `.env` or `node_modules` has to set
those up.

## Terminals

The list under Agents shows every tab that has no agent in it, in the order
of your projects. Each row has the tab's name (or its project's), and its
folder, with the machine for a remote one.

- **Click** focuses the terminal.
- **Hover → archive** closes the tab. It goes through the same code as
  Settle, so a worktree's last tab is cleaned up the same way. There is no
  idle/done gate here: a shell has no status, so you decide.
- **`+`** opens New agent with the Terminal chip selected; your default agent
  does not change.

## Settle

Herdr's own **settle** parks a tab and keeps it running. Here the archive
button on an `idle` or `done` agent **closes** the tab, which ends the agent.
A working or blocked agent shows only *pin*, so a stray click cannot kill a
running turn, and a finished agent is kept while another agent in its tab is
still busy. *Settle all* on a group header does the same for every finished
agent in it, one tab after another.

Closing a space's last tab closes the space; the project stays in New agent's
list. For the last tab of a space in `~/.herdr/worktrees`:

- **No uncommitted changes, and merged into the branch the main checkout is on:**
  the space closes and the worktree is removed. The branch stays.
- **Anything else:** Herdr's *Remove worktree* dialog asks first, and cancelling
  leaves everything as it was. *Settle all* skips these instead of asking.

A worktree you created elsewhere is never removed.

## Install

### From a release (recommended)

1. Download `herdr-agents-first-<version>.zip` from
   [Releases](https://github.com/rdurica/herdr-agents-first/releases/latest).
2. Unzip and run the installer:

```sh
unzip herdr-agents-first-*.zip
cd herdr-agents-first
./install.sh
```

The installer copies `mods/agents-clean/`, `mods/new-agent/` and the
`agents-first` layout into `~/.config/herdr-app/`, adds `ctrl-shift-a` to
`keys.json`, runs `herdr-app check`, and switches the window to the layout. An
existing layout with that name is never overwritten, and a key you already
use is left alone. Run it again to update; locally changed mod files and
`keys.json` are backed up to `~/.cache/herdr-agents-first/` first.

Use Herdr from another folder? `HERDR_APP_HOME=/path ./install.sh`.

### Manually

```sh
cp -R mods/agents-clean mods/new-agent ~/.config/herdr-app/mods/
cp install/agents-first.json ~/.config/herdr-app/layouts/
herdr-app check ~/.config/herdr-app/mods/agents-clean
herdr-app check ~/.config/herdr-app/mods/new-agent
herdr-app do layout.switch --name agents-first
```

Add `"ctrl-shift-a": "mod.open:new-agent"` to the `global` section of
`~/.config/herdr-app/keys.json`.

Prefer your own layout? Point its agents block at `{"mod": "agents-clean"}`
and add a block `{"mod": "agents-clean", "props": {"terminals": true}}` where
you want the Terminals list.

### Upgrading from herdr-settle-close

This package used to be called *Settle closes*, with a `main-settle` layout.
The mods keep their names, so `./install.sh` updates them in place and adds
the `agents-first` layout. Remove `~/.config/herdr-app/layouts/main-settle.json`
once you have switched; the installer reminds you while it is there.

### Requirements

- Herdr desktop **0.9.x** (the version with mods / `gpui-kit`).
- `bash` for the installer; the manual copy works everywhere.
- No extra programs, no network access, no build step.

## Safety

- **Settle is destructive by design.** It ends the terminal; there is no undo.
- The built-in `tab.settle` command (palette, CLI, keys) still only parks a
  tab. Only the panel's button closes.
- **The mods run local programs.** `new-agent` runs `git` only when the New
  worktree switch is on, and `agents-clean` runs `git` when it closes a
  space's last tab. Neither reaches the network. `git worktree remove` never
  runs with `--force`, so doubt keeps the worktree.

## How it works

- `agents-clean` is a copy of the shipped **Agents** panel (Herdr 0.9.x,
  version 0.1.10) with Settle rewritten and a `+` in its header. With
  `props: {terminals: true}` the same mod draws the Terminals list instead, so
  both share one close path (`close.js`). `terminals.js` picks the terminal
  rows and `settle.js` decides what happens to a worktree.
- `new-agent` is the dialog. `logic.js` holds everything that can be tested
  without Herdr: the project list, the filter, branch names and launch plans.
- `install/agents-first.json` is the stock `main` layout with the Spaces block
  replaced by Agents (two thirds) and Terminals (one third).

After a Herdr update that changes `mods/agents`, copy it over `agents-clean`
again and re-apply the settle and Terminals changes, or the panel falls behind.

## Uninstall

```sh
rm -rf ~/.config/herdr-app/mods/agents-clean ~/.config/herdr-app/mods/new-agent
rm ~/.config/herdr-app/layouts/agents-first.json
```

Remove the `ctrl-shift-a` line from `keys.json`. Switch to another layout first
(`ctrl-shift-l`); Herdr keeps running as before.

## Repository layout

| Path | What it is |
|---|---|
| `mods/agents-clean/` | the Agents and Terminals panel |
| `mods/new-agent/` | the New agent dialog |
| `install/agents-first.json` | the layout (not in `layouts/`, which herdr.dev does not list) |
| `install.sh` | copies all of it into the app home and checks it |
| `RECIPE.md` | the build brief herdr.dev shows; its title is the listing name |
| `preview.png` | the herdr.dev listing picture |
| `assets/` | README pictures |
| `tests/` | `node --test tests/*.test.mjs`, not part of a release |
| `package.sh` | builds `dist/herdr-agents-first-<version>.zip` |

## Development

```sh
node --test tests/*.test.mjs
herdr-app check mods/agents-clean && herdr-app check mods/new-agent
./package.sh
```

Edits apply live while Herdr runs; `herdr-app status` lists any file or mod
errors, and `herdr-app shot` saves the current frame.

## License

[MIT](LICENSE) © Robert Durica
