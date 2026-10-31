# Changelog

## Unreleased

- **New agent** dialog (`ctrl-shift-a`, or `+` in the Agents header): pick an
  open space, an agent and a task, in the space's folder or in a new worktree.
  The worktree switch starts off; a space with an agent working or blocked is
  noted on the row. An agent can be set as the default, otherwise the last one used is
  selected, and a Start button joins Enter. A new space is made with Spaces `+`
  first.
- Settling the last tab of a worktree space removes the worktree when it is
  clean and merged, and asks otherwise. `Settle all` skips the ones that would
  ask. The branch stays.
- A finished agent is not settled while another agent in its tab is busy.
- The installer installs both mods and adds `ctrl-shift-a` to `keys.json`,
  backing the file up and leaving a key already in use alone.
- New agent passes a task through the agent's own flag where it has one
  (OpenCode `--prompt`, Copilot and Antigravity `-i`) and refuses to start Kimi
  with a task.
- New agent keeps the preferred and last agent, and the installed agent list,
  in `shared` instead of per-copy `localStorage`.
- New agent lists open local spaces alone and paints from memory, so no git,
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
