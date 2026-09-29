# Design

Zen Space Chips adds a chip for each Zen Space to the bookmarks toolbar. Click a chip to switch Spaces, drag one to reorder them. These are the decisions behind it.

## fx-autoconfig as the loader

Zen's built-in mod system only runs CSS, and the chips need JavaScript. Sine can run JS, but it takes over Zen's built-in mods, installs only from GitHub, and won't load JS from outside its store unless you turn on an "unsafe" setting. fx-autoconfig is a couple of small files and doesn't touch anything else.

The mod itself doesn't use any fx-autoconfig APIs. Moving to Sine later would only need a manifest.

## A new toolbar widget

Zen's sidebar Space switcher can't be moved into a toolbar (it's marked `removable="false"`), so the mod registers its own `CustomizableUI` widget. That gets Customize Toolbar support, saved placement and a copy in every window without extra work.

The widget goes to the left end of the bookmarks toolbar on first run, and after that it stays wherever the user puts it. Hiding the bookmarks toolbar (Ctrl+Shift+B) hides the chips too.

## Use Zen's own calls

A chip click calls `gZenWorkspaces.changeWorkspaceWithID()`, the same thing Zen's sidebar strip does, and dragging calls `reorderWorkspace()`. Right-clicking a chip opens Zen's own Space menu, which works because each chip is a `toolbarbutton` with a `zen-workspace-id` attribute, just like the sidebar icons.

These are internal APIs and can change with any Zen update. All of them go through one `Zen` object in the module, so there's one place to fix. If something is missing, the chips hide and log a warning instead of breaking the browser.

## Wait for the first window

fx-autoconfig loads the module very early, possibly before Firefox has read the saved toolbar layout. Loading `CustomizableUI` at that point could pick up the default layout and save it over the user's, so the widget registers only after the first window finishes starting.

## Keep the clicked Space highlighted

Zen queues a switch behind any switch already running, and it only updates the active Space when the queued one starts. Clicking through several chips quickly would otherwise make the highlight jump back to Spaces in between. The chip you clicked stays highlighted until its switch is done.

## Update chips in place

Chips are updated by Space id rather than rebuilt. If a chip were replaced between mousedown and mouseup, that click would be lost, which showed up as having to click twice.

## Reorder with mouse events

Dragging works the way Zen's sidebar strip does, with mouse events instead of native drag and drop. That keeps the bookmarks toolbar's own drop handling out of it. Esc or switching windows cancels a drag, and dropping a chip doesn't count as a click.

## Leave the bookmarks' size alone

The bookmarks keep Firefox's normal sizing, filling the rest of the toolbar with "Other Bookmarks" at the far end. Pushing them to the right edge didn't work out. Firefox caps a Flexible Space at 112px outside the URL bar, and shrinking the bookmarks to fit instead moved "Other Bookmarks" into the middle of the toolbar.

## The divider

The `|` belongs to the gap between the chips and the bookmarks, not to either one. It's drawn on whichever of the two comes second in the toolbar, so it disappears when they end up in different toolbars.

The `uc.space-chips.divider` pref has three settings. `auto` (the default) only shows the divider when the chips and the bookmarks run into each other: they touch, the bookmarks overflow into », or the chips start scrolling. `always` shows it whenever they share a toolbar, plus one after the chips if the bookmarks are somewhere else. `never` turns it off.

For `auto`, the gap is measured to the bookmarks you can actually see, because Firefox stretches the bookmarks area right up to the chips even when it's empty. The divider's space is always reserved, so it can appear or disappear without anything moving.

## Prefs show up in about:config

Both prefs (`uc.space-chips.mode` and `uc.space-chips.divider`) get default values when the mod starts. That way they're listed in about:config before anyone changes them, and Reset puts them back.

## Not done yet

- An option to replace the bookmarks entirely instead of sitting next to them
- Accent colors from each Space's theme
- Scrolling the mouse wheel over the chips to change Spaces
- Keyboard reordering
- Auto-scrolling the chips while dragging, for when there are too many to fit
- Custom icons beyond the ones Zen offers
