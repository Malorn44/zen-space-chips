// The accent ring: each chip gets the toolbar background Zen draws for its
// Space, with the colors lifted for a dark or light toolbar.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { chipsOf, loadMod, makeWindow, settle } from "./harness.mjs";

const PREF_SHOW_BORDER = "uc.space-chips.show-border";
const BASE = "rgba(23, 23, 26, 1)";

const color = c => ({ c, isCustom: typeof c === "string" });
const theme = (...colors) => ({ type: "gradient", opacity: 0.5, gradientColors: colors });

async function setup(spaces) {
  const win = makeWindow({ spaces });
  const loaded = await loadMod({ windows: [win] });
  await settle();
  const accent = (uuid, scheme = "dark") =>
    chipsOf(win)
      .find(chip => chip.getAttribute("zen-workspace-id") === uuid)
      .style.getPropertyValue(`--space-accent-${scheme}`);
  return { win, zen: win.gZenWorkspaces, picker: win.gZenThemePicker, accent, ...loaded };
}

const SPACES = () => [
  { uuid: "{two}", name: "Two", icon: "", theme: theme(color([255, 0, 0]), color([0, 0, 255])) },
  { uuid: "{one}", name: "One", icon: "", theme: theme(color([0, 128, 0])) },
  { uuid: "{none}", name: "None", icon: "" }, // Zen's default theme
];

/** Hue in degrees, 0-360. */
function hue([r, g, b]) {
  const [R, G, B] = [r, g, b].map(v => v / 255);
  const max = Math.max(R, G, B);
  const d = max - Math.min(R, G, B);
  if (d === 0) {
    return 0;
  }
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return (h * 60 + 360) % 360;
}

test("the ring is Zen's toolbar background with its colors lifted, over the base", async () => {
  const { accent } = await setup(SPACES());
  // Worked out by hand: pure red and blue keep full saturation, and lightness
  // goes from 0.5 to 0.5 * 0.4 + target * 0.6 (target 0.62 dark, 0.42 light).
  assert.equal(
    accent("{two}", "dark"),
    `linear-gradient(-30deg, rgba(255, 37, 37, 1), rgba(37, 37, 255, 1)), ${BASE}`
  );
  assert.equal(
    accent("{two}", "light"),
    `linear-gradient(-30deg, rgba(231, 0, 0, 1), rgba(0, 0, 231, 1)), ${BASE}`
  );
});

test("lifting keeps every color's hue", async () => {
  const { mod } = await setup(SPACES());
  const cases = {
    "teal (Zen's toolbar green)": [8, 207, 130],
    "light red": [240, 110, 110],
    "dark purple": [40, 14, 55],
    "olive": [42, 51, 15],
  };
  for (const [label, rgb] of Object.entries(cases)) {
    for (const dark of [true, false]) {
      const lifted = mod.liftColor(rgb, dark);
      const drift = Math.abs(hue(lifted) - hue(rgb));
      assert.ok(Math.min(drift, 360 - drift) < 2, `${label} (${dark ? "dark" : "light"}): ${lifted}`);
    }
  }
  // Colors that turn cyan or white if the RGB channels are just scaled up:
  const teal = mod.liftColor([8, 207, 130], true);
  assert.ok(teal[1] - teal[2] > 50, `teal stays green, not cyan: ${teal}`);
  const red = mod.liftColor([240, 110, 110], true);
  assert.ok(red[0] - red[1] > 80, `light red stays red, not white: ${red}`);
});

test("rgba alpha and #rrggbb custom colors survive lifting", async () => {
  const { mod } = await setup(SPACES());
  assert.match(mod.liftColors("rgba(10, 20, 30, 0.5)", true), /^rgba\(\d+, \d+, \d+, 0\.5\)$/);
  assert.match(mod.liftColors("linear-gradient(#ff8800, transparent)", true), /^linear-gradient\(rgba\(\d+, \d+, \d+, 1\), transparent\)$/);
});

test("a one-color theme is a plain color, used on its own", async () => {
  const { accent } = await setup(SPACES());
  assert.match(accent("{one}", "dark"), /^rgba\(\d+, \d+, \d+, 1\)$/);
  assert.match(accent("{one}", "light"), /^rgba\(\d+, \d+, \d+, 1\)$/);
});

test("Spaces on Zen's default theme get no ring", async () => {
  const { win, picker, accent } = await setup(SPACES());
  const none = chipsOf(win)[2];
  assert.equal(none.hasAttribute("has-accent"), false);
  assert.equal(accent("{none}"), "");
  assert.ok(!picker.computed.includes("{none}"));
});

test("without Zen's theme picker the chips work, just without rings", async () => {
  const win = makeWindow({ spaces: SPACES() });
  delete win.gZenThemePicker;
  await loadMod({ windows: [win] });
  await settle();
  assert.equal(chipsOf(win).length, 3);
  assert.ok(chipsOf(win).every(chip => !chip.hasAttribute("has-accent")));
});

test("changing a Space's theme drops Zen's cached colors for just that Space", async () => {
  const { zen, picker, accent } = await setup(SPACES());
  assert.deepEqual(picker.invalidated, [], "nothing dropped on first render");

  zen._workspaceCache[1] = { ...zen._workspaceCache[1], theme: theme(color([255, 255, 0])) };
  zen.fireDataChanged();

  assert.deepEqual(picker.invalidated, ["{one}"]);
  assert.equal(accent("{one}"), "rgba(255, 255, 37, 1)"); // yellow, lifted
});

test("light/dark changes refresh every Space's colors", async () => {
  const { Services, picker } = await setup(SPACES());
  Services.obs.notifyObservers(null, "zen-theme-change");
  assert.deepEqual(picker.invalidated.sort(), ["{none}", "{one}", "{two}"]);
  // Re-rendered, so the Spaces with colors were computed again.
  assert.equal(picker.computed.filter(uuid => uuid === "{two}").length, 2);
});

test("show-border is listed in about:config and turns the rings off", async () => {
  const { win, Services } = await setup(SPACES());
  const row = win.document.getElementById("zen-space-chips");
  assert.equal(Services.prefs.getDefaultBranch("").getBoolPref(PREF_SHOW_BORDER), true);
  assert.equal(Services.prefs.prefHasUserValue(PREF_SHOW_BORDER), false);
  assert.equal(row.hasAttribute("show-border"), true);

  Services.prefs.setBoolPref(PREF_SHOW_BORDER, false);
  assert.equal(row.hasAttribute("show-border"), false);
  assert.ok(chipsOf(win).every(chip => !chip.hasAttribute("has-accent")));

  Services.prefs.setBoolPref(PREF_SHOW_BORDER, true);
  assert.equal(chipsOf(win)[0].hasAttribute("has-accent"), true);
});

test("the ring is a whole number of screen pixels at any scaling", async () => {
  const { mod, win } = await setup(SPACES());
  assert.equal(mod.borderWidth(1), "2px"); // 2 screen px
  assert.equal(mod.borderWidth(1.25), "2.4px"); // 3 screen px
  assert.equal(mod.borderWidth(1.5), "2px"); // 3 screen px
  assert.equal(mod.borderWidth(2), "2px"); // 4 screen px
  assert.equal(mod.borderWidth(0), "2px"); // nonsense ratio falls back to 1
  const row = win.document.getElementById("zen-space-chips");
  assert.equal(row.style.getPropertyValue("--zen-space-chips-border"), "2px");
});

const CSS = readFileSync(new URL("../src/zen-space-chips.uc.css", import.meta.url), "utf8");

test("the CSS draws the ring only with show-border on and a Space color", async () => {
  const block = CSS.split("/* accent-rules:start */")[1].split("/* accent-rules:end */")[0];
  const selector = block.slice(0, block.indexOf("{")).trim().replace(/::after$/, "");

  const { win, Services } = await setup(SPACES());
  const ringed = () =>
    [...win.document.querySelectorAll(selector)].map(c => c.getAttribute("zen-workspace-id"));
  assert.deepEqual(ringed(), ["{two}", "{one}"]);
  Services.prefs.setBoolPref(PREF_SHOW_BORDER, false);
  assert.deepEqual(ringed(), []);
});

test("with a ring, the fill is inset by the ring width so it can't show through", () => {
  const rule = CSS.match(/#zen-space-chips\[show-border\] \.zen-space-chip\[has-accent\]::before \{([^}]*)\}/);
  assert.ok(rule, "inset fill rule exists");
  assert.match(rule[1], /inset: var\(--zen-space-chips-border/);
  assert.match(rule[1], /border-radius: max\(0px, calc\(var\(--zen-space-chip-radius\) - var\(--zen-space-chips-border/);
});
