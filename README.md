# Zen Space Chips

A Zen Browser mod that puts a chip for each of your Spaces on the bookmarks toolbar, to the left of your bookmarks.

```
[▪ Work] [▪ Agent] [▪ Travel] | Bookmark A   Bookmark B   . . . . . . .   Other Bookmarks
```

Click a chip to switch to that Space. Drag a chip left or right to reorder your Spaces (Esc cancels), and the sidebar and your other windows follow along. Right-click a chip for Zen's usual Space menu. The chips show and hide with the bookmarks toolbar (Ctrl+Shift+B).

It's tested with Zen 1.22.3b on Windows. The mod uses Zen internals, so a Zen update can break it. If that happens the chips hide themselves and log a warning (see Troubleshooting).

[DESIGN.md](DESIGN.md) explains how it works.

## Install

These steps use `scripts/deploy.sh` from WSL. It finds your Zen install and profile on its own. If it picks the wrong ones, set `ZEN_INSTALL` and `ZEN_PROFILE`.

1. Install fx-autoconfig, the script loader:

   ```bash
   scripts/deploy.sh loader
   ```

   This backs up your profile's `chrome/` folder, then copies two small files into the Zen install folder and the loader into `chrome/utils/`. If any of those files already exist with different contents (another loader, say), it stops before writing anything.

2. Install the mod:

   ```bash
   scripts/deploy.sh mod
   ```

3. Restart Zen with the startup cache cleared. Use `about:support` > Clear startup cache, or quit Zen and run `scripts/deploy.sh mod --clear-cache`, which only clears the cache if it can tell Zen is closed.

4. Press Ctrl+Shift+B if the bookmarks toolbar is hidden. It is by default in Zen.

`scripts/deploy.sh status` shows what's installed and whether Zen is running.

## Settings

They're all in `about:config` (search for `uc.space-chips`) and take effect right away.

| Pref | Values | Default |
|---|---|---|
| `uc.space-chips.mode` | `icon+name`, `icon`, `name` | `icon+name` |
| `uc.space-chips.divider` | `auto`, `always`, `never` | `auto` |
| `uc.space-chips.show-border` | `true`, `false` | `true` |

With `show-border` on, each chip gets a ring in its Space's theme colors, taken from the Space's background in Zen. Spaces using Zen's default theme don't get one.

With `auto`, the `|` only shows up when the chips and your bookmarks run into each other: they're touching, the bookmarks are spilling into the » menu, or the chips have started scrolling. If there aren't any bookmarks on the bar, there's no divider. `always` shows it whenever the chips and bookmarks share a toolbar, and after the chips when they don't. `never` turns it off.

## Moving things around

Right-click a toolbar and choose Customize Toolbar. The chips are the "Space Chips" item and work in any toolbar. A Flexible Space in front of the bookmarks adds a gap of up to 112px (Firefox caps it outside the URL bar).

| Arrangement | Looks like |
|---|---|
| chips, bookmarks | `chips \| bookmarks ...... Other Bookmarks` |
| chips, Flexible Space, bookmarks | `chips ... bookmarks ...... Other Bookmarks` (no `\|` with `auto` until things get tight) |
| bookmarks, chips | `bookmarks \| chips` |
| chips on their own | just the chips |

The divider disappears while Customize Toolbar is open and comes back when you're done.

The mod only places the chips once, on first run. After that they stay wherever you put them, even if you remove them. Restore Defaults moves them to the palette, so you'll need to drag them back.

## Development

```bash
nvm use
npm install
npm test
scripts/deploy.sh mod
```

The mod is `src/zen-space-chips.sys.mjs` and `src/zen-space-chips.uc.css`. Every call into Zen goes through the `Zen` object at the top of the JS file. The tests run the mod against fake Zen and Firefox objects in jsdom, and run `deploy.sh` against temporary folders.

`reference/` isn't committed. `deploy.sh loader` downloads fx-autoconfig into it at a pinned commit if it's missing.

## Troubleshooting

No chips at all: open the Browser Console (Ctrl+Shift+J) and look for `[space-chips]`. "Spaces API was not found" means a Zen update changed something the mod depends on.

To check that the loader is running, press Alt to show the menu bar and look for Tools > userScripts. If it's not there, clear the startup cache. A Zen reinstall removes the loader's files from the install folder, so run `scripts/deploy.sh loader` again after one.

If the chips look off, Zen's own CSS may be overriding the mod's. The Browser Toolbox (Ctrl+Alt+Shift+I) will show you which rule wins.

## Uninstall

```bash
scripts/deploy.sh remove          # just the mod
scripts/deploy.sh remove-loader   # fx-autoconfig too
```

`remove-loader` only deletes files that are still exactly as it installed them. Restart Zen afterwards. The `chrome.backup-*` folder from the loader install has your `chrome/` folder as it was before.
