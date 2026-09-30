// The Sine packaging (theme.json, preferences.json) and the stylesheet the
// module loads itself, which both loaders rely on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loadMod, makeWindow, settle } from "./harness.mjs";

const root = new URL("../", import.meta.url);
const readJSON = path => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const theme = readJSON("theme.json");
const preferences = readJSON("preferences.json");

test("theme.json points Sine at the module and the preferences", () => {
  assert.equal(theme.id, "zen-space-chips");
  const scripts = Object.keys(theme.scripts);
  assert.deepEqual(scripts, ["src/zen-space-chips.sys.mjs"]);
  assert.ok(existsSync(new URL(scripts[0], root)), "script exists");
  assert.ok(existsSync(new URL(theme.preferences, root)), "preferences exist");
  // No style entry: Sine would load it as a user sheet. The module loads it.
  assert.equal(theme.style, undefined);
});

test("theme.json's id matches the folder deploy.sh copies into", () => {
  const deploy = readFileSync(new URL("scripts/deploy.sh", root), "utf8");
  assert.match(deploy, new RegExp(`sine-mods/${theme.id}"`));
});

test("the version matches everywhere", () => {
  const pkg = readJSON("package.json");
  const module = readFileSync(new URL("src/zen-space-chips.sys.mjs", root), "utf8");
  assert.equal(theme.version, pkg.version);
  assert.match(module, new RegExp(`@version\\s+${theme.version.replaceAll(".", "\\.")}\\n`));
});

test("preferences.json covers every pref, with the module's values and defaults", async () => {
  const win = makeWindow();
  const { mod, Services } = await loadMod({ windows: [win] });
  const byProperty = Object.fromEntries(preferences.map(pref => [pref.property, pref]));
  assert.deepEqual(
    Object.keys(byProperty).sort(),
    [mod.PREF_DIVIDER, mod.PREF_MODE, mod.PREF_SHOW_BORDER].sort()
  );

  const optionValues = pref => pref.options.map(option => option.value).sort();
  assert.deepEqual(optionValues(byProperty[mod.PREF_MODE]), [...mod.MODES].sort());
  assert.deepEqual(optionValues(byProperty[mod.PREF_DIVIDER]), [...mod.DIVIDERS].sort());
  assert.equal(byProperty[mod.PREF_SHOW_BORDER].type, "checkbox");

  const defaults = Services.prefs.getDefaultBranch("");
  assert.equal(byProperty[mod.PREF_MODE].defaultValue, defaults.getStringPref(mod.PREF_MODE));
  assert.equal(byProperty[mod.PREF_DIVIDER].defaultValue, defaults.getStringPref(mod.PREF_DIVIDER));
  assert.equal(
    byProperty[mod.PREF_SHOW_BORDER].defaultValue,
    defaults.getBoolPref(mod.PREF_SHOW_BORDER)
  );
});

test("the module loads the stylesheet next to it, once per window, as an author sheet", async () => {
  const a = makeWindow();
  const { mod, CUI } = await loadMod({ windows: [a] });
  await settle();
  assert.ok(mod.STYLESHEET_URL.endsWith("/src/zen-space-chips.uc.css"), mod.STYLESHEET_URL);
  assert.ok(existsSync(new URL(mod.STYLESHEET_URL)), "stylesheet exists");
  assert.deepEqual(a.windowUtils.sheets, [[mod.STYLESHEET_URL, a.windowUtils.AUTHOR_SHEET]]);

  // Moving the widget around doesn't load it again.
  CUI.removeWidgetFromArea("zen-space-chips");
  CUI.addWidgetToArea("zen-space-chips", "PersonalToolbar", 0);
  assert.equal(a.windowUtils.sheets.length, 1);

  // A new window gets its own copy.
  const b = makeWindow();
  CUI.registerWindow(b);
  assert.deepEqual(b.windowUtils.sheets, [[mod.STYLESHEET_URL, b.windowUtils.AUTHOR_SHEET]]);
});
