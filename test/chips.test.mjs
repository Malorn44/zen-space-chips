import { test } from "node:test";
import assert from "node:assert/strict";

import {
  STARTUP_TOPIC,
  activeIds,
  chipsOf,
  click,
  loadMod,
  makeWindow,
  settle,
} from "./harness.mjs";

const PREF_PLACED = "uc.space-chips.initial-placement-done";
const PREF_MODE = "uc.space-chips.mode";
const PREF_DIVIDER = "uc.space-chips.divider";

const toolbarIds = win =>
  [...win.document.getElementById("PersonalToolbar").children].map(el => el.id);

/** Loads the mod with one ready window and returns everything a test needs. */
async function setup(windowOptions = {}, loadOptions = {}) {
  const win = makeWindow(windowOptions);
  const loaded = await loadMod({ windows: [win], ...loadOptions });
  await settle();
  return { win, zen: win.gZenWorkspaces, ...loaded };
}

test("waits for a window to finish delayed startup before touching CustomizableUI", async () => {
  const win = makeWindow({ delayedStartupFinished: false });
  const { CUI, Services } = await loadMod({ windows: [win] });
  assert.equal(CUI.widgets.size, 0);

  win.gBrowserInit.delayedStartupFinished = true;
  Services.obs.notifyObservers(win, STARTUP_TOPIC);
  await settle();

  assert.equal(CUI.widgets.size, 1);
  assert.equal(chipsOf(win).length, 3);
  assert.equal(Services.obs.count(STARTUP_TOPIC), 0, "observers cleaned up");
});

test("first run places only the chips, at the left edge of the bookmarks toolbar", async () => {
  const { win, CUI, Services } = await setup();
  assert.deepEqual(CUI.addCalls, [["zen-space-chips", "PersonalToolbar", 0]]);
  assert.deepEqual(toolbarIds(win), [
    "zen-space-chips",
    "import-button",
    "personal-bookmarks",
  ]);
  assert.equal(Services.prefs.getBoolPref(PREF_PLACED, false), true);
});

test("later runs keep the user's placement, including removal", async () => {
  const { CUI } = await setup({}, { prefs: { [PREF_PLACED]: true } });
  assert.deepEqual(CUI.addCalls, []);
  assert.equal(CUI.getPlacementOfWidget("zen-space-chips"), null);
});

test("both prefs are listed in about:config with their defaults", async () => {
  const { Services } = await setup();
  const defaults = Services.prefs.getDefaultBranch("");
  assert.equal(defaults.getStringPref(PREF_DIVIDER), "auto");
  assert.equal(defaults.getStringPref(PREF_MODE), "icon+name");
  // Starting up doesn't write user values.
  assert.equal(Services.prefs.prefHasUserValue(PREF_DIVIDER), false);
  assert.equal(Services.prefs.prefHasUserValue(PREF_MODE), false);
});

test("renders one chip per Space and mirrors the divider pref", async () => {
  const { win, Services } = await setup();
  const row = win.document.getElementById("zen-space-chips");
  assert.deepEqual(
    [...row.children].map(el => el.className),
    ["zen-space-chips-list"],
    "the divider is drawn by CSS, not an element"
  );
  assert.equal(row.getAttribute("divider"), "auto");
  for (const value of ["always", "never", "auto"]) {
    Services.prefs.setStringPref(PREF_DIVIDER, value);
    assert.equal(row.getAttribute("divider"), value);
  }
  Services.prefs.setStringPref(PREF_DIVIDER, "bogus");
  assert.equal(row.getAttribute("divider"), "auto");

  const [work, agent, travel] = chipsOf(win);
  assert.deepEqual(
    chipsOf(win).map(c => c.getAttribute("tooltiptext")),
    ["Work", "Agent", "travel"]
  );
  // SVG icon -> <img>, emoji -> text, no icon -> Zen's first-letter fallback.
  assert.equal(work.firstChild.localName, "img");
  assert.match(work.firstChild.getAttribute("src"), /briefcase\.svg$/);
  assert.equal(agent.firstChild.textContent, "🤖");
  assert.equal(travel.firstChild.textContent, "T");
  // Hooks Zen's right-click Space menu.
  assert.equal(work.getAttribute("context"), "zenWorkspaceMoreActions");
  assert.equal(work.getAttribute("zen-workspace-id"), "{work}");
  assert.deepEqual(activeIds(win), ["{work}"]);
});

test("clicking a chip switches Space and highlights it immediately", async () => {
  const { win, zen } = await setup();
  const agent = chipsOf(win)[1];
  click(win, agent);
  // Optimistic highlight before Zen's switch completes.
  assert.equal(agent.getAttribute("active"), "true");
  assert.equal(agent.getAttribute("aria-pressed"), "true");
  await settle();
  assert.deepEqual(zen.switchCalls, ["{agent}"]);
  assert.deepEqual(activeIds(win), ["{agent}"]);
});

test("follows switches made elsewhere (sidebar, shortcut, swipe)", async () => {
  const { win, zen } = await setup();
  await zen.changeWorkspaceWithID("{travel}");
  assert.deepEqual(activeIds(win), ["{travel}"]);
});

test("updates when Spaces are added, reordered, renamed or removed", async () => {
  const { win, zen } = await setup();

  zen._workspaceCache.push({ uuid: "{new}", name: "New", icon: "" });
  zen.fireUIUpdate();
  assert.equal(chipsOf(win).length, 4);

  zen._workspaceCache.reverse();
  zen.fireUIUpdate();
  assert.equal(chipsOf(win)[0].getAttribute("zen-workspace-id"), "{new}");

  zen._workspaceCache.find(s => s.uuid === "{work}").name = "Office";
  zen.fireDataChanged();
  assert.ok(chipsOf(win).some(c => c.getAttribute("tooltiptext") === "Office"));

  zen._workspaceCache = zen._workspaceCache.filter(s => s.uuid !== "{new}");
  zen.fireUIUpdate();
  assert.equal(chipsOf(win).length, 3);
});

test("a rename made in another window shows up when this window is focused", async () => {
  const { win, zen } = await setup();
  zen._workspaceCache[0] = { ...zen._workspaceCache[0], name: "Renamed" };
  win.dispatchEvent(new win.Event("activate"));
  assert.equal(chipsOf(win)[0].getAttribute("tooltiptext"), "Renamed");
});

test("chips show icon and name by default; the pref switches modes", async () => {
  const { win, Services } = await setup();
  const labels = () =>
    chipsOf(win).map(c =>
      [...c.children].map(el => el.className).join(" ")
    );
  assert.deepEqual(labels()[0], "zen-space-chip-icon zen-space-chip-name");
  assert.deepEqual(
    chipsOf(win).map(c => c.lastChild.textContent),
    ["Work", "Agent", "travel"]
  );

  Services.prefs.setStringPref(PREF_MODE, "icon");
  assert.deepEqual(labels()[0], "zen-space-chip-icon");

  Services.prefs.setStringPref(PREF_MODE, "name");
  assert.deepEqual(labels()[0], "zen-space-chip-name");

  Services.prefs.setStringPref(PREF_MODE, "bogus");
  assert.deepEqual(labels()[0], "zen-space-chip-icon zen-space-chip-name");
});

test("rapid clicks never flash back to a Space Zen passes through", async () => {
  const { win, zen } = await setup();
  zen.switchDelayMs = 20; // stand-in for Zen's switch animation
  // Registered after the mod's listener, so it samples right after each render.
  const highlights = [];
  zen.addChangeListeners(() => highlights.push(activeIds(win).join()));

  const [, agent, travel] = chipsOf(win);
  click(win, agent);
  await new Promise(resolve => setTimeout(resolve, 5)); // Agent switch in flight
  click(win, travel);
  assert.deepEqual(activeIds(win), ["{travel}"]);
  await new Promise(resolve => setTimeout(resolve, 120));

  // Zen finished Agent first, then Travel; the highlight stayed on Travel.
  assert.deepEqual(zen.switchCalls, ["{agent}", "{travel}"]);
  assert.deepEqual(highlights, ["{travel}", "{travel}"]);
  assert.deepEqual(activeIds(win), ["{travel}"]);
});

test("a re-render never replaces the chip being pressed", async () => {
  const { win, zen } = await setup();
  const agent = chipsOf(win)[1];
  // Renders that can land between mousedown and mouseup:
  zen.fireUIUpdate();
  win.dispatchEvent(new win.Event("activate"));
  await zen.changeWorkspaceWithID("{travel}");
  zen._workspaceCache[1] = { ...zen._workspaceCache[1], name: "Bots" };
  zen.fireDataChanged();

  assert.equal(chipsOf(win)[1], agent, "same element, so the click lands");
  assert.equal(agent.getAttribute("tooltiptext"), "Bots");
  click(win, agent);
  await settle();
  assert.deepEqual(zen.switchCalls.at(-1), "{agent}");
});

test("reordering moves the existing chips instead of rebuilding them", async () => {
  const { win, zen } = await setup();
  const before = chipsOf(win);
  zen._workspaceCache.reverse();
  zen.fireUIUpdate();
  assert.deepEqual(chipsOf(win), [...before].reverse());
});

test("a failed switch drops the pending highlight", async t => {
  t.mock.method(console, "error", () => {});
  const { win, zen } = await setup();
  zen.changeWorkspaceWithID = async () => {
    throw new Error("Zen refused");
  };
  click(win, chipsOf(win)[2]);
  await settle();
  assert.deepEqual(activeIds(win), ["{work}"]);
});

test("multiple windows each highlight their own active Space", async () => {
  const a = makeWindow({ active: "{work}" });
  const b = makeWindow({ active: "{travel}" });
  await loadMod({ windows: [a, b] });
  await settle();
  assert.deepEqual(activeIds(a), ["{work}"]);
  assert.deepEqual(activeIds(b), ["{travel}"]);
});

test("a window opened later waits for its own startup before rendering", async () => {
  const { CUI, Services } = await setup();
  const late = makeWindow({ delayedStartupFinished: false });
  CUI.registerWindow(late);
  await settle();
  assert.equal(chipsOf(late).length, 0);

  late.gBrowserInit.delayedStartupFinished = true;
  Services.obs.notifyObservers(late, STARTUP_TOPIC);
  await settle();
  assert.equal(chipsOf(late).length, 3);
});

test("private windows get no widget at all", async () => {
  const normal = makeWindow();
  const priv = makeWindow({ isPrivate: true });
  await loadMod({ windows: [normal, priv] });
  await settle();
  assert.equal(chipsOf(normal).length, 3);
  assert.equal(priv.document.getElementById("zen-space-chips"), null);
});

test("hides itself in windows where Zen disables Spaces", async () => {
  const { win, zen } = await setup();
  zen.privateWindowOrDisabled = true; // e.g. an unsynced window
  zen.fireUIUpdate();
  const row = win.document.getElementById("zen-space-chips");
  assert.equal(row.hasAttribute("hidden"), true);
  assert.equal(chipsOf(win).length, 0);
});

test("if Zen's API is missing, hides the row and warns once without throwing", async t => {
  const warn = t.mock.method(console, "warn", () => {});
  const a = makeWindow({ zen: false });
  const b = makeWindow({ zen: false });
  await loadMod({ windows: [a, b] });
  await settle();
  for (const win of [a, b]) {
    assert.equal(
      win.document.getElementById("zen-space-chips").hasAttribute("hidden"),
      true
    );
  }
  assert.equal(warn.mock.callCount(), 1);
});

test("a render error never breaks Zen's own switch sequence", async t => {
  const error = t.mock.method(console, "error", () => {});
  const { zen } = await setup();
  zen.getWorkspaces = () => {
    throw new Error("boom");
  };
  await zen.changeWorkspaceWithID("{agent}");
  assert.equal(zen.listenerError, undefined, "no exception reached Zen");
  assert.equal(zen.stepsAfterListeners, 1, "Zen finished its switch");
  assert.ok(error.mock.callCount() >= 1);
});

test("closing a window removes its Zen change listener", async () => {
  const { win, zen } = await setup();
  assert.equal(zen.listenerCount, 1);
  win.dispatchEvent(new win.Event("unload"));
  assert.equal(zen.listenerCount, 0);
});

test("re-adding the widget refreshes the cached node's chips", async () => {
  const { win, zen, CUI } = await setup();
  const row = win.document.getElementById("zen-space-chips");
  CUI.removeWidgetFromArea("zen-space-chips");

  // Spaces change while the widget is out of the toolbar.
  zen._workspaceCache = zen._workspaceCache.filter(s => s.uuid !== "{travel}");
  zen._workspaceCache[0] = { ...zen._workspaceCache[0], name: "Office" };
  zen.fireUIUpdate();

  CUI.addWidgetToArea("zen-space-chips", "PersonalToolbar", 0);
  assert.equal(win.document.getElementById("zen-space-chips"), row, "node reused");
  assert.equal(CUI.buildCount, 1, "onBuild not called again");
  assert.deepEqual(
    chipsOf(win).map(c => c.getAttribute("tooltiptext")),
    ["Office", "Agent"]
  );
});

test("finishing Customize Toolbar re-renders the chips", async () => {
  const { win, zen, CUI } = await setup();
  zen._workspaceCache[1] = { ...zen._workspaceCache[1], name: "Bots" };
  CUI.endCustomizing(win);
  assert.equal(chipsOf(win)[1].getAttribute("tooltiptext"), "Bots");
});

test("registers immediately when loaded after startup (e.g. by Sine)", async () => {
  const { CUI } = await setup();
  assert.equal(CUI.widgets.size, 1);
});
