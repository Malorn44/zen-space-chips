// Dragging chips to reorder Spaces. Chips are laid out 90px wide, 100px apart:
// Work 0-90, Agent 100-190, Travel 200-290.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  chipIds,
  chipsOf,
  click,
  layoutChips,
  loadMod,
  makeWindow,
  mouse,
  settle,
} from "./harness.mjs";

async function setup() {
  const win = makeWindow();
  await loadMod({ windows: [win] });
  await settle();
  layoutChips(win);
  const doc = win.document;
  const row = doc.getElementById("zen-space-chips");
  const zen = win.gZenWorkspaces;
  const chip = uuid =>
    chipsOf(win).find(c => c.getAttribute("zen-workspace-id") === uuid);
  const press = (uuid, x, init) => mouse(win, chip(uuid), "mousedown", x, init);
  const moveTo = x => mouse(win, doc, "mousemove", x);
  const release = x => mouse(win, doc, "mouseup", x);
  return { win, doc, row, zen, chip, press, moveTo, release };
}

test("dragging a chip reorders the Spaces, and the drop is not a click", async () => {
  const { win, row, zen, chip, press, moveTo, release } = await setup();
  press("{work}", 45);
  moveTo(160); // right half of Agent
  assert.equal(row.getAttribute("reordering"), "true");
  assert.equal(chip("{work}").getAttribute("dragged"), "true");
  assert.deepEqual(chipIds(win), ["{agent}", "{work}", "{travel}"]);
  moveTo(260); // right half of Travel
  assert.deepEqual(chipIds(win), ["{agent}", "{travel}", "{work}"]);

  release(260);
  click(win, chip("{work}")); // the click Firefox sends after that mouseup
  await settle();

  assert.deepEqual(zen.reorderCalls, [["{work}", 2]]);
  assert.deepEqual(zen.switchCalls, [], "dropping did not switch Space");
  assert.deepEqual(chipIds(win), ["{agent}", "{travel}", "{work}"]);
  assert.equal(row.hasAttribute("reordering"), false);
  assert.equal(chip("{work}").hasAttribute("dragged"), false);

  click(win, chip("{travel}")); // later clicks work normally
  await settle();
  assert.deepEqual(zen.switchCalls, ["{travel}"]);
});

test("moving less than the threshold is still a click", async () => {
  const { win, row, zen, chip, press, moveTo, release } = await setup();
  press("{agent}", 145);
  moveTo(148);
  assert.equal(row.hasAttribute("reordering"), false);
  release(148);
  click(win, chip("{agent}"));
  await settle();
  assert.deepEqual(zen.reorderCalls, []);
  assert.deepEqual(zen.switchCalls, ["{agent}"]);
});

test("Esc cancels the drag and puts the chips back", async () => {
  const { win, doc, row, zen, press, moveTo, release } = await setup();
  press("{work}", 45);
  moveTo(260);
  doc.dispatchEvent(
    new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true })
  );
  assert.deepEqual(chipIds(win), ["{work}", "{agent}", "{travel}"]);
  assert.equal(row.hasAttribute("reordering"), false);
  release(260);
  await settle();
  assert.deepEqual(zen.reorderCalls, []);
});

test("leaving the window cancels the drag", async () => {
  const { win, zen, press, moveTo } = await setup();
  press("{work}", 45);
  moveTo(260);
  win.dispatchEvent(new win.Event("blur"));
  await settle();
  assert.deepEqual(chipIds(win), ["{work}", "{agent}", "{travel}"]);
  assert.deepEqual(zen.reorderCalls, []);
});

test("updates arriving mid-drag don't undo the live order", async () => {
  const { win, zen, press, moveTo, release } = await setup();
  press("{work}", 45);
  moveTo(260);
  zen.fireUIUpdate();
  win.dispatchEvent(new win.Event("activate"));
  assert.deepEqual(chipIds(win), ["{agent}", "{travel}", "{work}"]);
  release(260);
  await settle();
  assert.deepEqual(zen.reorderCalls, [["{work}", 2]]);
});

test("right-click and modifier-clicks never start a drag", async () => {
  const { win, row, press, moveTo, release } = await setup();
  for (const init of [{ button: 2 }, { shiftKey: true }, { ctrlKey: true }]) {
    press("{work}", 45, init);
    moveTo(260);
    assert.equal(row.hasAttribute("reordering"), false, JSON.stringify(init));
    release(260);
  }
  assert.deepEqual(chipIds(win), ["{work}", "{agent}", "{travel}"]);
});

test("without Zen's reorderWorkspace, chips still switch but don't drag", async () => {
  const { win, row, zen, chip, press, moveTo, release } = await setup();
  zen.reorderWorkspace = undefined;
  press("{work}", 45);
  moveTo(260);
  assert.equal(row.hasAttribute("reordering"), false);
  release(260);
  click(win, chip("{agent}"));
  await settle();
  assert.deepEqual(zen.switchCalls, ["{agent}"]);
});
