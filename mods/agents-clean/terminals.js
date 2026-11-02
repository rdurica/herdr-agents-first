// The Terminals list: tabs with a shell and no agent. Pure, so the test can drive it.

// Home as ~ (a Windows path has backslashes and a drive letter).
function tilde(path, home) {
  const [p, h] = [path, home].map((s) => String(s ?? "").replace(/\\/g, "/").replace(/\/+$/, ""));
  if (!h || !p.startsWith(`${h}/`)) return p === h ? "~" : path;
  return `~${p.slice(h.length)}`;
}

// The title without its leading icon-spinner decoration, but keeping a leading ~
// or / so a path still looks like one.
export const titleOf = (title) => String(title ?? "").replace(/^[^\p{L}\p{N}~\/]+/u, "").trim();

// What the title says beyond the program: it still names something (not the
// program itself, a path or a user@host prompt).
function telling(title, program) {
  if (!title || title.includes("@")) return false;
  if (/^([~/]|[A-Za-z]:[\\/])/.test(title)) return false;
  return [program.name, program.key].every((n) => title.toLowerCase() !== String(n ?? "").toLowerCase());
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
      const program = pane.program ?? null;
      const where = tilde(pane.cwd || space.folder, home);
      // A shell keeps the folder; a running program says what it is and, when
      // the title adds something, what it works on.
      const title = program && !program.shell ? titleOf(pane.title) : "";
      const detail = program && !program.shell
        ? [space.machine, program.name, telling(title, program) ? title : where].filter(Boolean).join(" · ")
        : space.machine ? `${space.machine} · ${where}` : where;
      rows.push({
        space: space.id,
        tab: tab.id,
        pane: pane.pane,
        name: tab.named ? tab.name : space.name,
        detail,
        program,
        focused: focused?.tab === tab.id,
      });
    }
  }
  return rows;
}
