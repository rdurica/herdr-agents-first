# Changelog

## Unreleased

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
