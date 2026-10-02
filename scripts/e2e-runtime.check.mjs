import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const helper = fileURLToPath(new URL('./e2e-runtime.sh', import.meta.url));
const linux = process.platform === 'linux';

function withFixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-mount-runner-check-'));
  try {
    const runtime = join(root, 'runtime');
    mkdirSync(runtime);
    writeFileSync(join(runtime, 'guard.mjs'), 'process.stdout.write(JSON.stringify({status:"PASS"}));\n');
    const preamble = [
      'set -euo pipefail',
      'say() { printf "%s\\n" "$*"; }',
      'warn() { printf "%s\\n" "$*" >&2; }',
      'die() { printf "%s\\n" "$*" >&2; exit 1; }',
      'source "$HELPER"',
      'ROOT="$CASE_ROOT"',
      'MOUNT_LANE=check',
      'PROFILE_DIR=""',
    ].join('\n');
    run({ root, runtime, preamble, execute(script, environment = {}) {
      return spawnSync('bash', ['-c', `${preamble}\n${script}`], {
        encoding: 'utf8', timeout: 20_000,
        env: { ...process.env, DSH_RUNTIME_MODE: 'legacy', DSH_RUNTIME_ROOT: runtime,
          DSH_MOUNT_ARTIFACTS: join(root, 'artifacts'), HELPER: helper, CASE_ROOT: root, ...environment,
          PATH: `${dirname(process.execPath)}:${environment.PATH ?? process.env.PATH}` },
      });
    } });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('missing declared CLI fails without invoking a download fallback', { skip: !linux }, () => {
  withFixture(({ root, execute }) => {
    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'npx'), '#!/bin/sh\ntouch "$CASE_ROOT/download-attempt"\n', { mode: 0o755 });
    const result = execute('configure_mount_runtime', {
      DSH_CMD: join(root, 'missing-cli'), PATH: `${bin}:${process.env.PATH}`,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /no automatic download/);
    assert.equal(existsSync(join(root, 'download-attempt')), false);
  });
});

test('a launcher path containing spaces remains one executable', { skip: !linux }, () => {
  withFixture(({ root, execute }) => {
    const launcher = join(root, 'candidate cli');
    writeFileSync(launcher, '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
    const result = execute('configure_mount_runtime\n"$DSH_CMD" plugin --profile web add "file:/path with spaces/sidebar.tgz"', { DSH_CMD: launcher });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /file:\/path with spaces\/sidebar\.tgz/);
  });
});

test('unknown runtime mode fails before launching a host', { skip: !linux }, () => {
  withFixture(({ execute }) => {
    const result = execute('configure_mount_runtime', { DSH_RUNTIME_MODE: 'latest' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Unknown DSH_RUNTIME_MODE/);
  });
});

test('owned host cleanup stops its descendant and preserves the authentication URL', { skip: !linux }, () => {
  withFixture(({ root, execute }) => {
    const host = join(root, 'host.mjs');
    writeFileSync(host, `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
writeFileSync(process.env.CASE_ROOT + '/descendant.pid', String(child.pid));
const server = createServer((request, response) => response.end('path:' + request.url)).listen(0, '127.0.0.1', () => {
  process.stdout.write('dsh web: http://127.0.0.1:' + server.address().port + '/?token=scratch-test\\n');
});
process.on('SIGTERM', () => {
  child.kill('SIGTERM');
  child.once('exit', () => server.close(() => process.exit(0)));
});
`);
    const launcher = join(root, 'cli');
    writeFileSync(launcher, '#!/bin/sh\nexec "$NODE_EXECUTABLE" "$CASE_ROOT/host.mjs"\n', { mode: 0o755 });
    const result = execute([
      'configure_mount_runtime', 'PORT=0', 'LOG_DIR="$CASE_ROOT"',
      'trap stop_mount_server EXIT', 'start_mount_server "$CASE_ROOT/web.log"',
      'printf "%s\\n" "$MOUNT_URL"', 'origin="$(mount_server_origin)"',
      'curl --silent --fail --max-time 5 "$origin/sidebar/api/terminal.deps"',
      'stop_mount_server', 'save_mount_evidence 7',
    ].join('\n'), { DSH_CMD: launcher, NODE_EXECUTABLE: process.execPath });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\/\?token=scratch-test/);
    assert.match(result.stdout, /path:\/sidebar\/api\/terminal\.deps/);
    const pid = Number(readFileSync(join(root, 'descendant.pid'), 'utf8'));
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    const artifact = JSON.parse(readFileSync(join(root, 'artifacts/check/result.json'), 'utf8'));
    assert.equal(artifact.exitCode, 7);
    assert.equal(existsSync(join(root, 'artifacts/check/web.log')), true);
  });
});

test('an evidence copy failure cannot be hidden by the final result write', { skip: !linux }, () => {
  withFixture(({ root, execute }) => {
    const launcher = join(root, 'cli');
    writeFileSync(launcher, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const result = execute([
      'configure_mount_runtime', 'LOG_DIR="$CASE_ROOT/logs"', 'mkdir -p "$LOG_DIR"',
      'printf failure > "$LOG_DIR/web.log"',
      // A dangling destination link rejects the copy while result.json stays writable.
      'ln -s "$ARTIFACT_DIR/missing-parent/web.log" "$ARTIFACT_DIR/web.log"',
      'code=0', 'save_mount_evidence 0 || code=$?', 'exit "$code"',
    ].join('\n'), { DSH_CMD: launcher });
    assert.equal(result.status, 1, result.stderr);
    const artifact = JSON.parse(readFileSync(join(root, 'artifacts/check/result.json'), 'utf8'));
    assert.equal(artifact.exitCode, 1);
  });
});
