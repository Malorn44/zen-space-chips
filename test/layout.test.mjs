// Runs the divider selectors from src/zen-space-chips.uc.css against a few
// toolbar arrangements, so the CSS itself is what gets tested.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const XUL_NS =
  "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const CSS = readFileSync(
  new URL("../src/zen-space-chips.uc.css", import.meta.url),
  "utf8"
);

/** Selectors of the rule between `/* name:start *\/` and `/* name:end *\/`. */
function markedSelectors(name) {
  const block = CSS.split(`/* ${name}:start */`)[1].split(`/* ${name}:end */`)[0];
  const selectors = [];
  let depth = 0;
  let current = "";
  for (const ch of block.slice(0, block.indexOf("{"))) {
    depth += ch === "(" ? 1 : ch === ")" ? -1 : 0;
    if (ch === "," && depth === 0) {
      selectors.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  selectors.push(current.trim());
  return selectors.filter(Boolean);
}

const DIVIDER_SELECTORS = markedSelectors("divider-rules");
const IDLE_SELECTORS = markedSelectors("divider-idle-rules");

const ITEMS = {
  chips: ["toolbaritem", "zen-space-chips"],
  bookmarks: ["toolbaritem", "personal-bookmarks"],
  spring: ["toolbarspring", "customizableui-special-spring1"],
  import: ["toolbarbutton", "import-button"],
  urlbar: ["toolbaritem", "urlbar-container"],
};

/**
 * Builds toolbars, e.g. { PersonalToolbar: ["chips", "spring", "bookmarks"] }.
 * `needed` is what the JS would decide for divider=auto.
 */
function arrange(
  toolbars,
  { divider = "auto", hidden = false, needed = false } = {}
) {
  const doc = new JSDOM("<!DOCTYPE html><body></body>").window.document;
  for (const [toolbarId, items] of Object.entries(toolbars)) {
    const toolbar = doc.createElementNS(XUL_NS, "toolbar");
    toolbar.id = toolbarId;
    for (const item of items) {
      const [tag, id] = ITEMS[item];
      const el = doc.createElementNS(XUL_NS, tag);
      el.id = id;
      if (item === "chips") {
        el.setAttribute("divider", divider);
        el.toggleAttribute("hidden", hidden);
        el.toggleAttribute("divider-needed", needed);
      }
      toolbar.append(el);
    }
    doc.body.append(toolbar);
  }
  return doc;
}

function matching(doc, selectors) {
  const found = [];
  for (const selector of selectors) {
    const [, base, pseudo] = selector.match(/^(.*)(::before|::after)$/s);
    for (const el of doc.querySelectorAll(base)) {
      found.push(`${el.id}${pseudo}`);
    }
  }
  return found.sort();
}

/** Divider slots taking up space, e.g. ["personal-bookmarks::before"]. */
const slots = doc => matching(doc, DIVIDER_SELECTORS);

/** Dividers actually drawn: slots whose line isn't made transparent. */
function visible(doc) {
  const idle = new Set(matching(doc, IDLE_SELECTORS));
  return slots(doc).filter(slot => !idle.has(slot));
}

const BOTH = { PersonalToolbar: ["chips", "spring", "bookmarks"] };

test("the CSS markers are present and hold the expected rules", () => {
  assert.equal(DIVIDER_SELECTORS.length, 3);
  assert.equal(IDLE_SELECTORS.length, 2);
});

test("the CSS leaves the bookmarks' sizing to Firefox", () => {
  // Resizing them to fit their content moves "Other Bookmarks" away from the
  // end of the toolbar.
  const rulesAboutBookmarks = CSS.match(/[^{}]*#personal-bookmarks[^{}]*\{[^}]*\}/g) ?? [];
  for (const rule of rulesAboutBookmarks) {
    const body = rule.slice(rule.indexOf("{"));
    assert.doesNotMatch(body, /\b(flex|width|min-width|max-width)\s*:/, rule.trim());
  }
});

test("auto: the slot is reserved, but drawn only when the JS says it's needed", () => {
  const roomy = arrange(BOTH);
  assert.deepEqual(slots(roomy), ["personal-bookmarks::before"]);
  assert.deepEqual(visible(roomy), []);

  const tight = arrange(BOTH, { needed: true });
  assert.deepEqual(slots(tight), ["personal-bookmarks::before"]);
  assert.deepEqual(visible(tight), ["personal-bookmarks::before"]);
});

test("auto works for either order", () => {
  const doc = arrange(
    { PersonalToolbar: ["bookmarks", "chips"] },
    { needed: true }
  );
  assert.deepEqual(visible(doc), ["zen-space-chips::before"]);
  const roomy = arrange({ PersonalToolbar: ["bookmarks", "chips"] });
  assert.deepEqual(visible(roomy), []);
});

test("always: drawn whenever they share a toolbar, needed or not", () => {
  for (const needed of [false, true]) {
    assert.deepEqual(
      visible(arrange(BOTH, { divider: "always", needed })),
      ["personal-bookmarks::before"]
    );
  }
  assert.deepEqual(
    visible(arrange({ PersonalToolbar: ["bookmarks", "chips"] }, { divider: "always" })),
    ["zen-space-chips::before"]
  );
});

test("always adds one after the chips when the bookmarks are elsewhere", () => {
  const doc = arrange({ PersonalToolbar: ["chips"] }, { divider: "always" });
  assert.deepEqual(visible(doc), ["zen-space-chips::after"]);
  assert.deepEqual(visible(arrange({ PersonalToolbar: ["chips"] })), [], "not with auto");
});

test("never: no divider and no slot", () => {
  for (const needed of [false, true]) {
    const doc = arrange(BOTH, { divider: "never", needed });
    assert.deepEqual(slots(doc), []);
  }
});

test("no divider when either one is in another toolbar", () => {
  const chipsMoved = arrange(
    { "nav-bar": ["urlbar", "chips"], PersonalToolbar: ["spring", "bookmarks"] },
    { needed: true }
  );
  assert.deepEqual(slots(chipsMoved), []);
  const bookmarksMoved = arrange(
    { PersonalToolbar: ["chips"], "nav-bar": ["urlbar", "bookmarks"] },
    { needed: true }
  );
  assert.deepEqual(slots(bookmarksMoved), []);
});

test("hidden chips (private or unsynced windows) draw no divider", () => {
  for (const divider of ["auto", "always"]) {
    const doc = arrange(BOTH, { divider, hidden: true, needed: true });
    assert.deepEqual(slots(doc), [], divider);
  }
});
