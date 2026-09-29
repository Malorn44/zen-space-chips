// ==UserScript==
// @name           Zen Space Chips
// @description    Clickable chips on the bookmarks toolbar, one per Zen Space
// @version        0.1.0
// @author         Malorn44
// ==/UserScript==

// fx-autoconfig imports .sys.mjs files once per session, before any browser
// window exists. Nothing here depends on the loader, so the same file should
// also work under Sine.
//
// Tested with Zen 1.22.3b (Firefox 156). Everything that touches Zen internals
// goes through the `Zen` object below.

export const WIDGET_ID = "zen-space-chips";
export const PREF_MODE = "uc.space-chips.mode";
export const PREF_DIVIDER = "uc.space-chips.divider";
export const PREF_SHOW_BORDER = "uc.space-chips.show-border";
export const PREF_PLACED = "uc.space-chips.initial-placement-done";
export const MODES = ["icon", "icon+name", "name"];
// auto: only when the chips and the bookmarks have no room between them.
// always: whenever they share a toolbar, and after the chips otherwise.
export const DIVIDERS = ["auto", "always", "never"];
// Ring width in screen pixels.
export const BORDER_DEVICE_PX = 2;

const DEFAULT_MODE = "icon+name";
const DEFAULT_DIVIDER = "auto";
const LOG_PREFIX = "[space-chips]";
const STARTUP_TOPIC = "browser-delayed-startup-finished";
const CUSTOMIZABLE_UI_URLS = [
  "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs",
  // Older Firefox builds.
  "resource:///modules/CustomizableUI.sys.mjs",
];

// Default-branch values make the prefs show up in about:config before anyone
// sets them. They aren't saved, so this runs on every start.
{
  const defaults = Services.prefs.getDefaultBranch("");
  defaults.setStringPref(PREF_MODE, DEFAULT_MODE);
  defaults.setStringPref(PREF_DIVIDER, DEFAULT_DIVIDER);
  defaults.setBoolPref(PREF_SHOW_BORDER, true);
}

/** The only code that touches Zen internals. */
export const Zen = {
  available(win) {
    const ws = win.gZenWorkspaces;
    return (
      !!ws &&
      typeof ws.getWorkspaces === "function" &&
      typeof ws.changeWorkspaceWithID === "function" &&
      typeof ws.addChangeListeners === "function" &&
      typeof ws.removeChangeListeners === "function" &&
      "activeWorkspace" in ws
    );
  },
  // Spaces are off in private windows, popups and unsynced windows.
  disabled: win => !!win.gZenWorkspaces.privateWindowOrDisabled,
  whenReady: win => Promise.resolve(win.gZenWorkspaces.promiseInitialized),
  spaces: win => win.gZenWorkspaces.getWorkspaces() ?? [],
  active: win => win.gZenWorkspaces.activeWorkspace,
  switchTo: (win, uuid) => win.gZenWorkspaces.changeWorkspaceWithID(uuid),
  onSwitch: (win, fn) => win.gZenWorkspaces.addChangeListeners(fn),
  offSwitch: (win, fn) => win.gZenWorkspaces.removeChangeListeners(fn),
  // Optional. Without it the chips still work, they just can't be dragged.
  canReorder: win =>
    typeof win.gZenWorkspaces?.reorderWorkspace === "function",
  // Same call Zen's sidebar strip makes; Zen syncs the order to every window.
  reorder: (win, uuid, index) =>
    win.gZenWorkspaces.reorderWorkspace(uuid, index),
  // The CSS background Zen paints on the toolbar for this Space, or "" if
  // there's none (Zen's default theme) or the theme picker's API is missing.
  spaceBackground(win, space) {
    const picker = win.gZenThemePicker;
    if (
      !space.theme?.gradientColors?.length ||
      typeof picker?.getGradientForWorkspace !== "function"
    ) {
      return "";
    }
    return picker.getGradientForWorkspace(space).toolbarGradient ?? "";
  },
  // The color Zen shows through the transparent parts of those gradients.
  toolbarBase: win => win.gZenThemePicker?.getToolbarModifiedBase?.() ?? "",
  forgetGradient(win, uuid) {
    win.gZenThemePicker?.invalidateGradientCache?.(uuid);
  },
  // An emoji, an SVG URL, or Zen's first-letter fallback.
  icon(win, space) {
    const ws = win.gZenWorkspaces;
    if (typeof ws.getWorkspaceIcon === "function") {
      try {
        return ws.getWorkspaceIcon(space) ?? "";
      } catch {}
    }
    return space.icon || Array.from(space.name ?? "")[0]?.toUpperCase() || "";
  },
  // Window events Zen fires when the Space list changes.
  events: [
    "ZenWorkspacesUIUpdate", // added, removed, reordered
    "ZenWorkspaceDataChanged", // renamed or new icon (this window only)
  ],
};

// ---------------------------------------------------------------------------
// Rendering

export function readMode() {
  const mode = Services.prefs.getStringPref(PREF_MODE, DEFAULT_MODE);
  return MODES.includes(mode) ? mode : DEFAULT_MODE;
}

export function readDivider() {
  const divider = Services.prefs.getStringPref(PREF_DIVIDER, DEFAULT_DIVIDER);
  return DIVIDERS.includes(divider) ? divider : DEFAULT_DIVIDER;
}

export function readShowBorder() {
  return Services.prefs.getBoolPref(PREF_SHOW_BORDER, true);
}

/**
 * The ring width in CSS px that covers a whole number of screen pixels. A
 * fractional width gets its inner edges rounded unevenly, so one side of the
 * ring comes out thinner than the others.
 */
export function borderWidth(devicePixelRatio = 1) {
  const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const px = Math.max(1, Math.round(BORDER_DEVICE_PX * ratio)) / ratio;
  return `${Math.round(px * 1000) / 1000}px`;
}

// ---------------------------------------------------------------------------
// Accent border
//
// Each chip gets a ring painted with the background Zen gives that Space's
// toolbar, so the colors sit in the same layout and proportions as in Zen.
// Each color's lightness is pulled toward a readable level and its hue and
// saturation stay put. Changing lightness in HSL keeps the hue; scaling RGB
// channels would clip them at 255 and shift it. There's a version for a dark
// toolbar and one for a light toolbar, and the CSS picks between them.
//
// Zen caches each Space's background, so the cache entry is dropped whenever
// a Space's theme changes or light/dark mode flips.

// Same math as Zen's rgbToHsl(), hueToRgb() and hslToRgb().
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) {
      h = ((g - b) / d) % 6;
    } else if (max === g) {
      h = (b - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
  }
  const l = (min + max) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [h * 60, s, l];
}

function hueToRgb(p, q, t) {
  if (t < 0) {
    t += 1;
  }
  if (t > 1) {
    t -= 1;
  }
  if (t < 1 / 6) {
    return p + (q - p) * 6 * t;
  }
  if (t < 1 / 2) {
    return q;
  }
  if (t < 2 / 3) {
    return p + (q - p) * (2 / 3 - t) * 6;
  }
  return p;
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [h + 1 / 3, h, h - 1 / 3].map(t => Math.round(hueToRgb(p, q, t) * 255));
}

/**
 * One color with its lightness pulled toward what reads well on a dark or
 * light toolbar. Uses the lightness part of Zen's getAccentColorForUI();
 * hue and saturation don't change.
 */
export function liftColor([r, g, b], dark) {
  const [h, s, l] = rgbToHsl(r, g, b);
  const target = dark ? 0.62 : 0.42;
  return hslToRgb(h / 360, Math.min(1, s), l * 0.4 + target * 0.6);
}

const CSS_COLOR = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)|#([0-9a-f]{6})\b/gi;

/** Every rgb(), rgba() and #rrggbb color in a CSS value, lifted. */
export function liftColors(css, dark) {
  return css.replace(CSS_COLOR, (_match, r, g, b, alpha, hex) => {
    const rgb = hex
      ? [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16))
      : [r, g, b].map(Number);
    const [nr, ng, nb] = liftColor(rgb, dark);
    return `rgba(${nr}, ${ng}, ${nb}, ${alpha ?? 1})`;
  });
}

// window -> Map(Space uuid -> theme JSON seen at the last render)
const seenThemes = new WeakMap();

/** The ring's CSS backgrounds for a dark and a light toolbar, or null. */
function accentFor(win, space) {
  const theme = JSON.stringify(space.theme ?? null);
  let seen = seenThemes.get(win);
  if (!seen) {
    seen = new Map();
    seenThemes.set(win, seen);
  }
  if (seen.has(space.uuid) && seen.get(space.uuid) !== theme) {
    Zen.forgetGradient(win, space.uuid);
  }
  seen.set(space.uuid, theme);
  let background;
  try {
    background = Zen.spaceBackground(win, space);
  } catch (e) {
    console.error(LOG_PREFIX, "couldn't get the Space's colors", e);
    return null;
  }
  if (!background) {
    return null;
  }
  // A one-color theme comes back as a plain color, which has to be the only
  // background layer. Gradients can have transparent areas where Zen shows
  // the toolbar base color, so that goes underneath (not lifted).
  const base = background.includes("gradient(") ? Zen.toolbarBase(win) : "";
  const withBase = css => (base ? `${css}, ${base}` : css);
  return {
    dark: withBase(liftColors(background, true)),
    light: withBase(liftColors(background, false)),
  };
}

// Zen caches each Space's colors for the current light/dark mode.
function onThemeChange() {
  for (const win of Services.wm.getEnumerator("navigator:browser")) {
    if (!ready.has(win)) {
      continue;
    }
    for (const space of Zen.spaces(win)) {
      Zen.forgetGradient(win, space.uuid);
    }
    render(win);
  }
}

function isImageIcon(icon) {
  return icon.endsWith(".svg") || icon.startsWith("data:image/");
}

function buildIcon(doc, icon) {
  if (isImageIcon(icon)) {
    const img = doc.createElement("img");
    img.className = "zen-space-chip-icon";
    img.setAttribute("src", icon);
    img.setAttribute("alt", "");
    // A native image drag would eat the mouse events used for reordering.
    img.setAttribute("draggable", "false");
    return img;
  }
  const glyph = doc.createXULElement("label");
  glyph.className = "zen-space-chip-icon";
  if (icon) {
    glyph.textContent = icon;
  } else {
    glyph.setAttribute("no-icon", "true");
  }
  return glyph;
}

function setActive(chip, isActive) {
  if (isActive) {
    chip.setAttribute("active", "true");
  } else {
    chip.removeAttribute("active");
  }
  chip.setAttribute("aria-pressed", String(isActive));
}

// What each chip currently shows, so unchanged chips can be skipped.
const chipContent = new WeakMap();

function updateChip(doc, chip, space, { mode, icon, accent = null }) {
  const name = space.name ?? "";
  chip.setAttribute("tooltiptext", name);
  chip.setAttribute("aria-label", name);
  for (const scheme of ["dark", "light"]) {
    if (accent) {
      chip.style.setProperty(`--space-accent-${scheme}`, accent[scheme]);
    } else {
      chip.style.removeProperty(`--space-accent-${scheme}`);
    }
  }
  chip.toggleAttribute("has-accent", !!accent);
  const content = JSON.stringify([mode, icon, name]);
  if (chipContent.get(chip) === content) {
    return;
  }
  chipContent.set(chip, content);
  const parts = [];
  if (mode !== "name") {
    parts.push(buildIcon(doc, icon));
  }
  if (mode !== "icon") {
    const label = doc.createXULElement("label");
    label.className = "zen-space-chip-name";
    label.textContent = name;
    parts.push(label);
  }
  chip.replaceChildren(...parts);
}

export function buildChip(doc, space, { isActive, ...options }) {
  const chip = doc.createXULElement("toolbarbutton");
  chip.className = "zen-space-chip";
  chip.setAttribute("zen-workspace-id", space.uuid);
  // Zen's Space context menu looks for closest("toolbarbutton")[zen-workspace-id].
  chip.setAttribute("context", "zenWorkspaceMoreActions");
  setActive(chip, isActive);
  updateChip(doc, chip, space, options);
  return chip;
}

/**
 * Syncs the chips in `row` with the window's Spaces. Chips are updated in
 * place by Space id, because replacing one between mousedown and mouseup
 * would lose the click.
 */
export function fillRow(win, row) {
  const list = row.querySelector(".zen-space-chips-list");
  if (!Zen.available(win) || Zen.disabled(win)) {
    row.toggleAttribute("hidden", true);
    list.replaceChildren();
    return;
  }
  row.toggleAttribute("hidden", false);
  const doc = win.document;
  const mode = readMode();
  // During a click-triggered switch, keep showing the clicked Space. Zen works
  // through any queued switches first, which would make the highlight jump.
  const shownActive = pendingSwitches.get(win)?.uuid ?? Zen.active(win);
  row.setAttribute("chips-mode", mode);
  // The CSS draws the divider; this passes the setting along.
  row.setAttribute("divider", readDivider());

  const stale = new Map();
  for (const chip of list.children) {
    stale.set(chip.getAttribute("zen-workspace-id"), chip);
  }
  const showBorder = readShowBorder();
  row.toggleAttribute("show-border", showBorder);
  row.style.setProperty("--zen-space-chips-border", borderWidth(win.devicePixelRatio));
  let cursor = list.firstElementChild;
  for (const space of Zen.spaces(win)) {
    const options = {
      mode,
      icon: Zen.icon(win, space),
      accent: showBorder ? accentFor(win, space) : null,
    };
    let chip = stale.get(space.uuid);
    stale.delete(space.uuid);
    if (chip) {
      updateChip(doc, chip, space, options);
    } else {
      chip = buildChip(doc, space, { ...options, isActive: false });
    }
    setActive(chip, space.uuid === shownActive);
    if (chip === cursor) {
      cursor = cursor.nextElementSibling;
    } else {
      list.insertBefore(chip, cursor);
    }
  }
  for (const chip of stale.values()) {
    chip.remove();
  }

  if (row.getAttribute("shown-active") !== shownActive) {
    row.setAttribute("shown-active", shownActive ?? "");
    list.querySelector('.zen-space-chip[active="true"]')?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
    });
  }
}

// This also runs as a Zen change listener, in the middle of Zen's own switch.
// If it threw there, the rest of the switch would be skipped, so it never throws.
function render(win) {
  try {
    const row = win.document.getElementById(WIDGET_ID);
    // Mid-drag, the order on screen is the user's. The drop re-renders.
    if (row && !row.hasAttribute("reordering")) {
      fillRow(win, row);
    }
  } catch (e) {
    console.error(LOG_PREFIX, "render failed", e);
  }
}

function renderAllWindows() {
  for (const win of Services.wm.getEnumerator("navigator:browser")) {
    if (ready.has(win)) {
      render(win);
    }
  }
}

// ---------------------------------------------------------------------------
// divider=auto
//
// Empty space already separates the chips from the bookmarks, so the divider
// only shows once that space is gone: they touch, the bookmarks overflow into
// the chevron, or the chips start scrolling. CSS can't measure this, so the
// check below sets [divider-needed] on the chips. The CSS always reserves the
// divider's slot and only changes its color, so toggling the attribute never
// moves anything.
//
// The gap is measured to the bookmarks that are actually visible, not to
// #personal-bookmarks. Firefox stretches that box over all the free space up
// to the chips, even when it's empty.

export const TOUCH_PX = 8;

/** Horizontal gap between two boxes (negative if they overlap). */
function gapBetween(a, b) {
  return Math.max(b.left - a.right, a.left - b.right);
}

/**
 * Horizontal extent of the visible bookmark content, or null if there is
 * none. Counts bookmarks that aren't overflowed (Firefox hides those with
 * visibility: hidden), plus "Other Bookmarks" and the chevron when shown.
 */
export function bookmarksContentRect(doc) {
  const parts = [
    ...(doc.getElementById("PlacesToolbarItems")?.children ?? []),
    doc.getElementById("OtherBookmarks"),
    doc.getElementById("PlacesChevron"),
  ];
  let left = Infinity;
  let right = -Infinity;
  for (const el of parts) {
    if (
      !el ||
      el.hasAttribute("hidden") ||
      el.getAttribute("collapsed") === "true" ||
      el.style?.visibility === "hidden"
    ) {
      continue;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width > 0) {
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.right);
    }
  }
  return left < right ? { left, right } : null;
}

export function isDividerNeeded(win) {
  const doc = win.document;
  const row = doc.getElementById(WIDGET_ID);
  const bookmarks = doc.getElementById("personal-bookmarks");
  if (!row || !bookmarks || bookmarks.parentNode !== row.parentNode) {
    return false;
  }
  const content = bookmarksContentRect(doc);
  if (!content) {
    return false; // nothing to separate the chips from
  }
  const chips = row.getBoundingClientRect();
  let gap = gapBetween(chips, content);
  // When the chips come first, the divider's own slot sits inside the
  // bookmarks' box ahead of #PlacesToolbar. Don't count it as free space.
  const chipsFirst = row.compareDocumentPosition(bookmarks) & 4; // FOLLOWING
  const places = doc.getElementById("PlacesToolbar");
  if (chipsFirst && places) {
    const box = bookmarks.getBoundingClientRect();
    const inner = places.getBoundingClientRect();
    gap -= Math.max(0, inner.left - box.left, box.right - inner.right);
  }
  if (gap < TOUCH_PX) {
    return true;
  }
  const chevron = doc.getElementById("PlacesChevron");
  if (chevron && chevron.getAttribute("collapsed") !== "true") {
    return true;
  }
  const list = row.querySelector(".zen-space-chips-list");
  return !!list && list.scrollWidth > list.clientWidth + 1;
}

const dividerCheckPending = new WeakSet();

function scheduleDividerCheck(win) {
  if (dividerCheckPending.has(win)) {
    return;
  }
  dividerCheckPending.add(win);
  win.requestAnimationFrame(() => {
    dividerCheckPending.delete(win);
    try {
      const row = win.document.getElementById(WIDGET_ID);
      row?.toggleAttribute("divider-needed", isDividerNeeded(win));
    } catch (e) {
      console.error(LOG_PREFIX, "divider check failed", e);
    }
  });
}

function watchDividerNeed(win) {
  const doc = win.document;
  const check = () => scheduleDividerCheck(win);
  const row = doc.getElementById(WIDGET_ID);
  const resizeObserver = new win.ResizeObserver(check);
  for (const el of [
    row,
    row?.querySelector(".zen-space-chips-list"),
    doc.getElementById("personal-bookmarks"),
  ]) {
    if (el) {
      resizeObserver.observe(el);
    }
  }
  // Bookmarks can be added, rebuilt, overflowed or given icons without the
  // box changing size, so watch the content too.
  const places = doc.getElementById("PlacesToolbar");
  const mutationObserver = new win.MutationObserver(check);
  if (places) {
    mutationObserver.observe(places, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "hidden", "collapsed", "image", "label"],
    });
  }
  win.addEventListener("resize", check);
  win.addEventListener(
    "unload",
    () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    },
    { once: true }
  );
  check();
}

// ---------------------------------------------------------------------------
// Per-window setup

const attached = new WeakSet();
const ready = new WeakSet();
const pendingSwitches = new WeakMap(); // window -> { uuid, seq } of the last click
let switchSeq = 0;
let warnedUnavailable = false;

function whenDelayedStartup(win) {
  if (win.gBrowserInit?.delayedStartupFinished) {
    return Promise.resolve(true);
  }
  return new Promise(resolve => {
    const observer = subject => {
      if (subject === win) {
        done(true);
      }
    };
    const onUnload = () => done(false);
    const done = result => {
      Services.obs.removeObserver(observer, STARTUP_TOPIC);
      win.removeEventListener("unload", onUnload);
      resolve(result);
    };
    Services.obs.addObserver(observer, STARTUP_TOPIC);
    win.addEventListener("unload", onUnload, { once: true });
  });
}

async function attach(win) {
  if (attached.has(win)) {
    return;
  }
  attached.add(win);
  if (!(await whenDelayedStartup(win))) {
    return;
  }
  if (!Zen.available(win)) {
    if (!warnedUnavailable) {
      warnedUnavailable = true;
      console.warn(
        LOG_PREFIX,
        "Zen's Spaces API was not found (Zen update?). Chips are disabled."
      );
    }
    render(win); // hides the row
    return;
  }
  await Zen.whenReady(win);
  if (win.closed) {
    return;
  }
  ready.add(win);

  const rerender = () => render(win);
  Zen.onSwitch(win, rerender);
  // "activate" picks up renames made in another window, which fire nothing here.
  for (const type of [...Zen.events, "activate"]) {
    win.addEventListener(type, rerender);
  }
  win.addEventListener(
    "unload",
    () => {
      try {
        Zen.offSwitch(win, rerender);
      } catch {}
    },
    { once: true }
  );
  rerender();
  try {
    watchDividerNeed(win);
    watchPixelRatio(win);
  } catch (e) {
    console.error(LOG_PREFIX, "watcher setup failed", e);
  }
}

// Moving the window to a screen with different scaling changes how wide the
// ring has to be to stay on whole screen pixels.
function watchPixelRatio(win) {
  if (typeof win.matchMedia !== "function") {
    return;
  }
  const query = win.matchMedia(`(resolution: ${win.devicePixelRatio}dppx)`);
  query.addEventListener(
    "change",
    () => {
      render(win);
      watchPixelRatio(win);
    },
    { once: true }
  );
}

function onRowCommand(event) {
  const chip = event.target.closest?.(".zen-space-chip[zen-workspace-id]");
  if (!chip) {
    return;
  }
  const win = chip.ownerDocument.defaultView;
  if (dragJustEnded.has(win)) {
    return; // the mouseup that ended a drag, not a click
  }
  const uuid = chip.getAttribute("zen-workspace-id");
  // Highlight the clicked Space right away (Zen's switch animation takes about
  // 250ms) and hold it until this click's switch is done.
  const seq = ++switchSeq;
  pendingSwitches.set(win, { uuid, seq });
  render(win);
  Promise.resolve()
    .then(() => Zen.switchTo(win, uuid))
    .catch(e => console.error(LOG_PREFIX, "switch failed", e))
    .finally(() => {
      if (pendingSwitches.get(win)?.seq === seq) {
        pendingSwitches.delete(win);
      }
      render(win);
    });
}

// ---------------------------------------------------------------------------
// Drag to reorder
//
// Works like Zen's sidebar strip (ZenSpaceIcons.mjs:28-103): plain mouse
// events instead of native drag and drop, so the bookmarks toolbar's own drop
// handling never sees a chip. After a few pixels the chip follows the pointer
// between its neighbors, and the drop calls reorderWorkspace() with its new
// index. Esc or leaving the window cancels.

export const DRAG_THRESHOLD_PX = 5;
const dragJustEnded = new WeakSet();

function onRowMouseDown(event) {
  const chip = event.target.closest?.(".zen-space-chip[zen-workspace-id]");
  if (
    !chip ||
    event.button !== 0 ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.metaKey
  ) {
    return;
  }
  const doc = chip.ownerDocument;
  const win = doc.defaultView;
  if (!Zen.canReorder(win)) {
    return;
  }
  const list = chip.parentNode;
  const row = list.parentNode;
  const startX = event.clientX;
  let dragging = false;

  const onMove = moveEvent => {
    if (!dragging) {
      if (Math.abs(moveEvent.clientX - startX) <= DRAG_THRESHOLD_PX) {
        return;
      }
      dragging = true;
      row.setAttribute("reordering", "true");
      chip.setAttribute("dragged", "true");
    }
    const x = moveEvent.clientX;
    for (const other of list.children) {
      if (other === chip) {
        continue;
      }
      const rect = other.getBoundingClientRect();
      if (x > rect.left && x < rect.right) {
        const before = x < rect.left + rect.width / 2;
        list.insertBefore(chip, before ? other : other.nextSibling);
        break;
      }
    }
  };
  const onUp = () => finish(true);
  const onKey = keyEvent => {
    if (keyEvent.key === "Escape") {
      keyEvent.preventDefault();
      finish(false);
    }
  };
  const onBlur = () => finish(false);

  function finish(commit) {
    doc.removeEventListener("mousemove", onMove, true);
    doc.removeEventListener("mouseup", onUp, true);
    doc.removeEventListener("keydown", onKey, true);
    win.removeEventListener("blur", onBlur);
    if (!dragging) {
      return; // a plain click, handled by the command event
    }
    chip.removeAttribute("dragged");
    row.removeAttribute("reordering");
    dragJustEnded.add(win);
    win.setTimeout(() => dragJustEnded.delete(win), 0);
    if (!commit) {
      render(win); // back to Zen's order
      return;
    }
    const uuid = chip.getAttribute("zen-workspace-id");
    const index = [...list.children].indexOf(chip);
    Promise.resolve()
      .then(() => Zen.reorder(win, uuid, index))
      .catch(e => console.error(LOG_PREFIX, "reorder failed", e))
      .finally(() => render(win));
  }

  doc.addEventListener("mousemove", onMove, true);
  doc.addEventListener("mouseup", onUp, true);
  doc.addEventListener("keydown", onKey, true);
  win.addEventListener("blur", onBlur);
}

function buildRow(doc) {
  const win = doc.defaultView;
  const row = doc.createXULElement("toolbaritem");
  row.setAttribute("id", WIDGET_ID);
  row.className = "chromeclass-toolbar-additional";
  row.setAttribute("label", "Space Chips"); // name in Customize Toolbar
  row.setAttribute("removable", "true");
  row.setAttribute("overflows", "false");
  row.addEventListener("command", onRowCommand);
  row.addEventListener("mousedown", onRowMouseDown);
  const list = doc.createXULElement("hbox");
  list.className = "zen-space-chips-list";
  row.append(list);
  if (ready.has(win)) {
    fillRow(win, row);
  } else {
    attach(win).catch(e => console.error(LOG_PREFIX, "attach failed", e));
  }
  return row;
}

// ---------------------------------------------------------------------------
// Registration

function importCustomizableUI() {
  let lastError;
  for (const url of CUSTOMIZABLE_UI_URLS) {
    try {
      return ChromeUtils.importESModule(url).CustomizableUI;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

// First run only: put the chips at the left end of the bookmarks toolbar.
// After that, whatever the user does in Customize Toolbar sticks.
function placeOnFirstRun(CustomizableUI) {
  if (Services.prefs.getBoolPref(PREF_PLACED, false)) {
    return;
  }
  if (!CustomizableUI.getPlacementOfWidget(WIDGET_ID)) {
    CustomizableUI.addWidgetToArea(
      WIDGET_ID,
      CustomizableUI.AREA_BOOKMARKS,
      0
    );
  }
  Services.prefs.setBoolPref(PREF_PLACED, true);
}

let registered = false;

export function register() {
  if (registered) {
    return;
  }
  registered = true;
  const CustomizableUI = importCustomizableUI();
  CustomizableUI.createWidget({
    id: WIDGET_ID,
    type: "custom",
    label: "Space Chips",
    showInPrivateBrowsing: false,
    onBuild: buildRow,
  });
  CustomizableUI.addListener({
    onWidgetAfterDOMChange(node, _nextNode, _container, isRemoval) {
      const win = node.ownerDocument.defaultView;
      if (!ready.has(win)) {
        return;
      }
      // Re-adding the widget reuses the old node without calling onBuild, so
      // the chips may be out of date.
      if (node.id === WIDGET_ID && !isRemoval) {
        render(win);
      }
      // Moving anything on the toolbar can change whether the divider is needed.
      scheduleDividerCheck(win);
    },
    onCustomizeEnd(win) {
      if (ready.has(win)) {
        render(win);
        scheduleDividerCheck(win);
      }
    },
  });
  try {
    placeOnFirstRun(CustomizableUI);
  } catch (e) {
    console.error(LOG_PREFIX, "first-run placement failed", e);
  }
  Services.prefs.addObserver(PREF_MODE, renderAllWindows);
  Services.prefs.addObserver(PREF_DIVIDER, renderAllWindows);
  Services.prefs.addObserver(PREF_SHOW_BORDER, renderAllWindows);
  // Zen sends this when light/dark mode changes.
  Services.obs.addObserver(onThemeChange, "zen-theme-change");
}

// Loading CustomizableUI before the first window is up could read the default
// toolbar layout instead of the saved one, so wait for a window to finish
// starting.
function onStartupFinished() {
  Services.obs.removeObserver(onStartupFinished, STARTUP_TOPIC);
  try {
    register();
  } catch (e) {
    console.error(LOG_PREFIX, "registration failed", e);
  }
}

if (
  Services.wm.getMostRecentWindow("navigator:browser")?.gBrowserInit
    ?.delayedStartupFinished
) {
  onStartupFinished();
} else {
  Services.obs.addObserver(onStartupFinished, STARTUP_TOPIC);
}
