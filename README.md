<p align="center">
  <img src="preview.png" alt="The Agents panel with the settle-closes mod" width="420" />
</p>

<h1 align="center">Herdr · Settle Closes</h1>

<p align="center">
  A <a href="https://herdr.dev">Herdr</a> mod and layout: <b>Settle</b> closes the agent's tab<br/>
  instead of parking it — and the space never disappears with the last one.
</p>

<p align="center">
  <img alt="Herdr" src="https://img.shields.io/badge/Herdr-0.9.x-5b8def" />
  <img alt="Mod" src="https://img.shields.io/badge/format-herdr--mod-2ea44f" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue" />
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
- **The rest is the stock panel.** Priority / grouped-by-space sorting, pins,
  sub-agent trees, attention states, the compact rail — all unchanged.

> The archive icon in the screenshot is *Settle all* for the Idle group. On a
> row, pin and settle appear on hover, next to the agent's name.

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

The installer copies `mods/agents-clean/` and `layouts/main-settle.json` into
`~/.config/herdr-app/`, runs `herdr-app check`, and switches the window to the
`main-settle` layout. An existing layout with that name is never overwritten.

Use Herdr from another folder? `HERDR_APP_HOME=/path ./install.sh`.

### Manually

```sh
cp -R mods/agents-clean ~/.config/herdr-app/mods/
cp layouts/main-settle.json ~/.config/herdr-app/layouts/
herdr-app check ~/.config/herdr-app/mods/agents-clean
```

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

The mod is a copy of the shipped **Agents** panel with one function added and
one button rewired:

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
- The mod does not run programs (`exec`, `hc`), reach the network, or read
  files. It only calls `run()` and draws with the shipped icons.

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
rm -rf ~/.config/herdr-app/mods/agents-clean
rm ~/.config/herdr-app/layouts/main-settle.json
```

Switch to another layout first (`ctrl-shift-l`); Herdr keeps running as before.

## Repository layout

| Path | What it is |
|---|---|
| `mods/agents-clean/` | the mod: `main.js` + `mod.json` |
| `layouts/main-settle.json` | the layout that shows the mod |
| `install.sh` | copies both into the app home and checks them |
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
