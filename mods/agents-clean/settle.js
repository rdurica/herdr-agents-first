// What settling a tab does. Pure, so the test can drive every case.

// keep: another agent in the tab is still busy, so closing it would kill that
// turn; wait. close: close the tab; if it is the last one of a space that is not
// ours to remove, Herdr closes the space with it (it stays in the recent list).
// remove: last managed tab, clean and merged: the space and its worktree can go.
// ask: single settle leaves work behind, so the person decides. skip: Settle all
// leaves it alone.
export function settleAction({ lastTab, managed, dirty, merged, busy = false, batch = false }) {
  if (busy) return "keep";
  if (!lastTab || !managed) return "close";
  if (!dirty && merged) return "remove";
  return batch ? "skip" : "ask";
}

// Settle all runs tab after tab: Herdr applies a close on a later tick, so the
// next tab's space is stale until the closed tab is gone. Waits up to `tries`
// pauses for that, then carries on regardless; returns how many were skipped.
export async function settleInTurn(tabs, { settle, gone, pause, tries = 40 }) {
  let skipped = 0;
  for (const tab of tabs) {
    const result = await settle(tab);
    if (result === "skip") {
      skipped += 1;
      continue;
    }
    if (result !== "closed") continue;
    for (let i = 0; i <= tries; i += 1) {
      if (await gone(tab)) break;
      if (i < tries) await pause();
    }
  }
  return skipped;
}

// A tree Herdr made under .herdr/worktrees, not the repo's main checkout.
export function isManaged(top, main) {
  const [t, m] = [top, main].map((p) => String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, ""));
  return t !== m && /(^|\/)\.herdr\/worktrees\/.+/.test(t);
}
