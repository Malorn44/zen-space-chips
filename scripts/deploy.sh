#!/usr/bin/env bash
# Install, update or remove Zen Space Chips from WSL.
#
#   scripts/deploy.sh status          show what's installed
#   scripts/deploy.sh loader          back up chrome/ and install fx-autoconfig
#   scripts/deploy.sh mod [--clear-cache]
#                                     copy the mod into the profile (default)
#   scripts/deploy.sh remove          remove the mod files
#   scripts/deploy.sh remove-loader   remove fx-autoconfig files that are unchanged
#
# It never overwrites or deletes a file that differs from what it installs,
# and only clears the startup cache when it can confirm Zen isn't running.
#
# Paths are found automatically. Override them with ZEN_INSTALL, ZEN_PROFILE
# and ZEN_STARTUP_CACHE (WSL paths), and the process check with ZEN_TASKLIST.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TASKLIST="${ZEN_TASKLIST:-/mnt/c/Windows/System32/tasklist.exe}"

FXAC_REPO="https://github.com/MrOtherGuy/fx-autoconfig.git"
FXAC_COMMIT="dfdab5684faffc112b76ccb1d8cab7f75da0102c"
FXAC_DIR="$REPO/reference/fx-autoconfig"

MOD_JS="zen-space-chips.sys.mjs"
MOD_CSS="zen-space-chips.uc.css"

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# A Windows folder variable (APPDATA, LOCALAPPDATA) as a WSL path.
win_folder() {
  local path
  path="$(cd /mnt/c && cmd.exe /c "echo %$1%" 2>/dev/null | tr -d '\r')"
  [[ -n "$path" && "$path" != "%$1%" ]] ||
    die "couldn't read %$1% from Windows; set ZEN_INSTALL and ZEN_PROFILE"
  wslpath -u "$path"
}

find_install() {
  local dir
  for dir in "$1/Zen Browser" "/mnt/c/Program Files/Zen Browser"; do
    if [[ -f "$dir/zen.exe" ]]; then
      printf '%s\n' "$dir"
      return
    fi
  done
  die "couldn't find Zen; set ZEN_INSTALL"
}

# The profile this install used most recently. Each profile's
# compatibility.ini records the install that last opened it.
find_profile() {
  local install_win best="" best_time=0 dir time
  install_win="$(wslpath -w "$ZEN_INSTALL")"
  for dir in "$1"/zen/Profiles/*/; do
    dir="${dir%/}"
    [[ -f "$dir/prefs.js" ]] || continue
    grep -qiF "LastPlatformDir=$install_win" "$dir/compatibility.ini" 2>/dev/null || continue
    time="$(stat -c %Y "$dir/prefs.js")"
    if (( time > best_time )); then
      best="$dir"
      best_time="$time"
    fi
  done
  [[ -n "$best" ]] || die "couldn't find a profile for $ZEN_INSTALL; set ZEN_PROFILE"
  printf '%s\n' "$best"
}

if [[ -z "${ZEN_INSTALL:-}" || -z "${ZEN_PROFILE:-}" || -z "${ZEN_STARTUP_CACHE:-}" ]]; then
  LOCAL_APPDATA="$(win_folder LOCALAPPDATA)"
  ROAMING_APPDATA="$(win_folder APPDATA)"
fi
ZEN_INSTALL="${ZEN_INSTALL:-$(find_install "$LOCAL_APPDATA")}"
ZEN_PROFILE="${ZEN_PROFILE:-$(find_profile "$ROAMING_APPDATA")}"
STARTUP_CACHE="${ZEN_STARTUP_CACHE:-$LOCAL_APPDATA/zen/Profiles/$(basename "$ZEN_PROFILE")/startupCache}"
CHROME="$ZEN_PROFILE/chrome"

# Prints running, stopped, or unknown (tasklist failed or said something odd).
zen_state() {
  local tasks
  if ! tasks="$("$TASKLIST" /FI "IMAGENAME eq zen.exe" /FO CSV /NH 2>/dev/null)"; then
    echo unknown
  elif grep -qi '"zen.exe"' <<<"$tasks"; then
    echo running
  elif grep -qi 'No tasks are running' <<<"$tasks"; then
    echo stopped
  else
    echo unknown
  fi
}

check_paths() {
  [[ -f "$ZEN_INSTALL/zen.exe" ]] || die "Zen install not found: $ZEN_INSTALL"
  [[ -f "$ZEN_PROFILE/prefs.js" ]] || die "Zen profile not found: $ZEN_PROFILE"
}

loader_installed() {
  [[ -f "$ZEN_INSTALL/config.js" &&
     -f "$ZEN_INSTALL/defaults/pref/config-prefs.js" &&
     -f "$CHROME/utils/boot.sys.mjs" ]]
}

ensure_fxac_source() {
  if [[ "$(git -C "$FXAC_DIR" rev-parse HEAD 2>/dev/null)" != "$FXAC_COMMIT" ]]; then
    say "Fetching fx-autoconfig @ ${FXAC_COMMIT:0:7}"
    rm -rf "$FXAC_DIR"
    git init -q "$FXAC_DIR"
    git -C "$FXAC_DIR" fetch -q --depth 1 "$FXAC_REPO" "$FXAC_COMMIT"
    git -C "$FXAC_DIR" checkout -q FETCH_HEAD
  fi
}

# Every file the loader install writes, one "installed|source" pair per line.
loader_files() {
  printf '%s|%s\n' "$ZEN_INSTALL/config.js" "$FXAC_DIR/program/config.js"
  printf '%s|%s\n' "$ZEN_INSTALL/defaults/pref/config-prefs.js" \
    "$FXAC_DIR/program/defaults/pref/config-prefs.js"
  local src
  for src in "$FXAC_DIR"/profile/chrome/utils/*; do
    printf '%s|%s\n' "$CHROME/utils/$(basename "$src")" "$src"
  done
}

restart_hint() {
  say ""
  say "Restart Zen with the startup cache cleared, using any of:"
  say "  - about:support > 'Clear startup cache...' (top right)"
  say "  - Alt > Tools > userScripts > Restart and clear startup cache (once the loader runs)"
  say "  - quit Zen, run: scripts/deploy.sh mod --clear-cache, start Zen"
}

cmd_status() {
  check_paths
  say "Zen install : $ZEN_INSTALL ($(grep -m1 '^Version=' "$ZEN_INSTALL/application.ini" | cut -d= -f2))"
  say "Profile     : $ZEN_PROFILE"
  if loader_installed; then say "Loader      : fx-autoconfig installed"; else say "Loader      : not installed"; fi
  local f
  for f in "JS/$MOD_JS" "CSS/$MOD_CSS"; do
    if [[ ! -f "$CHROME/$f" ]]; then
      say "Mod file    : $f missing"
    elif cmp -s "$CHROME/$f" "$REPO/src/$(basename "$f")"; then
      say "Mod file    : $f up to date"
    else
      say "Mod file    : $f differs from src/"
    fi
  done
  say "Zen         : $(zen_state)"
}

cmd_loader() {
  check_paths
  ensure_fxac_source

  # Check everything before writing anything.
  local conflicts=() dest src
  while IFS='|' read -r dest src; do
    if [[ -e "$dest" ]] && ! cmp -s "$dest" "$src"; then
      conflicts+=("$dest")
    fi
  done < <(loader_files)
  if (( ${#conflicts[@]} )); then
    printf 'error: these files differ from fx-autoconfig @ %s, not overwriting:\n' "${FXAC_COMMIT:0:7}" >&2
    printf '  %s\n' "${conflicts[@]}" >&2
    exit 1
  fi

  if [[ -d "$CHROME" ]]; then
    local backup
    backup="$ZEN_PROFILE/chrome.backup-$(date +%Y%m%d-%H%M%S)"
    cp -a "$CHROME" "$backup"
    say "Backed up chrome/ to $backup"
  fi

  mkdir -p "$ZEN_INSTALL/defaults/pref" "$CHROME/utils" "$CHROME/JS" "$CHROME/CSS" "$CHROME/resources"
  while IFS='|' read -r dest src; do
    cp "$src" "$dest"
  done < <(loader_files)
  say "Installed fx-autoconfig (config.js and config-prefs.js in the install, chrome/utils in the profile)"
  restart_hint
}

cmd_mod() {
  check_paths
  loader_installed || die "fx-autoconfig isn't installed; run scripts/deploy.sh loader"
  local clear_cache=false
  if [[ "${1:-}" == "--clear-cache" ]]; then
    clear_cache=true
    local state
    state="$(zen_state)"
    [[ "$state" == "stopped" ]] ||
      die "can't confirm Zen is closed (state: $state), so the cache wasn't cleared. Nothing changed."
  fi
  mkdir -p "$CHROME/JS" "$CHROME/CSS"
  cp "$REPO/src/$MOD_JS" "$CHROME/JS/$MOD_JS"
  cp "$REPO/src/$MOD_CSS" "$CHROME/CSS/$MOD_CSS"
  say "Copied $MOD_JS to chrome/JS and $MOD_CSS to chrome/CSS"
  if $clear_cache; then
    rm -rf "$STARTUP_CACHE"
    say "Cleared the startup cache. Start Zen to load the mod."
  else
    restart_hint
  fi
}

cmd_remove() {
  check_paths
  rm -f "$CHROME/JS/$MOD_JS" "$CHROME/CSS/$MOD_CSS"
  say "Removed the mod files."
  restart_hint
}

cmd_remove_loader() {
  check_paths
  ensure_fxac_source
  local dest src kept=()
  while IFS='|' read -r dest src; do
    if [[ ! -e "$dest" ]]; then
      continue
    elif cmp -s "$dest" "$src"; then
      rm -f "$dest"
    else
      kept+=("$dest")
    fi
  done < <(loader_files)
  rmdir "$CHROME/utils" 2>/dev/null || true
  say "Removed the unchanged fx-autoconfig files."
  if (( ${#kept[@]} )); then
    say "Kept these (changed, or not installed by this script):"
    printf '  %s\n' "${kept[@]}"
  fi
  if [[ -d "$CHROME/utils" ]]; then
    say "chrome/utils has other files in it, so it was left alone."
  fi
  restart_hint
}

case "${1:-mod}" in
  status) cmd_status ;;
  loader) cmd_loader ;;
  mod) shift || true; cmd_mod "${1:-}" ;;
  remove) cmd_remove ;;
  remove-loader) cmd_remove_loader ;;
  *) die "unknown command: $1 (see the top of $0)" ;;
esac
