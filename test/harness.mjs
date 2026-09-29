// Fakes for the browser globals the mod uses, modeled on Zen 1.22.3b and
// Firefox 156. Each test installs a fresh set and imports a fresh copy of the
// module.

import { JSDOM } from "jsdom";

export const STARTUP_TOPIC = "browser-delayed-startup-finished";
export const CUI_URL =
  "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs";

class FakePrefs {
  #values = new Map(); // user values
  #defaults = new Map(); // default branch
  #observers = [];
  // Like Firefox: a user value wins, then the default branch, then the fallback.
  #get(name, fallback) {
    if (this.#values.has(name)) {
      return this.#values.get(name);
    }
    return this.#defaults.has(name) ? this.#defaults.get(name) : fallback;
  }
  getStringPref(name, fallback) {
    return this.#get(name, fallback);
  }
  getDefaultBranch(root) {
    return {
      setStringPref: (name, value) => this.#defaults.set(root + name, value),
      getStringPref: name => this.#defaults.get(root + name),
      setBoolPref: (name, value) => this.#defaults.set(root + name, value),
      getBoolPref: name => this.#defaults.get(root + name),
    };
  }
  prefHasUserValue(name) {
    return this.#values.has(name);
  }
  clearUserPref(name) {
    this.#values.delete(name);
  }
  getBoolPref(name, fallback) {
    return this.#get(name, fallback);
  }
  getIntPref(name, fallback) {
    return this.#values.has(name) ? this.#values.get(name) : fallback;
  }
  setStringPref(name, value) {
    this.#set(name, value);
  }
  setBoolPref(name, value) {
    this.#set(name, value);
  }
  setIntPref(name, value) {
    this.#set(name, value);
  }
  addObserver(name, fn) {
    this.#observers.push({ name, fn });
  }
  #set(name, value) {
    this.#values.set(name, value);
    for (const o of this.#observers) {
      if (o.name === name) {
        o.fn(null, "nsPref:changed", name);
      }
    }
  }
}

class FakeObserverService {
  #observers = [];
  addObserver(fn, topic) {
    this.#observers.push({ fn, topic });
  }
  removeObserver(fn, topic) {
    this.#observers = this.#observers.filter(
      o => o.fn !== fn || o.topic !== topic
    );
  }
  notifyObservers(subject, topic) {
    for (const o of [...this.#observers]) {
      if (o.topic === topic) {
        o.fn(subject, topic);
      }
    }
  }
  count(topic) {
    return this.#observers.filter(o => o.topic === topic).length;
  }
}

/** Mirrors the parts of nsZenWorkspaces (ZenSpaceManager.mjs) the mod uses. */
export class FakeZenWorkspaces {
  #listeners = [];
  switchCalls = [];
  privateWindowOrDisabled = false;
  promiseInitialized = Promise.resolve();

  constructor(win, spaces, active) {
    this.win = win;
    this._workspaceCache = spaces;
    this.activeWorkspace = active ?? spaces[0]?.uuid;
  }
  getWorkspaces() {
    return [...this._workspaceCache];
  }
  // Same fallback as Zen's getWorkspaceIcon()
  getWorkspaceIcon(space) {
    if (space.icon) {
      return space.icon;
    }
    return Array.from(space.name)[0]?.toUpperCase();
  }
  addChangeListeners(func, opts = { once: false }) {
    this.#listeners.push({ func, opts });
  }
  removeChangeListeners(func) {
    this.#listeners = this.#listeners.filter(l => l.func !== func);
  }
  get listenerCount() {
    return this.#listeners.length;
  }
  // Like Zen's changeWorkspace(): a switch waits for the one in flight, sets
  // activeWorkspace when it starts, animates, then awaits each change
  // listener in turn. Errors are caught.
  switchDelayMs = 0;
  #inFlight = Promise.resolve();
  async changeWorkspaceWithID(uuid) {
    this.switchCalls.push(uuid);
    const previous = this.#inFlight;
    let finish;
    this.#inFlight = new Promise(resolve => (finish = resolve));
    await previous;
    const workspace = this._workspaceCache.find(s => s.uuid === uuid);
    try {
      this.activeWorkspace = uuid;
      this.stepsAfterListeners = 0;
      if (this.switchDelayMs) {
        await new Promise(resolve => setTimeout(resolve, this.switchDelayMs));
      }
      for (const { func } of this.#listeners) {
        await func({ workspace, onInit: false });
      }
      this.stepsAfterListeners++; // stands in for updateWorkspaceIndicator etc.
    } catch (e) {
      this.listenerError = e;
    } finally {
      finish();
    }
    return workspace;
  }
  // Like Zen's reorderWorkspace(): move, then notify.
  reorderCalls = [];
  async reorderWorkspace(id, newPosition) {
    this.reorderCalls.push([id, newPosition]);
    const spaces = this.getWorkspaces();
    const current = spaces.findIndex(s => s.uuid === id);
    if (current === -1 || newPosition < 0 || newPosition >= spaces.length) {
      return;
    }
    const [space] = spaces.splice(current, 1);
    spaces.splice(newPosition, 0, space);
    if (current !== newPosition) {
      this._workspaceCache = spaces;
      this.fireUIUpdate();
    }
  }
  // Test helpers that mimic Zen's own notifications.
  fireUIUpdate() {
    this.win.dispatchEvent(new this.win.CustomEvent("ZenWorkspacesUIUpdate"));
  }
  fireDataChanged() {
    this.win.dispatchEvent(new this.win.CustomEvent("ZenWorkspaceDataChanged"));
  }
}

/**
 * Like Zen's gZenThemePicker: a cached toolbar background per Space. Colors
 * come out as rgba(); two or more make a gradient, one is a plain color.
 */
export class FakeThemePicker {
  invalidated = [];
  computed = [];
  #cache = new Map();
  getGradientForWorkspace(space) {
    if (!this.#cache.has(space.uuid)) {
      this.computed.push(space.uuid);
      const colors = space.theme.gradientColors.map(color =>
        typeof color.c === "string" ? color.c : `rgba(${color.c.join(", ")}, 1)`
      );
      this.#cache.set(space.uuid, {
        toolbarGradient:
          colors.length === 1 ? colors[0] : `linear-gradient(-30deg, ${colors.join(", ")})`,
      });
    }
    return this.#cache.get(space.uuid);
  }
  invalidateGradientCache(uuid) {
    this.invalidated.push(uuid);
    this.#cache.delete(uuid);
  }
  getToolbarModifiedBase() {
    return "rgba(23, 23, 26, 1)";
  }
}

/**
 * Just enough CustomizableUI: placements, widgets, per-window builds. Like
 * the real one, it keeps each window's node and reuses it on re-add without
 * calling onBuild again.
 */
export class FakeCustomizableUI {
  AREA_BOOKMARKS = "PersonalToolbar";
  AREA_NAVBAR = "nav-bar";
  widgets = new Map();
  windows = [];
  addCalls = [];
  buildCount = 0;
  #listeners = [];
  #instances = new Map(); // widget id -> Map(document -> node)
  placements = new Map([
    ["nav-bar", ["back-button", "urlbar-container"]],
    ["PersonalToolbar", ["import-button", "personal-bookmarks"]],
  ]);

  createWidget(props) {
    this.widgets.set(props.id, props);
    const placement = this.getPlacementOfWidget(props.id);
    if (placement) {
      for (const win of this.windows) {
        this.#insert(win, props.id, placement);
      }
    }
    return props.id;
  }
  getPlacementOfWidget(id) {
    for (const [area, ids] of this.placements) {
      const position = ids.indexOf(id);
      if (position !== -1) {
        return { area, position };
      }
    }
    return null;
  }
  addWidgetToArea(id, area, position) {
    this.addCalls.push([id, area, position]);
    const ids = this.placements.get(area);
    ids.splice(position ?? ids.length, 0, id);
    for (const win of this.windows) {
      this.#insert(win, id, { area, position });
    }
  }
  /** Moves any toolbar item (e.g. the bookmarks) as Customize Toolbar would. */
  moveNode(win, id, area, position) {
    const node = win.document.getElementById(id);
    const toolbar = win.document.getElementById(area);
    const nextNode = toolbar.children[position] ?? null;
    toolbar.insertBefore(node, nextNode);
    this.#notify("onWidgetAfterDOMChange", node, nextNode, toolbar, false);
  }
  removeWidgetFromArea(id) {
    for (const ids of this.placements.values()) {
      const index = ids.indexOf(id);
      if (index !== -1) {
        ids.splice(index, 1);
      }
    }
    for (const win of this.windows) {
      const node = win.document.getElementById(id);
      if (node) {
        const container = node.parentNode;
        node.remove();
        this.#notify("onWidgetAfterDOMChange", node, null, container, true);
      }
    }
  }
  addListener(listener) {
    this.#listeners.push(listener);
  }
  /** What customize mode does when the user clicks Done. */
  endCustomizing(win) {
    this.#notify("onCustomizeEnd", win);
  }
  /** A window's toolbars being built during its load. */
  registerWindow(win) {
    this.windows.push(win);
    for (const id of this.widgets.keys()) {
      const placement = this.getPlacementOfWidget(id);
      if (placement) {
        this.#insert(win, id, placement);
      }
    }
  }
  #notify(name, ...args) {
    for (const listener of this.#listeners) {
      listener[name]?.(...args);
    }
  }
  #insert(win, id, { area, position }) {
    const widget = this.widgets.get(id);
    if (!widget || (win.isPrivate && widget.showInPrivateBrowsing === false)) {
      return;
    }
    let cache = this.#instances.get(id);
    if (!cache) {
      cache = new Map();
      this.#instances.set(id, cache);
    }
    let node = cache.get(win.document);
    if (!node) {
      node = widget.onBuild(win.document);
      this.buildCount++;
      cache.set(win.document, node);
    }
    const toolbar = win.document.getElementById(area);
    const nextNode = toolbar.children[position] ?? null;
    toolbar.insertBefore(node, nextNode);
    this.#notify("onWidgetAfterDOMChange", node, nextNode, toolbar, false);
  }
}

export function makeWindow({
  spaces = defaultSpaces(),
  active,
  delayedStartupFinished = true,
  isPrivate = false,
  zen = true,
} = {}) {
  // Same nesting as Firefox's browser.xhtml: PersonalToolbar > personal-bookmarks
  // > PlacesToolbar > PlacesToolbarItems.
  const dom = new JSDOM(
    `<!DOCTYPE html><body>
    <div id="nav-bar"><div id="back-button"></div><div id="urlbar-container"></div></div>
    <div id="PersonalToolbar"><div id="import-button"></div><div id="personal-bookmarks">
      <div id="PlacesToolbar"><div id="PlacesToolbarItems">
        <div class="bookmark-item"></div><div class="bookmark-item"></div>
      </div><div id="PlacesChevron" collapsed="true"></div></div>
    </div></div>
  </body>`
  );
  const win = dom.window;
  const doc = win.document;
  // A fixed 16ms frame. jsdom's own frames (pretendToBeVisual) can lag by 60ms or more.
  win.requestAnimationFrame = callback =>
    win.setTimeout(() => callback(Date.now()), 16);
  win.cancelAnimationFrame = id => win.clearTimeout(id);
  // Plain HTML elements stand in for XUL ones: in jsdom only HTML and SVG
  // elements get a `style` property, which real XUL elements have.
  doc.createXULElement = tag => doc.createElement(tag);
  // jsdom has no ResizeObserver; tests drive this one with placeAt().
  win.resizeObservers = [];
  win.ResizeObserver = class {
    targets = new Set();
    constructor(callback) {
      this.callback = callback;
      win.resizeObservers.push(this);
    }
    observe(target) {
      this.targets.add(target);
      this.callback([]);
    }
    disconnect() {
      this.targets.clear();
    }
  };
  win.isPrivate = isPrivate;
  win.gBrowserInit = { delayedStartupFinished };
  if (zen) {
    win.gZenWorkspaces = new FakeZenWorkspaces(win, spaces, active);
    win.gZenWorkspaces.privateWindowOrDisabled = isPrivate;
    win.gZenThemePicker = new FakeThemePicker();
  }
  return win;
}

export function defaultSpaces() {
  return [
    {
      uuid: "{work}",
      name: "Work",
      icon: "chrome://browser/skin/zen-icons/selectable/briefcase.svg",
    },
    { uuid: "{agent}", name: "Agent", icon: "🤖" },
    { uuid: "{travel}", name: "travel", icon: "" },
  ];
}

let importCounter = 0;

/**
 * Installs fresh fakes as globals, then imports a fresh module instance.
 * `windows` are open (and toolbars built) before the module loads.
 */
export async function loadMod({ windows = [], prefs = {}, placements } = {}) {
  const CUI = new FakeCustomizableUI();
  for (const [area, ids] of Object.entries(placements ?? {})) {
    CUI.placements.set(area, [...ids]);
  }
  const Services = {
    prefs: new FakePrefs(),
    obs: new FakeObserverService(),
    wm: {
      getEnumerator: () => [...CUI.windows],
      getMostRecentWindow: () => CUI.windows.at(-1) ?? null,
    },
  };
  for (const [name, value] of Object.entries(prefs)) {
    if (typeof value === "boolean") {
      Services.prefs.setBoolPref(name, value);
    } else if (typeof value === "number") {
      Services.prefs.setIntPref(name, value);
    } else {
      Services.prefs.setStringPref(name, value);
    }
  }
  globalThis.Services = Services;
  globalThis.ChromeUtils = {
    importESModule(url) {
      if (url === CUI_URL) {
        return { CustomizableUI: CUI };
      }
      throw new Error(`unexpected import ${url}`);
    },
  };
  for (const win of windows) {
    CUI.registerWindow(win);
  }
  const mod = await import(
    `../src/zen-space-chips.sys.mjs?instance=${++importCounter}`
  );
  return { mod, CUI, Services };
}

/** Lets pending promise chains (attach, switch) settle. */
export async function settle() {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

export function chipsOf(win) {
  return [...win.document.querySelectorAll("#zen-space-chips .zen-space-chip")];
}

export function activeIds(win) {
  return chipsOf(win)
    .filter(c => c.getAttribute("active") === "true")
    .map(c => c.getAttribute("zen-workspace-id"));
}

export function click(win, chip) {
  chip.dispatchEvent(new win.Event("command", { bubbles: true }));
}

/** Lays `element` out from `left` to `left + width`; notifies ResizeObservers. */
export function placeAt(win, element, left, width) {
  element.getBoundingClientRect = () => ({
    left,
    right: left + width,
    width,
    height: 24,
  });
  for (const observer of win.resizeObservers) {
    if (observer.targets.has(element)) {
      observer.callback([]);
    }
  }
}

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Resolves once `condition()` is true; throws after `timeoutMs`. jsdom's
 * timing varies (style work can take ~50ms), so fixed sleeps are flaky.
 */
export async function waitFor(condition, timeoutMs = 1000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`condition not met within ${timeoutMs}ms`);
    }
    await sleep(5);
  }
}

/** Lays the chips out left to right by DOM order: 90px wide, 100px apart. */
export function layoutChips(win) {
  for (const chip of chipsOf(win)) {
    chip.getBoundingClientRect = () => {
      const i = [...chip.parentNode.children].indexOf(chip);
      return { left: i * 100, right: i * 100 + 90, width: 90, height: 24 };
    };
  }
}

export function mouse(win, target, type, clientX, init = {}) {
  target.dispatchEvent(
    new win.MouseEvent(type, { bubbles: true, cancelable: true, clientX, ...init })
  );
}

export function chipIds(win) {
  return chipsOf(win).map(c => c.getAttribute("zen-workspace-id"));
}
