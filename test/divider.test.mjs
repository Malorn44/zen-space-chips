// divider=auto: [divider-needed] goes on the chips only when there's no room
// left between them and the visible bookmarks.
//
// Layout in px: the chips span 0-200. The divider's slot is the first 9px of
// #personal-bookmarks, before #PlacesToolbar.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  loadMod,
  makeWindow,
  placeAt,
  settle,
  sleep,
  waitFor,
} from "./harness.mjs";

// Long enough for a check to have run if one was going to (jsdom is slow).
const QUIET = 150;
const SLOT = 9;

async function setup() {
  const win = makeWindow();
  const { CUI } = await loadMod({ windows: [win] });
  await settle();
  const doc = win.document;
  const row = doc.getElementById("zen-space-chips");
  const bookmarks = doc.getElementById("personal-bookmarks");
  const places = doc.getElementById("PlacesToolbar");
  const itemsBox = doc.getElementById("PlacesToolbarItems");
  const list = row.querySelector(".zen-space-chips-list");
  const chevron = doc.getElementById("PlacesChevron");
  const needed = () => row.hasAttribute("divider-needed");
  placeAt(win, row, 0, 200);

  /**
   * Lays out the bookmarks' box from `left` to 900, #PlacesToolbar after the
   * slot, and one 100px bookmark per entry of `items` (their left edges).
   * Then triggers a check the way a real layout change would.
   */
  const layOut = async ({ left, items }) => {
    placeAt(win, bookmarks, left, 900 - left);
    placeAt(win, places, left + SLOT, 900 - left - SLOT);
    itemsBox.replaceChildren(
      ...items.map(x => {
        const el = doc.createElement("div");
        el.className = "bookmark-item";
        placeAt(win, el, x, 100);
        return el;
      })
    );
  };
  return { win, CUI, doc, row, bookmarks, itemsBox, list, chevron, needed, layOut };
}

test("an empty bookmarks area stretched up to the chips needs no divider", async () => {
  // Firefox stretches #personal-bookmarks up to the chips even when it's
  // empty. Only real content counts.
  const { needed, layOut } = await setup();
  await layOut({ left: 200, items: [] });
  await sleep(QUIET);
  assert.equal(needed(), false);
});

test("bookmarks right after the chips need it", async () => {
  const { needed, layOut } = await setup();
  await layOut({ left: 200, items: [200 + SLOT, 300 + SLOT] });
  await waitFor(needed);
});

test("room between the chips and the bookmarks: not needed", async () => {
  // A Flexible Space (112px) before the bookmarks.
  const { needed, layOut } = await setup();
  await layOut({ left: 312, items: [312 + SLOT, 412 + SLOT] });
  await sleep(QUIET);
  assert.equal(needed(), false);
});

test("bookmarks appearing in an empty area trigger a check", async () => {
  const { doc, itemsBox, needed, layOut } = await setup();
  await layOut({ left: 200, items: [] });
  await sleep(QUIET);
  assert.equal(needed(), false);
  // A bookmark gets added (or a Space switch rebuilds them). The box stays
  // the same size, so only the content change shows it.
  const item = doc.createElement("div");
  item.getBoundingClientRect = () => ({ left: 209, right: 309, width: 100 });
  itemsBox.append(item);
  await waitFor(needed);
});

test("overflowed bookmarks don't count; the chevron does", async () => {
  const { chevron, itemsBox, needed, layOut } = await setup();
  await layOut({ left: 200, items: [209] });
  await waitFor(needed);
  itemsBox.firstElementChild.style.visibility = "hidden"; // overflowed
  await waitFor(() => !needed());
  chevron.getBoundingClientRect = () => ({ left: 209, right: 233, width: 24 });
  chevron.removeAttribute("collapsed");
  await waitFor(needed);
});

test("\"Other Bookmarks\" counts only while shown", async () => {
  const { doc, needed, layOut } = await setup();
  await layOut({ left: 200, items: [] });
  const other = doc.createElement("div");
  other.id = "OtherBookmarks";
  other.getBoundingClientRect = () => ({ left: 209, right: 330, width: 121 });
  doc.getElementById("PlacesToolbar").append(other);
  await waitFor(needed);
  other.setAttribute("hidden", "true"); // "Show Other Bookmarks" unchecked
  await waitFor(() => !needed());
});

test("with room, bookmarks overflowing into the chevron need it", async () => {
  const { chevron, needed, layOut } = await setup();
  await layOut({ left: 312, items: [321] });
  await sleep(QUIET);
  assert.equal(needed(), false);
  chevron.getBoundingClientRect = () => ({ left: 876, right: 900, width: 24 });
  chevron.removeAttribute("collapsed"); // what Firefox does on overflow
  await waitFor(needed);
});

test("with room, chips that scroll need it, but only if there are bookmarks", async () => {
  const { win, list, needed, layOut } = await setup();
  Object.defineProperty(list, "scrollWidth", { value: 500, configurable: true });
  Object.defineProperty(list, "clientWidth", { value: 190, configurable: true });
  await layOut({ left: 312, items: [] });
  placeAt(win, list, 0, 190);
  await sleep(QUIET);
  assert.equal(needed(), false, "nothing to separate from");
  await layOut({ left: 312, items: [321] });
  await waitFor(needed);
});

test("never needed when the bookmarks are in another toolbar", async () => {
  const { win, CUI, needed, layOut } = await setup();
  await layOut({ left: 200, items: [209] });
  await waitFor(needed);
  CUI.moveNode(win, "personal-bookmarks", "nav-bar", 0);
  await waitFor(() => !needed());
});

test("bookmarks before the chips: measured from the chips' other side", async () => {
  const { win, CUI, row, needed, layOut } = await setup();
  CUI.moveNode(win, "personal-bookmarks", "PersonalToolbar", 0); // [bookmarks, chips]
  await layOut({ left: 0, items: [9] }); // content 9-109
  placeAt(win, row, 400, 200); // chips 400-600: room
  await sleep(QUIET);
  assert.equal(needed(), false);
  placeAt(win, row, 112, 200); // chips right after the content
  await waitFor(needed);
});

test("a window resize triggers a check", async () => {
  const { win, itemsBox, needed, layOut } = await setup();
  await layOut({ left: 312, items: [321] });
  await sleep(QUIET);
  // Moves without any observer noticing (position-only change).
  itemsBox.firstElementChild.getBoundingClientRect = () => ({
    left: 209,
    right: 309,
    width: 100,
  });
  win.dispatchEvent(new win.Event("resize"));
  await waitFor(needed);
});
