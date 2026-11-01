// The open spaces folded into New agent's history (`new-agent.recent`), so a
// space closed here keeps its folder in that dialog. Pure: no Herdr API, so the
// test can import it directly.

const storedMachine = (machine) => (typeof machine === "string" && machine ? machine : null);
const lastSegment = (folder) => folder.split(/[\\/]/).filter(Boolean).pop() ?? folder;

// A stored entry is usable when it names a folder; a missing machine is this
// computer, and a missing name is the folder's last segment.
function readStored(value) {
  if (!Array.isArray(value)) return [];
  const list = [];
  for (const e of value) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    if (typeof e.folder !== "string" || !e.folder) continue;
    list.push({
      folder: e.folder,
      machine: storedMachine(e.machine),
      name: typeof e.name === "string" && e.name ? e.name : lastSegment(e.folder),
      git: Boolean(e.git),
    });
  }
  return list;
}

// The stored projects with every open space's folder added at the front, in the
// rows' order. Known entries keep their place; a folder already stored by that
// machine is not added again. null when the rows bring nothing new, so the
// caller can skip writing shared.
export function rememberSpaces(value, rows, cap = 50) {
  const stored = readStored(value);
  if (!Array.isArray(rows)) return null;
  const seen = new Set(stored.map((e) => JSON.stringify([e.machine, e.folder])));
  const added = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    if (typeof row.key !== "string" || !row.key) continue;
    const machine = storedMachine(row.machine);
    const id = JSON.stringify([machine, row.key]);
    if (seen.has(id)) continue;
    seen.add(id);
    added.push({
      folder: row.key,
      machine,
      name: typeof row.name === "string" && row.name ? row.name : lastSegment(row.key),
      git: Boolean(row.git),
    });
  }
  if (!added.length) return null;
  return [...added, ...stored].slice(0, cap);
}
