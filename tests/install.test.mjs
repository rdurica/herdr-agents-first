import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { repoRoot } from "./load.mjs";

const TMP_ROOT = "/tmp/opencode/herdr-settle-close-tests";

async function setup(t) {
  await mkdir(TMP_ROOT, { recursive: true });
  const root = await mkdtemp(path.join(TMP_ROOT, "install-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const appHome = path.join(root, "app-home");
  const home = path.join(root, "home");
  await mkdir(appHome, { recursive: true });
  await mkdir(home, { recursive: true });

  return { root, appHome, home, cache: path.join(home, ".cache", "herdr-settle-close") };
}

function runInstall(appHome, home) {
  return spawnSync("bash", [path.join(repoRoot, "install.sh")], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      HERDR_APP_HOME: appHome,
      HERDR_APP: "/bin/false",
      XDG_CACHE_HOME: "",
    },
  });
}

function ok(result) {
  assert.equal(
    result.status,
    0,
    `install.sh failed (status ${result.status}):\n${result.stdout}\n${result.stderr}`,
  );
  return result;
}

async function filesUnder(dir) {
  const files = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(full));
    else files.push(full);
  }
  return files;
}

async function snapshot(dir) {
  const out = {};
  for (const file of await filesUnder(dir)) out[file] = (await stat(file)).mtimeMs;
  return out;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("fresh install copies both mods and the layout", async (t) => {
  const { appHome, home } = await setup(t);

  ok(runInstall(appHome, home));

  const installed = [
    "mods/agents-clean/main.js",
    "mods/agents-clean/mod.json",
    "mods/agents-clean/settle.js",
    "mods/new-agent/main.js",
    "mods/new-agent/mod.json",
    "mods/new-agent/logic.js",
    "layouts/main-settle.json",
  ];
  for (const rel of installed) {
    assert.ok(existsSync(path.join(appHome, rel)), `${rel} was not installed`);
  }

  for (const rel of [
    "mods/agents-clean/main.js",
    "mods/agents-clean/settle.js",
    "mods/new-agent/main.js",
    "mods/new-agent/logic.js",
    "layouts/main-settle.json",
  ]) {
    assert.equal(
      await readFile(path.join(appHome, rel), "utf8"),
      await readFile(path.join(repoRoot, rel), "utf8"),
      `${rel} differs from the repo copy`,
    );
  }
});

test("adds ctrl-shift-a to keys.json and backs up the original", async (t) => {
  const { appHome, home, cache } = await setup(t);
  const original = { global: { "ctrl-shift-t": "tab.new" }, terminal: {} };
  await writeFile(path.join(appHome, "keys.json"), JSON.stringify(original, null, 2) + "\n");

  ok(runInstall(appHome, home));

  const keys = JSON.parse(await readFile(path.join(appHome, "keys.json"), "utf8"));
  assert.equal(keys.global["ctrl-shift-t"], "tab.new");
  assert.equal(keys.global["ctrl-shift-a"], "mod.open:new-agent");
  assert.deepEqual(keys.terminal, {});

  let backedUp = false;
  for (const file of await filesUnder(cache)) {
    try {
      if (isDeepStrictEqual(JSON.parse(await readFile(file, "utf8")), original)) backedUp = true;
    } catch {
      // Not JSON, so not the keys backup.
    }
  }
  assert.ok(backedUp, "the original keys.json was not backed up under ~/.cache/herdr-settle-close");
});

test("running twice keeps one binding and backs keys.json up only once", async (t) => {
  const { appHome, home, cache } = await setup(t);
  await writeFile(
    path.join(appHome, "keys.json"),
    JSON.stringify({ global: { "ctrl-shift-t": "tab.new" }, terminal: {} }, null, 2) + "\n",
  );

  ok(runInstall(appHome, home));
  const afterFirst = await snapshot(cache);
  await delay(1100);
  ok(runInstall(appHome, home));

  const text = await readFile(path.join(appHome, "keys.json"), "utf8");
  const keys = JSON.parse(text);
  assert.equal(keys.global["ctrl-shift-a"], "mod.open:new-agent");
  assert.equal((text.match(/"ctrl-shift-a"/g) ?? []).length, 1);

  assert.deepEqual(await snapshot(cache), afterFirst, "keys.json was backed up again");
});

test("leaves a keys.json that already binds ctrl-shift-a untouched", async (t) => {
  const { appHome, home } = await setup(t);
  const bytes = JSON.stringify({ global: { "ctrl-shift-a": "tab.settle" }, terminal: {} }, null, 2) + "\n";
  await writeFile(path.join(appHome, "keys.json"), bytes);

  const result = ok(runInstall(appHome, home));

  assert.equal(await readFile(path.join(appHome, "keys.json"), "utf8"), bytes);
  assert.match(`${result.stdout}${result.stderr}`, /ctrl-shift-a/);
});

test("no keys.json means no file is created and the binding is printed", async (t) => {
  const { appHome, home } = await setup(t);

  const result = ok(runInstall(appHome, home));

  assert.equal(existsSync(path.join(appHome, "keys.json")), false);
  const output = `${result.stdout}${result.stderr}`;
  assert.match(output, /ctrl-shift-a/);
  assert.match(output, /mod\.open:new-agent/);
});

test("opens a one-line empty global object", async (t) => {
  const { appHome, home } = await setup(t);
  await writeFile(
    path.join(appHome, "keys.json"),
    '{\n  "global": {},\n  "terminal": {}\n}\n',
  );

  ok(runInstall(appHome, home));

  const keys = JSON.parse(await readFile(path.join(appHome, "keys.json"), "utf8"));
  assert.equal(keys.global["ctrl-shift-a"], "mod.open:new-agent");
  assert.deepEqual(keys.terminal, {});
});

test("does not claim a binding it could not add", async (t) => {
  const { appHome, home } = await setup(t);
  // The global object starts with a key on the same line, so the awk insertion
  // cannot place one; the value happens to contain the key name too.
  const bytes = '{\n  "global": { "ctrl-shift-t": "tab.new" },\n  "terminal": { "note": "ctrl-shift-a" }\n}\n';
  await writeFile(path.join(appHome, "keys.json"), bytes);

  const result = ok(runInstall(appHome, home));

  assert.equal(await readFile(path.join(appHome, "keys.json"), "utf8"), bytes);
  assert.match(`${result.stdout}${result.stderr}`, /Could not add the key/);
});

test("backs up a changed installed logic.js before replacing it", async (t) => {
  const { appHome, home, cache } = await setup(t);
  ok(runInstall(appHome, home));

  const installed = path.join(appHome, "mods/new-agent/logic.js");
  const local = (await readFile(installed, "utf8")) + "\n// local tweak\n";
  await writeFile(installed, local);

  ok(runInstall(appHome, home));

  let backedUp = false;
  for (const file of await filesUnder(cache)) {
    if ((await readFile(file, "utf8")) === local) backedUp = true;
  }
  assert.ok(backedUp, "the changed logic.js was not backed up");
  assert.equal(
    await readFile(installed, "utf8"),
    await readFile(path.join(repoRoot, "mods/new-agent/logic.js"), "utf8"),
  );
});
