// Runs scripts/deploy.sh against throwaway install and profile folders. Their
// paths have spaces and parentheses, like real Zen profiles. A stub stands in
// for tasklist.exe. Uses reference/fx-autoconfig, downloading it at the pinned
// commit if it's missing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEPLOY = join(REPO, "scripts", "deploy.sh");
const FXAC = join(REPO, "reference", "fx-autoconfig");

const TASKLIST_OUTPUT = {
  running: `echo '"zen.exe","69336","Console","1","712,768 K"'`,
  stopped: `echo 'INFO: No tasks are running which match the specified criteria.'`,
  failing: `exit 1`,
};

function fixture(t, { chrome = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "zen-chips-deploy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fx = {
    root,
    install: join(root, "Zen Browser"),
    profile: join(root, "Profiles", "abc.Default (release)-1"),
    cache: join(root, "startupCache"),
  };
  fx.chrome = join(fx.profile, "chrome");
  mkdirSync(fx.install, { recursive: true });
  writeFileSync(join(fx.install, "zen.exe"), "");
  writeFileSync(join(fx.install, "application.ini"), "[App]\nVersion=1.22.3b\n");
  mkdirSync(fx.profile, { recursive: true });
  writeFileSync(join(fx.profile, "prefs.js"), "");
  mkdirSync(fx.cache);
  writeFileSync(join(fx.cache, "startupCache.8.little"), "cache");
  if (chrome) {
    mkdirSync(fx.chrome);
    writeFileSync(join(fx.chrome, "userChrome.css"), "/* mine */");
  }
  for (const [state, body] of Object.entries(TASKLIST_OUTPUT)) {
    const stub = join(root, `tasklist-${state}`);
    writeFileSync(stub, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(stub, 0o755);
  }
  return fx;
}

function deploy(fx, args, { zen = "stopped" } = {}) {
  const result = spawnSync("bash", [DEPLOY, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ZEN_INSTALL: fx.install,
      ZEN_PROFILE: fx.profile,
      ZEN_STARTUP_CACHE: fx.cache,
      ZEN_TASKLIST: join(fx.root, `tasklist-${zen}`),
    },
  });
  return { ...result, output: result.stdout + result.stderr };
}

const read = path => readFileSync(path, "utf8");
const backups = fx =>
  readdirSync(fx.profile).filter(name => name.startsWith("chrome.backup-"));

test("loader installs into a profile that has no chrome/ yet", t => {
  const fx = fixture(t);
  const r = deploy(fx, ["loader"]);
  assert.equal(r.status, 0, r.output);
  assert.equal(
    read(join(fx.install, "config.js")),
    read(join(FXAC, "program", "config.js"))
  );
  assert.ok(existsSync(join(fx.chrome, "utils", "boot.sys.mjs")));
  assert.deepEqual(backups(fx), []);
});

test("loader backs up an existing chrome/ first", t => {
  const fx = fixture(t, { chrome: true });
  const r = deploy(fx, ["loader"]);
  assert.equal(r.status, 0, r.output);
  const [backup] = backups(fx);
  assert.equal(read(join(fx.profile, backup, "userChrome.css")), "/* mine */");
});

test("loader refuses to overwrite a different config-prefs.js and writes nothing", t => {
  const fx = fixture(t, { chrome: true });
  const prefs = join(fx.install, "defaults", "pref", "config-prefs.js");
  mkdirSync(dirname(prefs), { recursive: true });
  writeFileSync(prefs, 'pref("someone.else", true);');

  const r = deploy(fx, ["loader"]);
  assert.notEqual(r.status, 0);
  assert.match(r.output, /config-prefs\.js/);
  assert.equal(read(prefs), 'pref("someone.else", true);');
  assert.equal(existsSync(join(fx.install, "config.js")), false);
  assert.equal(existsSync(join(fx.chrome, "utils")), false);
  assert.deepEqual(backups(fx), []);
});

test("loader refuses to overwrite a different config.js (e.g. Sine's)", t => {
  const fx = fixture(t);
  writeFileSync(join(fx.install, "config.js"), "// skip\n// userchromejs but edited");
  const r = deploy(fx, ["loader"]);
  assert.notEqual(r.status, 0);
  assert.match(r.output, /config\.js/);
});

test("loader can be run again over its own install", t => {
  const fx = fixture(t);
  assert.equal(deploy(fx, ["loader"]).status, 0);
  const again = deploy(fx, ["loader"]);
  assert.equal(again.status, 0, again.output);
});

test("mod refuses without the loader and copies nothing", t => {
  const fx = fixture(t);
  const r = deploy(fx, ["mod"]);
  assert.notEqual(r.status, 0);
  assert.equal(existsSync(join(fx.chrome, "JS")), false);
});

test("mod copies the JS and CSS into the profile", t => {
  const fx = fixture(t);
  deploy(fx, ["loader"]);
  const r = deploy(fx, ["mod"]);
  assert.equal(r.status, 0, r.output);
  for (const [dir, file] of [
    ["JS", "zen-space-chips.sys.mjs"],
    ["CSS", "zen-space-chips.uc.css"],
  ]) {
    assert.equal(read(join(fx.chrome, dir, file)), read(join(REPO, "src", file)));
  }
  assert.ok(existsSync(fx.cache), "cache untouched without --clear-cache");
});

for (const zen of ["running", "failing"]) {
  test(`mod --clear-cache changes nothing when Zen is ${zen === "failing" ? "undetectable" : zen}`, t => {
    const fx = fixture(t);
    deploy(fx, ["loader"]);
    const r = deploy(fx, ["mod", "--clear-cache"], { zen });
    assert.notEqual(r.status, 0);
    assert.match(r.output, /can't confirm Zen is closed/);
    assert.ok(existsSync(fx.cache), "startup cache kept");
    assert.equal(existsSync(join(fx.chrome, "JS", "zen-space-chips.sys.mjs")), false);
  });
}

test("mod --clear-cache clears the cache when Zen is closed", t => {
  const fx = fixture(t);
  deploy(fx, ["loader"]);
  const r = deploy(fx, ["mod", "--clear-cache"], { zen: "stopped" });
  assert.equal(r.status, 0, r.output);
  assert.equal(existsSync(fx.cache), false);
});

test("remove-loader deletes only unchanged loader files", t => {
  const fx = fixture(t);
  deploy(fx, ["loader"]);
  const utils = join(fx.chrome, "utils");
  writeFileSync(join(utils, "my-own-helper.mjs"), "// mine");
  writeFileSync(join(utils, "utils.sys.mjs"), "// edited by hand");
  rmSync(join(fx.install, "config.js")); // already gone: must not matter

  const r = deploy(fx, ["remove-loader"]);
  assert.equal(r.status, 0, r.output);
  assert.equal(existsSync(join(fx.install, "defaults", "pref", "config-prefs.js")), false);
  assert.equal(existsSync(join(utils, "boot.sys.mjs")), false);
  assert.equal(read(join(utils, "my-own-helper.mjs")), "// mine");
  assert.equal(read(join(utils, "utils.sys.mjs")), "// edited by hand");
  assert.match(r.output, /Kept/);
});

test("remove-loader leaves a foreign config.js alone", t => {
  const fx = fixture(t);
  writeFileSync(join(fx.install, "config.js"), "// someone else's autoconfig");
  const r = deploy(fx, ["remove-loader"]);
  assert.equal(r.status, 0, r.output);
  assert.equal(read(join(fx.install, "config.js")), "// someone else's autoconfig");
});

test("remove deletes only the mod's own files", t => {
  const fx = fixture(t, { chrome: true });
  deploy(fx, ["loader"]);
  deploy(fx, ["mod"]);
  const r = deploy(fx, ["remove"]);
  assert.equal(r.status, 0, r.output);
  assert.equal(existsSync(join(fx.chrome, "JS", "zen-space-chips.sys.mjs")), false);
  assert.equal(existsSync(join(fx.chrome, "CSS", "zen-space-chips.uc.css")), false);
  assert.ok(existsSync(join(fx.chrome, "utils", "boot.sys.mjs")));
  assert.equal(read(join(fx.chrome, "userChrome.css")), "/* mine */");
});
