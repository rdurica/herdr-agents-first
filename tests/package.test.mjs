import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { repoRoot } from "./load.mjs";

test("package.sh leaves the tests folder out of the archive", async () => {
  const source = await readFile(path.join(repoRoot, "package.sh"), "utf8");

  assert.match(
    source,
    /\$name\/tests\/\*/,
    "package.sh must exclude $name/tests/* from the zip",
  );
});
