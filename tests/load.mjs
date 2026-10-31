import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The mods folder must contain only the mod, so it has no package.json to mark
// its .js files as ES modules. Load a mod's plain .js file through a data URL
// instead of importing the path directly.
export async function loadMod(relativePath) {
  const source = await readFile(path.join(repoRoot, relativePath), "utf8");
  return import("data:text/javascript," + encodeURIComponent(source));
}
