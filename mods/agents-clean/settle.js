// What settling a tab does. Pure, so the test can drive every case.

// keep: another agent in the tab is still busy, so closing it would kill that
// turn; wait. close: another tab stays in the space. replace: the space is not
// ours to remove, so give it a fresh tab first. remove: last managed tab, clean
// and merged: the space and its worktree can go. ask: single settle leaves work
// behind, so the person decides. skip: Settle all leaves it alone.
export function settleAction({ lastTab, managed, dirty, merged, busy = false, batch = false }) {
  if (busy) return "keep";
  if (!lastTab) return "close";
  if (!managed) return "replace";
  if (!dirty && merged) return "remove";
  return batch ? "skip" : "ask";
}

// A tree Herdr made under .herdr/worktrees, not the repo's main checkout.
export function isManaged(top, main) {
  const [t, m] = [top, main].map((p) => String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, ""));
  return t !== m && /(^|\/)\.herdr\/worktrees\/.+/.test(t);
}
