<h1 align="center">Herdr · Settle Closes</h1>

<p align="center">
  A <a href="https://herdr.dev">Herdr</a> package for agent-first work: start an agent in any project,<br/>
  in a worktree when you want one, and let <b>Settle</b> clean up after it.
</p>

<p align="center">
  <img alt="Herdr" src="https://img.shields.io/badge/Herdr-0.9.x-5b8def" />
  <img alt="Mod" src="https://img.shields.io/badge/format-herdr--mod-2ea44f" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue" />
</p>

<p align="center">
  <img src="assets/settle.png" alt="Three blue birds flying through an open doorway" width="280" />
</p>

## The problem

Herdr's **settle** is gentle: it puts a tab away but keeps it running, and in a
tab bar that lists every tab the finished work stays around. After a day of
agents you have a row of zombie tabs and terminals you no longer need.

This mod makes settle mean what it says: **the work is done, clean it up**.

## What you get

- **Settle = close.** The archive button on an agent row closes its tab
  (`tab.close`), which ends the terminal and the agent in it.
- **The space stays.** If that tab was the space's last one, a fresh tab opens
  first in the same folder, so the space does not vanish with it.
- **Safe by default.** The button only appears for `idle` and `done` agents.
  A working or blocked agent shows only *pin*, so a stray click cannot kill a
  running turn.
- **Settle all.** The group header's archive button cleans up every finished
  agent in that group the same way.
- **New agent.** `ctrl-shift-a` or the `+` in the Agents header opens one dialog:
  space, agent, task and a **New worktree** switch. See below.
- **Worktrees clean up after themselves.** See [Settling a worktree](#settling-a-worktree).
- **The rest is the stock panel.** Priority / grouped-by-space sorting, pins,
  sub-agent trees, attention states, the compact rail — all unchanged.

> The archive icon in the screenshot is *Settle all* for the Idle group. On a
> row, pin and settle appear on hover, next to the agent's name.

<p align="center">
  <img src="preview.png" alt="The Agents panel with the settle-closes mod" width="297" />
</p>

## New agent

The Spaces `+` copies the folder you are in, which is how one project ends up
in several spaces. The **New agent** dialog lists the spaces that are already
open; make a new space with Spaces `+` first.

- **Space:** one row per open local space, named after the space and keyed by
  its live folder; the active space comes first. Nothing is scanned or asked
  of git while the dialog opens, so it paints at once. Remote spaces are not
  listed.
- **Agent:** installed agents as chips. The list is stored the first time, so
  the dialog does not ask again; to pick up a newly installed agent, remove
  `new-agent.agents` from `~/.config/herdr-app/shared.json`.
  *Set as default* above the list remembers one; otherwise the last agent used
  is selected. Picking another chip for one launch does not change the default.
- **New worktree off:** a new tab in the space's live folder (a new space when
  the space has gone).
- **New worktree on:** a branch, a checkout in
  `~/.herdr/worktrees/<repo>/<branch>`, and a space nested under the repo. The
  branch name comes from the task (`agent/fix-login`), follows the task until
  edited, and can be typed. The switch is only available for a space on a git
  branch.
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

## Settling a worktree

Settling the last tab of a space in `~/.herdr/worktrees`:

- **No uncommitted changes, and merged into the branch the main checkout is on:**
  the space closes and the worktree is removed. The branch stays.
- **Anything else:** Herdr's *Remove worktree* dialog asks first, and cancelling
  leaves everything as it was. `Settle all` skips these instead of asking.

Any other tab or space settles as described above. A worktree you created
elsewhere is never removed.

## Install

### From a release (recommended)

1. Download `herdr-settle-close-0.1.0.zip` from
   [Releases](https://github.com/rdurica/herdr-settle-close/releases/latest).
2. Unzip and run the installer:

```sh
unzip herdr-settle-close-0.1.0.zip
cd herdr-settle-close
./install.sh
```

The installer copies `mods/agents-clean/`, `mods/new-agent/` and
`layouts/main-settle.json` into `~/.config/herdr-app/`, adds `ctrl-shift-a` to
`keys.json`, runs `herdr-app check`, and switches the window to the
`main-settle` layout. An existing layout with that name is never overwritten,
and a key you already use is left alone. Run it again to update; locally
changed mod files and `keys.json` are backed up to
`~/.cache/herdr-settle-close/` first.

Use Herdr from another folder? `HERDR_APP_HOME=/path ./install.sh`.

### Manually

```sh
cp -R mods/agents-clean mods/new-agent ~/.config/herdr-app/mods/
cp layouts/main-settle.json ~/.config/herdr-app/layouts/
herdr-app check ~/.config/herdr-app/mods/agents-clean
herdr-app check ~/.config/herdr-app/mods/new-agent
```

Add `"ctrl-shift-a": "mod.open:new-agent"` to the `global` section of
`~/.config/herdr-app/keys.json`.

Then pick the layout with `ctrl-shift-l`, or:

```sh
herdr-app do layout.switch --name main-settle
```

You can also clone your own layout (`herdr-app do layout.clone --name main --as my-layout`)
and point its agents block at `"mod": "agents-clean"`.

### Requirements

- Herdr desktop **0.9.x** (the version with mods / `gpui-kit`).
- `bash` for the installer; the manual copy works everywhere.
- No extra programs, no network access, no build step.

## How it works

`agents-clean` is a copy of the shipped **Agents** panel with settling rewritten
and a `+` in its header. `new-agent` is a separate dialog mod. This is the basic
settle; `mods/agents-clean/settle.js` holds the worktree decisions:

```js
// Settling ends the work: close its tab (and the terminal in it). A tab that is
// its space's last one gets a new tab first, so the space stays instead of
// closing with it.
function settleTab(spaceId, tabId) {
  const space = spaces().find((s) => s.id === spaceId);
  if (!space) return;
  if (space.tabs.length <= 1) {
    const folder = panes().find((p) => p.tab === tabId)?.cwd || space.folder;
    run("tab.new", folder ? { space: space.id, folder } : { space: space.id });
  }
  run("tab.close", { id: tabId });
}
```

The hover action calls it instead of `tab.settle`:

```js
const finished = a.status === "idle" || a.status === "done";
const settle = !finished ? null : action(
  `settle-${a.address}`, "archive", "Settle: close its tab and end it",
  () => settleTab(a.space, a.tab),
);
```

`layouts/main-settle.json` is a copy of the stock `main` layout whose `agents`
block points at `agents-clean`; everything else (sidebar, tabs, files panel,
status bar) is the shipped setup.

## Safety

- **Destructive by design.** Settle ends the terminal. There is no undo, and a
  running agent's turn is lost — that is why the button is gated on `idle` /
  `done`.
- `Settle all` is always visible on groups that have finished agents and closes
  several tabs at once.
- The built-in `tab.settle` command (palette, CLI, keys) is part of the Herdr
  core and still only parks a tab. This mod changes the panel's button only.
- A finished agent is not settled while another agent in its tab is working or
  blocked.
- **The mods run local programs.** `new-agent` runs `git` only when the New
  worktree switch is on, and `agents-clean` runs `git` when it settles a
  space's last tab. Neither reaches the network. `git worktree remove` never
  runs with `--force` from Settle, so doubt keeps the worktree.

## Customize

- **Name / folder:** if you rename `mods/agents-clean`, update `mod.json`,
  the layout's `"mod": "agents-clean"`, and the sort popup's
  `openOverlay({ mod: "agents-clean" })` inside `main.js`.
- **Allow settling working agents:** change the `finished` check in
  `mods/agents-clean/main.js` — know that it kills the turn.
- **Different look:** layouts take theme colors, fonts and sizes; the layout's
  sidebar width, tab bar height and panel are plain numbers in
  `layouts/main-settle.json`.
- **Upstream updates:** this is a copy of the `agents` mod shipped with Herdr
  0.9.x (version 0.1.10). After a Herdr update, copy the new `mods/agents`
  over and re-apply `settleTab` + the button change, or the panel will fall
  behind new features.

## Uninstall

```sh
rm -rf ~/.config/herdr-app/mods/agents-clean ~/.config/herdr-app/mods/new-agent
rm ~/.config/herdr-app/layouts/main-settle.json
```

Remove the `ctrl-shift-a` line from `keys.json`. Switch to another layout first (`ctrl-shift-l`); Herdr keeps running as before.

## Repository layout

| Path | What it is |
|---|---|
| `mods/agents-clean/` | the Agents panel: `main.js`, `settle.js`, `mod.json` |
| `mods/new-agent/` | the New agent dialog: `main.js`, `logic.js`, `mod.json` |
| `layouts/main-settle.json` | the layout that shows the panel |
| `install.sh` | copies all of it into the app home and checks it |
| `tests/` | `node --test`, not part of a release |
| `RECIPE.md` | a build brief, in the format [herdr.dev/mods](https://herdr.dev/mods) uses |
| `preview.png` | screenshot for the share page |
| `package.sh` | builds `dist/herdr-settle-close-<version>.zip` |
| `VERSION` | release version |
| `CHANGELOG.md` | what changed |

## Development

```sh
herdr-app check mods/agents-clean     # must pass
./package.sh                          # build the release zip
```

Edits apply live while Herdr runs; `herdr-app status` lists any file or mod
errors, and `herdr-app shot` saves the current frame for a quick look.

## Sharing

The repo follows the Herdr share format (`mods/`, `RECIPE.md`, `preview.png`),
so it can be published at [herdr.dev/mods](https://herdr.dev/mods) — the
GitHub topic is `herdr-mod`.

## License

[MIT](LICENSE) © Robert Durica
