#!/usr/bin/env bash

set -o pipefail
shopt -s nullglob dotglob

SOURCE_ROOT=$1
TARGET_ROOT=$2
SETUP=$3
REQUIRES_GLOBSTAR=$4
COPY_TAG=$5
SYMLINK_TAG=$6
HARDLINK_TAG=$7
MISSING_TAG=$8
SETUP_TAG=$9
shift 9

COPY_COUNT=$1
shift
COPY_PATTERNS=("${@:1:COPY_COUNT}")
shift "$COPY_COUNT"
SYMLINK_COUNT=$1
shift
SYMLINK_PATTERNS=("${@:1:SYMLINK_COUNT}")
shift "$SYMLINK_COUNT"
HARDLINK_COUNT=$1
shift
HARDLINK_PATTERNS=("${@:1:HARDLINK_COUNT}")
shift "$HARDLINK_COUNT"
EXCLUDE_COUNT=$1
shift
EXCLUDE_PATTERNS=("${@:1:EXCLUDE_COUNT}")

if [ "$REQUIRES_GLOBSTAR" -eq 1 ]; then
  shopt -s globstar || exit 1
fi

SETUP_LOG=

cleanup() {
  if [ -n "$SETUP_LOG" ]; then rm -f -- "$SETUP_LOG"; fi
}
trap cleanup EXIT

die() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

path_exists() {
  [ -e "$1" ] || [ -L "$1" ]
}

has_git_segment() {
  case "/$1/" in */.git/*) return 0 ;; esac
  return 1
}

validate_rel() {
  local rel="$1"
  [ -n "$rel" ] || die "bootstrap path must not be empty"
  case "$rel" in
    ".") die "bootstrap path must not target repo root: $rel" ;;
    /*) die "bootstrap path must be relative: $rel" ;;
    ".." | ../* | */.. | */../*) die "bootstrap path escapes repo root: $rel" ;;
  esac
  if has_git_segment "$rel"; then die "bootstrap path must not target .git: $rel"; fi
}

normalize_rel() {
  REL="${1//\\//}"
  while [[ "$REL" == */ ]]; do REL="${REL%/}"; done
  [ -n "$REL" ] || REL="."
  validate_rel "$REL"
}

rel_from_source_match() {
  local match="$1" prefix="$SOURCE_ROOT/"
  case "$match" in
    "$prefix"*) REL="${match:${#prefix}}" ;;
    "$SOURCE_ROOT") REL="." ;;
    *) die "bootstrap path escapes repo root: $match" ;;
  esac
  REL="${REL//\\//}"
  while [[ "$REL" == */ ]]; do REL="${REL%/}"; done
  [ -n "$REL" ] || REL="."
  if has_git_segment "$REL"; then return 1; fi
  normalize_rel "$REL"
}

source_path_for_rel() {
  SRC="$SOURCE_ROOT/$1"
}

target_path_for_rel() {
  DST="$TARGET_ROOT/$1"
}

source_parent_has_symlink() {
  local rel="$1" current="$SOURCE_ROOT" segment parent_rel i j
  local -a parts
  IFS=/ read -r -a parts <<<"$rel"
  for ((i = 0; i < ${#parts[@]} - 1; i += 1)); do
    segment="${parts[$i]}"
    [ -n "$segment" ] || continue
    current="$current/$segment"
    if [ -L "$current" ]; then
      parent_rel="${parts[0]}"
      for ((j = 1; j <= i; j += 1)); do parent_rel="$parent_rel/${parts[$j]}"; done
      SYMLINK_PARENT="$parent_rel"
      return 0
    fi
  done
  return 1
}

target_parent_has_symlink() {
  local rel="$1" current="$TARGET_ROOT" segment parent_rel i j
  local -a parts
  IFS=/ read -r -a parts <<<"$rel"
  for ((i = 0; i < ${#parts[@]} - 1; i += 1)); do
    segment="${parts[$i]}"
    [ -n "$segment" ] || continue
    current="$current/$segment"
    if [ -L "$current" ]; then
      parent_rel="${parts[0]}"
      for ((j = 1; j <= i; j += 1)); do parent_rel="$parent_rel/${parts[$j]}"; done
      SYMLINK_PARENT="$parent_rel"
      return 0
    fi
  done
  return 1
}

is_dynamic_pattern() {
  case "$1" in *\** | *\?* | *\[*) return 0 ;; *) return 1 ;; esac
}

collect_matches() {
  local pattern="$1" old_ifs
  MATCHES=()
  old_ifs=$IFS
  IFS=
  MATCHES=("$SOURCE_ROOT"/$pattern)
  IFS=$old_ifs
}

contains_path() {
  local needle="$1" item
  shift || true
  for item in "$@"; do
    if [ "$item" = "$needle" ]; then return 0; fi
  done
  return 1
}

append_missing() {
  contains_path "$1" "${MISSING_PATHS[@]}" || MISSING_PATHS+=("$1")
}

append_excluded() {
  contains_path "$1" "${EXCLUDED_PATHS[@]}" || EXCLUDED_PATHS+=("$1")
}

append_mode_path() {
  local mode="$1" rel="$2"
  case "$mode" in
    copy) contains_path "$rel" "${COPY_PATHS[@]}" || COPY_PATHS+=("$rel") ;;
    symlink) contains_path "$rel" "${SYMLINK_PATHS[@]}" || SYMLINK_PATHS+=("$rel") ;;
    hardlink) contains_path "$rel" "${HARDLINK_PATHS[@]}" || HARDLINK_PATHS+=("$rel") ;;
    *) die "unknown bootstrap mode: $mode" ;;
  esac
}

append_ready_path() {
  local mode="$1" rel="$2"
  case "$mode" in
    copy) READY_COPY_PATHS+=("$rel") ;;
    symlink) READY_SYMLINK_PATHS+=("$rel") ;;
    hardlink) READY_HARDLINK_PATHS+=("$rel") ;;
    *) die "unknown bootstrap mode: $mode" ;;
  esac
}

is_excluded() {
  local rel="$1" ex
  for ex in "${EXCLUDED_PATHS[@]}"; do
    if [ "$rel" = "$ex" ] || [[ "$rel" = "$ex/"* ]]; then return 0; fi
  done
  return 1
}

EXCLUDED_PATHS=()
COPY_PATHS=()
SYMLINK_PATHS=()
HARDLINK_PATHS=()
MISSING_PATHS=()
READY_COPY_PATHS=()
READY_SYMLINK_PATHS=()
READY_HARDLINK_PATHS=()

for pattern in "${EXCLUDE_PATTERNS[@]}"; do
  normalize_rel "$pattern"
  pattern="$REL"
  collect_matches "$pattern"
  for match in "${MATCHES[@]}"; do
    path_exists "$match" || continue
    if ! rel_from_source_match "$match"; then continue; fi
    rel="$REL"
    append_excluded "$rel"
  done
done

process_patterns() {
  local mode="$1"
  shift
  local patterns=("$@")
  local pattern match rel is_dynamic
  for pattern in "${patterns[@]}"; do
    normalize_rel "$pattern"
    pattern="$REL"
    if is_dynamic_pattern "$pattern"; then is_dynamic=1; else is_dynamic=0; fi
    collect_matches "$pattern"
    if [ "${#MATCHES[@]}" -eq 0 ] && [ "$is_dynamic" -eq 0 ]; then
      append_missing "$pattern"
      continue
    fi
    for match in "${MATCHES[@]}"; do
      if ! path_exists "$match"; then
        if [ "$is_dynamic" -eq 0 ]; then append_missing "$pattern"; fi
        continue
      fi
      if ! rel_from_source_match "$match"; then continue; fi
      rel="$REL"
      append_mode_path "$mode" "$rel"
    done
  done
}

process_patterns copy "${COPY_PATTERNS[@]}"
process_patterns symlink "${SYMLINK_PATTERNS[@]}"
process_patterns hardlink "${HARDLINK_PATTERNS[@]}"

filter_excluded_paths() {
  local mode="$1" rel
  FILTERED_PATHS=()
  case "$mode" in
    copy)
      for rel in "${COPY_PATHS[@]}"; do is_excluded "$rel" || FILTERED_PATHS+=("$rel"); done
      COPY_PATHS=("${FILTERED_PATHS[@]}")
      ;;
    symlink)
      for rel in "${SYMLINK_PATHS[@]}"; do is_excluded "$rel" || FILTERED_PATHS+=("$rel"); done
      SYMLINK_PATHS=("${FILTERED_PATHS[@]}")
      ;;
    hardlink)
      for rel in "${HARDLINK_PATHS[@]}"; do is_excluded "$rel" || FILTERED_PATHS+=("$rel"); done
      HARDLINK_PATHS=("${FILTERED_PATHS[@]}")
      ;;
    *) die "unknown bootstrap mode: $mode" ;;
  esac
}

filter_excluded_paths copy
filter_excluded_paths symlink
filter_excluded_paths hardlink

for rel in "${COPY_PATHS[@]}"; do
  if contains_path "$rel" "${SYMLINK_PATHS[@]}" || contains_path "$rel" "${HARDLINK_PATHS[@]}"; then
    die "path matches multiple materialization modes: $rel"
  fi
done
for rel in "${SYMLINK_PATHS[@]}"; do
  if contains_path "$rel" "${HARDLINK_PATHS[@]}"; then
    die "path matches multiple materialization modes: $rel"
  fi
done

preflight_mode() {
  local mode="$1" rel src dst
  shift
  for rel in "$@"; do
    source_path_for_rel "$rel"
    src="$SRC"
    target_path_for_rel "$rel"
    dst="$DST"
    if ! path_exists "$src"; then append_missing "$rel"; continue; fi
    if source_parent_has_symlink "$rel"; then die "bootstrap path uses symlink parent: $SYMLINK_PARENT"; fi
    if target_parent_has_symlink "$rel"; then die "bootstrap target path uses symlink parent: $SYMLINK_PARENT"; fi
    if [ "$mode" = "hardlink" ] && { [ -L "$src" ] || [ ! -f "$src" ]; }; then
      die "hardlink source is not a file: $rel"
    fi
    if path_exists "$dst"; then die "destination already exists: $rel"; fi
    append_ready_path "$mode" "$rel"
  done
}

preflight_mode copy "${COPY_PATHS[@]}"
preflight_mode symlink "${SYMLINK_PATHS[@]}"
preflight_mode hardlink "${HARDLINK_PATHS[@]}"

ALL_PATHS=("${READY_COPY_PATHS[@]}" "${READY_SYMLINK_PATHS[@]}" "${READY_HARDLINK_PATHS[@]}")
for parent in "${ALL_PATHS[@]}"; do
  for child in "${ALL_PATHS[@]}"; do
    if [ "$parent" != "$child" ] && [[ "$child" == "$parent/"* ]]; then
      die "materialization paths overlap: $parent contains $child"
    fi
  done
done

directory_mode() {
  local path="$1" mode
  if ! mode="$(stat -c '%a' -- "$path" 2>/dev/null)"; then
    return 1
  fi
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || return 1
  printf '%s' "$mode"
}

copy_tree() {
  local rel="$1" src dst child child_name source_mode
  if is_excluded "$rel"; then return; fi
  if has_git_segment "$rel"; then return; fi
  source_path_for_rel "$rel"
  src="$SRC"
  target_path_for_rel "$rel"
  dst="$DST"
  if ! path_exists "$src"; then die "failed to copy $rel: source is missing"; fi
  if source_parent_has_symlink "$rel"; then die "bootstrap path uses symlink parent: $SYMLINK_PARENT"; fi
  if target_parent_has_symlink "$rel"; then die "bootstrap target path uses symlink parent: $SYMLINK_PARENT"; fi
  if path_exists "$dst"; then die "destination already exists: $rel"; fi
  if [ -d "$src" ] && [ ! -L "$src" ]; then
    source_mode="$(directory_mode "$src")" || die "failed to read directory permissions: $rel"
    mkdir -p -- "$dst" || die "failed to copy $rel"
    if ! chmod u+rwx "$dst"; then
      chmod "$source_mode" "$dst" 2>/dev/null || true
      die "failed to prepare directory permissions: $rel"
    fi
    if ! (
      for child in "$src"/*; do
        path_exists "$child" || continue
        child_name="${child##*/}"
        copy_tree "$rel/$child_name" || exit $?
      done
    ); then
      if ! chmod "$source_mode" "$dst"; then
        printf 'error: failed to restore directory permissions: %s\n' "$rel" >&2
      fi
      return 1
    fi
    chmod "$source_mode" "$dst" || die "failed to restore directory permissions: $rel"
    return
  fi
  mkdir -p -- "$(dirname "$dst")" || die "failed to copy $rel"
  if target_parent_has_symlink "$rel"; then die "bootstrap target path uses symlink parent: $SYMLINK_PARENT"; fi
  cp -P -- "$src" "$dst" || die "failed to copy $rel"
}

copy_item() {
  local rel="$1"
  copy_tree "$rel" || exit $?
  printf '%s\0%s\0' "$COPY_TAG" "$rel"
}

symlink_item() {
  local rel="$1" src dst
  source_path_for_rel "$rel"
  src="$SRC"
  target_path_for_rel "$rel"
  dst="$DST"
  if ! path_exists "$src"; then die "failed to symlink $rel: source is missing"; fi
  if source_parent_has_symlink "$rel"; then die "bootstrap path uses symlink parent: $SYMLINK_PARENT"; fi
  if target_parent_has_symlink "$rel"; then die "bootstrap target path uses symlink parent: $SYMLINK_PARENT"; fi
  if path_exists "$dst"; then die "destination already exists: $rel"; fi
  mkdir -p -- "$(dirname "$dst")" || die "failed to symlink $rel"
  if target_parent_has_symlink "$rel"; then die "bootstrap target path uses symlink parent: $SYMLINK_PARENT"; fi
  ln -s -- "$src" "$dst" || die "failed to symlink $rel"
  printf '%s\0%s\0' "$SYMLINK_TAG" "$rel"
}

hardlink_item() {
  local rel="$1" src dst
  source_path_for_rel "$rel"
  src="$SRC"
  target_path_for_rel "$rel"
  dst="$DST"
  if ! path_exists "$src"; then die "failed to hardlink $rel: source is missing"; fi
  if source_parent_has_symlink "$rel"; then die "bootstrap path uses symlink parent: $SYMLINK_PARENT"; fi
  if target_parent_has_symlink "$rel"; then die "bootstrap target path uses symlink parent: $SYMLINK_PARENT"; fi
  if [ -L "$src" ] || [ ! -f "$src" ]; then die "hardlink source is not a file: $rel"; fi
  if path_exists "$dst"; then die "destination already exists: $rel"; fi
  mkdir -p -- "$(dirname "$dst")" || die "failed to hardlink $rel"
  if target_parent_has_symlink "$rel"; then die "bootstrap target path uses symlink parent: $SYMLINK_PARENT"; fi
  ln -- "$src" "$dst" || die "failed to hardlink $rel"
  printf '%s\0%s\0' "$HARDLINK_TAG" "$rel"
}

# Publish missing paths only after the whole preflight succeeds. A preflight
# error has no materialization side effect, so partial planning observations
# are not a bootstrap completion summary.
for rel in "${MISSING_PATHS[@]}"; do
  printf '%s\0%s\0' "$MISSING_TAG" "$rel"
done
for rel in "${READY_COPY_PATHS[@]}"; do copy_item "$rel"; done
for rel in "${READY_SYMLINK_PATHS[@]}"; do symlink_item "$rel"; done
for rel in "${READY_HARDLINK_PATHS[@]}"; do hardlink_item "$rel"; done

if [ -n "$SETUP" ]; then
  SETUP_LOG="$(mktemp "${TMPDIR:-/tmp}/goblin-bootstrap-setup.XXXXXX")" || die "failed to create setup log"
  if ! (cd "$TARGET_ROOT" && "${SHELL:-/bin/sh}" -ilc "$SETUP") >"$SETUP_LOG" 2>&1; then
    printf 'error: setup failed: %s\n' "$SETUP" >&2
    tail -c 8192 "$SETUP_LOG" >&2 || true
    exit 1
  fi
  printf '%s\0%s\0' "$SETUP_TAG" "$SETUP"
fi
