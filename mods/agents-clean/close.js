// Closing a tab for good: what Settle does for an agent and what the Terminals
// list does for a terminal. Needs herdr, so it stays out of the pure modules.

import { spaces, panes, run, exec, notify, openOverlay } from "herdr";
import { settleAction, isManaged } from "./settle.js";

export async function git(cwd, args, on) {
  try {
    const r = await exec("git", args, { cwd, on });
    return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? r.stdout ?? "").trim() };
  } catch (error) {
    return { ok: false, out: "", err: String(error) };
  }
}

// The checkout a space's last tab is in: whether Herdr made it, and whether it
// still holds work. On any doubt (a git error) keep it: dirty and
// not merged, so nothing is deleted on a guess.
async function inspect(folder, on) {
  if (!folder) return null;
  const top = await git(folder, ["rev-parse", "--show-toplevel"], on);
  if (!top.ok) return null;
  const common = await git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"], on);
  if (!common.ok) return null;
  const main = common.out.endsWith("/.git") ? common.out.slice(0, -5) : common.out;
  if (!isManaged(top.out, main)) return { top: top.out, main, managed: false, dirty: true, merged: false };
  const status = await git(top.out, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], on);
  const dirty = !status.ok || status.out !== "";
  let merged = false;
  // Only branch-attached commits survive a worktree remove with their name: a
  // detached HEAD (in the worktree or the main checkout) leaves the question
  // open, and an open question never deletes.
  const head = await git(top.out, ["symbolic-ref", "--quiet", "--short", "HEAD"], on);
  const branch = await git(main, ["symbolic-ref", "--short", "HEAD"], on);
  if (head.ok && head.out && branch.ok && branch.out) {
    merged = (await git(top.out, ["merge-base", "--is-ancestor", "HEAD", `refs/heads/${branch.out}`], on)).ok;
  }
  return { top: top.out, main, managed: true, dirty, merged };
}

// A finished agent can share its tab with one still working; closing the tab
// would end that turn too.
export const tabBusy = (tab) => tab?.status === "working" || tab?.status === "blocked";

// Whether a folder is a checkout or inside it, across Windows and Unix slashes.
const insidePath = (path, top) => {
  const [p, t] = [path, top].map((s) => String(s ?? "").replace(/\\/g, "/").replace(/\/+$/, ""));
  return Boolean(t) && (p === t || p.startsWith(`${t}/`));
};

// Another space (on the same machine) still shows this checkout: removing it
// would pull the files out from under that terminal.
const inUseElsewhere = (spaceId, top, on) =>
  spaces().some(
    (s) =>
      s.id !== spaceId &&
      (s.machine ?? null) === on &&
      s.tabs.some((t) => panes().some((p) => p.tab === t.id && p.cwd && insidePath(p.cwd, top))),
  );

function keepTab(batch) {
  if (!batch) notify({ title: "Tab kept", body: "An agent in it is still working or waiting.", level: "warning" });
  return "keep";
}

// Closing a tab for settle; "closed" tells Settle all to wait for it to go.
function closeTab(id) {
  run("tab.close", { id });
  return "closed";
}

// Settling ends the work: close its tab (and the terminal in it). A tab that is
// its space's last one closes the space with it; a managed worktree that is clean
// and merged goes with it.
// Returns "closed", "keep" or "skip" for Settle all; the single settle ignores it.
export async function settleTab(spaceId, tabId, { batch = false } = {}) {
  const space = spaces().find((s) => s.id === spaceId);
  const tab = space?.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  if (tabBusy(tab)) return keepTab(batch);
  if (space.tabs.length > 1) return closeTab(tabId);

  const folder = panes().find((p) => p.tab === tabId)?.cwd || space.folder;
  const on = space.machine ?? null;
  const repo = await inspect(folder, on);

  // exec awaits: the space, the tab or the other agents in it may have changed.
  const now = spaces().find((s) => s.id === spaceId);
  const current = now?.tabs.find((t) => t.id === tabId);
  if (!current) return;
  const action = settleAction({
    lastTab: now.tabs.length <= 1,
    managed: Boolean(repo?.managed),
    dirty: repo?.dirty ?? true,
    merged: repo?.merged ?? false,
    busy: tabBusy(current),
    batch,
  });

  if (action === "keep") return keepTab(batch);
  if (action === "skip") return "skip";
  if (action === "close") return closeTab(tabId);
  if (action === "remove") {
    // Another space still shows this checkout: keep the tree, close only this tab.
    if (inUseElsewhere(spaceId, repo.top, on)) return closeTab(tabId);
    run("space.close", { id: spaceId, confirmed: true });
    // Without --force: a checkout git still needs is kept, not lost.
    const r = await git(repo.main, ["worktree", "remove", repo.top], on);
    if (!r.ok) notify({ title: "Worktree kept", body: r.err || repo.top, level: "warning" });
    return "closed";
  }
  if (action === "ask") {
    // The stock dialog warns about uncommitted changes; cancelling leaves all as it is.
    openOverlay({
      mod: "worktree",
      kind: "dialog",
      width: 440,
      height: 260,
      props: { space: spaceId, folder: repo.top, action: "remove" },
    });
  }
}
