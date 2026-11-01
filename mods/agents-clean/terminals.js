// The Terminals list: tabs with a shell and no agent. Pure, so the test can drive it.

// Home as ~ (a Windows path has backslashes and a drive letter).
function tilde(path, home) {
  const [p, h] = [path, home].map((s) => String(s ?? "").replace(/\\/g, "/").replace(/\/+$/, ""));
  if (!h || !p.startsWith(`${h}/`)) return p === h ? "~" : path;
  return `~${p.slice(h.length)}`;
}

// One row per tab nobody reports an agent for, in the sidebar's order (spaces,
// then tabs). A settled tab is parked, and a tab of only mod panes has no shell.
export function terminalRows({ spaces, panes, agents, focused, home }) {
  const agentTabs = new Set(agents.map((a) => a.tab));
  const rows = [];
  for (const space of spaces) {
    for (const tab of space.tabs) {
      if (tab.settled || agentTabs.has(tab.id)) continue;
      const inTab = panes.filter((p) => p.tab === tab.id);
      if (inTab.some((p) => p.status != null)) continue;
      const shells = inTab.filter((p) => p.terminal !== null);
      const pane = shells.find((p) => p.focused) ?? shells[0];
      if (!pane) continue;
      const where = tilde(pane.cwd || space.folder, home);
      rows.push({
        space: space.id,
        tab: tab.id,
        pane: pane.pane,
        name: tab.named ? tab.name : space.name,
        detail: space.machine ? `${space.machine} · ${where}` : where,
        focused: focused?.tab === tab.id,
      });
    }
  }
  return rows;
}
