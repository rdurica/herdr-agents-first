# Changelog

## 0.3.0 — 2026-11-01

- **New agent works across Herdr machines.** The project list now includes the
  open spaces and history of every connected machine, not just this computer.
  Remote rows show `machine · folder`; the same absolute folder on two machines
  stays two projects. History stores the machine, and old entries read as local.
- Agent chips are per machine: `knownAgents({ on })` lists what is installed on
  the selected project's machine, cached per machine in `new-agent.agents` and
  refreshed when the dialog opens. A machine with no agents still offers the
  Terminal chip; Start waits while the first check is running.
- Start makes a remote space with `space.new { machine }` and starts the tab on
  that machine. Git runs there too: a remote worktree goes under that machine's
  `~/.herdr/worktrees`, with its home taken from the machine's shell.
- Start refuses a machine that is offline or still loading, and waits for the
  first agent check on a machine so a launch cannot fall back to Terminal by
  accident.
- Remote folders are browsed in the dialog, because Herdr's folder picker is
  local-only: each remote machine gets a **Folder on &lt;machine&gt;…** row that
  opens a folder browser on that machine. Click or Enter descends,
  `..`/Backspace goes up, `~`/`alt-h` goes home, `alt-enter`/Use this folder
  chooses the current folder, and Show hidden reveals dot-folders.
- `new-agent.agents` changed from one array to a map keyed by machine (`""` is
  this computer); the old shape is migrated on read.
- **Favourite folders.** A star on each project row pins its folder to the top
  of the list in `new-agent.favorites` (50 at most); `alt-f` stars the selected
  row and `alt-1…9` select a favourite. Adding a worktree stores its main
  checkout, so settling the checkout away does not lose it.
- **Closing a workspace keeps its folder.** The Agents panel now remembers
  every open workspace in `new-agent.recent` once a second, so the project is
  still in New agent after Settle closes its space. History grew to 50 and both
  writers use that cap.
- The New agent dialog is larger (720×700), and Start closes it before the
  background history write, so a slow remote machine no longer keeps it open.

## 0.2.0 — 2026-11-01

- **Renamed to Agents first** (`herdr-agents-first`). The layout is now
  `agents-first` and ships as `install/agents-first.json`: herdr.dev does not
  list repos with a `layouts/` folder. The mods keep their names. The
  installer points out a leftover `layouts/main-settle.json`, and the backup
  folder is `~/.cache/herdr-agents-first/`.
- New README and screenshots; `preview.png` shows the whole sidebar.
- **Agents and Terminals, no Spaces.** The layout drops the
  Spaces list. Under Agents, a **Terminals** block (the same `agents-clean` mod
  with `props: { terminals: true }`) lists every tab without an agent: shell
  icon, name, folder (home as `~`, the machine for a remote space). `+` opens
  New agent with the Terminal chip selected; the archive button on hover closes
  the terminal like Settle. An existing layout is kept, and
  the installer says when it lacks the Terminals block.
- Settle no longer opens a fresh tab first: the last tab of a space that is not
  a managed worktree closes the space with it. The project stays in New agent's
  list. The close logic moved to `mods/agents-clean/close.js`, shared by the
  Agents and Terminals blocks.
- New agent takes `props.agent` (a chip key) to preselect that chip for one
  launch; it is not saved as the default until Start.
- **New agent** dialog (`ctrl-shift-a`, or `+` in the Agents header): pick a
  project, an agent and a task, in the project's folder or in a new worktree.
  Projects are the open spaces, then the projects an agent was started in
  before (remembered in `new-agent.recent`, 30 at most, written on Start), and
  any folder through *Other folder…* (`alt-o`). A *Filter projects* input
  narrows the list by name or path. The worktree switch starts off; a space
  with an agent working or blocked is noted on the row. An agent can be set as
  the default, otherwise the last one used is selected, and a Start button
  joins Enter. A **Terminal** chip always comes last and starts a plain shell
  in the project or its worktree; it can't take a task.
- Settling the last tab of a worktree space removes the worktree when it is
  clean and merged, and asks otherwise. `Settle all` skips the ones that would
  ask. The branch stays.
- `Settle all` no longer stops after the first tab or leaves a space's last tab
  behind a confirm dialog: it waits for each tab's close to land before settling
  the next, and it reports the worktrees it skipped in a warning.
- A finished agent is not settled while another agent in its tab is busy.
- The installer installs both mods and adds `ctrl-shift-a` to `keys.json`,
  backing the file up and leaving a key already in use alone.
- New agent passes a task through the agent's own flag where it has one
  (OpenCode `--prompt`, Copilot and Antigravity `-i`) and refuses to start Kimi
  with a task.
- New agent keeps the preferred and last agent, and the installed agent list,
  in `shared` instead of per-copy `localStorage`.
- New agent paints from memory, so no git,
  folder scan or agent check runs while the dialog opens, and it redraws as
  little as it can.
- Agent rows in the priority view and in the Pinned and Settled groups show the
  agent's own session title on a second line instead of an automatic tab number.
- OpenCode's `OC | ` prefix is stripped from that title.
- The installer updates an existing `agents-clean` mod in place instead of
  refusing to run. If the installed `main.js` or `mod.json` was changed, it is
  copied to `~/.cache/herdr-settle-close/` first.
- Release archives and git now ignore the generated `gpui-kit.d.ts` and
  `jsconfig.json` files.

## 0.1.0 — 2026-10-31

First release.

- Agents panel where **Settle** closes the agent's tab instead of parking it.
- A space's last tab is replaced first, so the space does not disappear.
- Settle is offered only for `idle` / `done` agents.
- **Settle all** cleans up a group's finished agents the same way.
- `main-settle` layout, installer, build script and share recipe.
