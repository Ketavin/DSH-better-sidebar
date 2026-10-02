#!/usr/bin/env bash
# Shared host selection, evidence retention and owned-process cleanup for mount CI.
# Call after ROOT/say/warn/die have been defined by a mount entry point.

configure_mount_runtime() {
  DSH_RUNTIME_MODE="${DSH_RUNTIME_MODE:-legacy}"
  case "$DSH_RUNTIME_MODE" in
    legacy)
      DSH_RUNTIME_ROOT="${DSH_RUNTIME_ROOT:-$ROOT/ci/runtime-legacy}"
      DSH_CMD="${DSH_CMD:-$DSH_RUNTIME_ROOT/node_modules/.bin/dsh}"
      RUNTIME_GUARD="$DSH_RUNTIME_ROOT/guard.mjs"
      ;;
    core)
      [ -n "${DSH_RUNTIME_ROOT:-}" ] || die "Core lane requires DSH_RUNTIME_ROOT"
      [ -n "${DSH_CMD:-}" ] || die "Core lane requires an executable DSH_CMD wrapper"
      RUNTIME_GUARD="$DSH_RUNTIME_ROOT/scripts/verify-sidebar-mount-host.mjs"
      ;;
    *) die "Unknown DSH_RUNTIME_MODE: $DSH_RUNTIME_MODE" ;;
  esac
  command -v "$DSH_CMD" >/dev/null 2>&1 || die "Missing declared CLI: $DSH_CMD (no automatic download; install the frozen fixture or supply a candidate wrapper)"
  [ -f "$RUNTIME_GUARD" ] || die "Missing runtime guard: $RUNTIME_GUARD"
  ARTIFACT_DIR="${DSH_MOUNT_ARTIFACTS:-$ROOT/mount-artifacts/$DSH_RUNTIME_MODE}/$MOUNT_LANE"
  mkdir -p "$ARTIFACT_DIR"
  guard_mount_runtime host
}

guard_mount_runtime() {
  local stage="$1"
  local args=(--output "$ARTIFACT_DIR/$stage-runtime.json")
  if [ "$DSH_RUNTIME_MODE" = core ]; then args+=(--core "$DSH_RUNTIME_ROOT"); fi
  if [ -n "${PROFILE_DIR:-}" ]; then args+=(--profile "$PROFILE_DIR"); fi
  local code=0
  node --expose-internals "$RUNTIME_GUARD" "${args[@]}" > "$ARTIFACT_DIR/$stage-guard.log" 2>&1 || code=$?
  if [ "$code" -eq 0 ]; then
    say "Runtime guard passed: $stage ($ARTIFACT_DIR/$stage-runtime.json)"
  else
    tail -40 "$ARTIFACT_DIR/$stage-guard.log" >&2
  fi
  return "$code"
}

record_mount_tarball() {
  node -e '
    const fs = require("node:fs");
    const crypto = require("node:crypto");
    const path = fs.realpathSync(process.argv[1]);
    const bytes = fs.readFileSync(path);
    fs.writeFileSync(process.argv[2], JSON.stringify({
      path, bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex")
    }, null, 2) + "\n");
  ' "$TARBALL" "$ARTIFACT_DIR/tarball.json"
}

install_mount_plugin() {
  local stage="$1"
  local tarball="$2"
  local code=0
  "$DSH_CMD" plugin --profile web add "file:$tarball" > "$ARTIFACT_DIR/$stage-install.log" 2>&1 || code=$?
  cat "$ARTIFACT_DIR/$stage-install.log"
  [ "$code" -eq 0 ] || return "$code"
  guard_mount_runtime "$stage"
}

save_mount_evidence() {
  local code="$1"
  local failed=0
  if [ -n "${LOG_DIR:-}" ] && [ -d "$LOG_DIR" ]; then
    for file in "$LOG_DIR"/*.log; do
      [ -f "$file" ] || continue
      cp "$file" "$ARTIFACT_DIR/$(basename "$file")" || failed=1
    done
  fi
  if [ -n "${PROFILE_DIR:-}" ]; then
    for name in package.json pnpm-lock.yaml pnpm-workspace.yaml cordis.patch.yml; do
      [ ! -f "$PROFILE_DIR/$name" ] || cp "$PROFILE_DIR/$name" "$ARTIFACT_DIR/profile-$name" || failed=1
    done
  fi
  if [ "$failed" -ne 0 ] && [ "$code" -eq 0 ]; then code=1; fi
  printf '{"lane":"%s","runtime":"%s","exitCode":%s}\n' "$MOUNT_LANE" "$DSH_RUNTIME_MODE" "$code" > "$ARTIFACT_DIR/result.json" || failed=1
  return "$failed"
}

mount_server_origin() {
  node -e 'process.stdout.write(new URL(process.argv[1]).origin)' "$MOUNT_URL"
}

start_mount_server() {
  local log="$1"
  # A new session allows Linux CI to reap only this scratch host and its PTYs.
  SERVER_GROUP=""
  if command -v setsid >/dev/null 2>&1; then
    setsid "$DSH_CMD" web --port "$PORT" > "$log" 2>&1 &
    SERVER_PID=$!
    SERVER_GROUP="$SERVER_PID"
  else
    "$DSH_CMD" web --port "$PORT" > "$log" 2>&1 &
    SERVER_PID=$!
  fi
  MOUNT_URL=""
  for _ in $(seq 1 120); do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      tail -40 "$log" >&2 || true
      die "Scratch dsh web exited before readiness"
    fi
    MOUNT_URL="$(grep -oE 'dsh web: http://127\.0\.0\.1:[0-9]+[^[:space:]]*' "$log" | head -1 | awk '{print $3}' || true)"
    [ -z "$MOUNT_URL" ] || return 0
    sleep 1
  done
  tail -40 "$log" >&2 || true
  die "Scratch dsh web did not become ready within 120s"
}

stop_mount_server() {
  [ -n "${SERVER_PID:-}" ] || return 0
  local target="$SERVER_PID"
  if [ -n "${SERVER_GROUP:-}" ]; then target="-$SERVER_GROUP"; fi
  kill -TERM -- "$target" 2>/dev/null || true
  for _ in $(seq 1 100); do
    kill -0 -- "$target" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 -- "$target" 2>/dev/null; then kill -KILL -- "$target" 2>/dev/null || true; fi
  wait "$SERVER_PID" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 -- "$target" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 -- "$target" 2>/dev/null; then
    warn "Owned scratch process group remained after cleanup: $target"
    return 1
  fi
  SERVER_PID=""
  SERVER_GROUP=""
}
