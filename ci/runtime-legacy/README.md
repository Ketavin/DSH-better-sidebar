# Frozen official CLI compatibility host

This private fixture runs the official `@deepseek-ai/dsh@0.1.1-rc.2` host. It is
not published or used to install production. The complete npm lock seals direct,
peer and transitive packages with exact versions and registry integrity hashes.
The nine Cordis family packages and the complete official DSH dependency/peer
closure are exact root dependencies. Cordis overrides and the frozen lock mean installing the old CLI
cannot silently select the newer Loader/HMR contracts or mix DSH releases.
React and React DOM are fixed to 18.2.0 to keep the old host's client peer
closure in one generation instead of resolving React 18 and 19 together.

From the repository root:

CI pins Node 22.19.0 and npm 10.9.3; use the same npm version for fixture
maintenance and tree diagnostics. npm 11 can incorrectly classify matching
shared dependency ranges in this old cyclic peer graph as invalid.

```sh
npm ci --prefix ci/runtime-legacy --no-audit --no-fund
node --test ci/runtime-legacy/guard.check.mjs
node --expose-internals ci/runtime-legacy/guard.mjs --output artifacts/legacy-runtime-before.json
export DSH_CMD="$PWD/ci/runtime-legacy/node_modules/.bin/dsh"
```

Use this exact executable in both mount lanes. Do not fall back to global `dsh`,
`npx`, `latest` or a fresh `npm install`. After the real CLI installs the packed
Sidebar into the scratch profile, before starting the web host, run:

```sh
node --expose-internals ci/runtime-legacy/guard.mjs \
  --profile "$DSH_HOME/profiles/web" \
  --output "$SCRATCH/legacy-runtime-after-install.json"
```

`--expose-internals` is required by the real Loader/HMR implementation. The
guard imports Cordis and Loader from the **actual CLI entry's resolution root**,
awaits Timer and HMR creation in the same order as the old CLI, and immediately
checks service availability and `registerConfig`. It also registers and disposes
an actual temporary config watcher. The context and owned temporary directory
are always cleaned up; the guard does not start DSH web or call model/tool APIs.

The report includes the full installed tree, lock SHA256, CLI path and each
Cordis resolution from every declaring package. All installed packages must
match the lock; all required lock packages must be installed. The lock must also
include every declared optional dependency for other platforms, even though
the current OS does not install it. DSH packages must
remain `0.1.1-rc.2`. Cordis-family resolutions must use one canonical instance,
not merely an equal version in a second directory. With `--profile`, the same
identity check covers the profile and its installed consumers, including
Sidebar's DSH peers (including Settings), plus base/web-app/app-boot. Missing fallback links, shadow packages or
newly resolved host peers therefore fail before browser acceptance.

The Profile root must resolve Cordis, Loader, HMR and Timer. Additional host
packages are required when declared by the Profile or an installed consumer.
Both the Profile's node_modules and its parent profiles/node_modules fallback
are inventoried to reject shadow host instances and check actual consumers.
The old CLI healer links only the actual CLI dependency/peer closure, so an
unused fixture-only package such as logger-console need not resolve from the
Profile root. If a consumer declares it, absence or a second instance still
fails; no missing actual dependency is silently skipped.

Sidebar's peer-only `dsh-client-ui-primitives` and `dsh-client-ui-slots` belong
to the browser face: official frontend 0.1.1-rc.2's compiled `dist` supplies
both in the static module table passed to `__ModuleLoader__.create`. Sidebar's
client factory and lazy chunks resolve them from that table, while its packed
Node host entry does not reference them. The guard records exactly those two
Sidebar web peers as `delegated-to-real-browser-mount`; it does not claim their
browser verification passed. The real mount and deep sweep must activate
Sidebar's `slots` injection, its primitives factory imports and rendered UI.
If either package is a declared host dependency, is referenced by Sidebar's
host artifact, or is requested by another Node consumer, ordinary Node
resolution and instance checks remain required. No extra fallback is injected.

The fixture has no profile lock for Sidebar's own installable dependencies.
The actual tarball install stays in the existing scratch-profile lane, with
automatic peer installation disabled; its host peer resolution is checked
afterward. This frozen host lane demonstrates old official-host compatibility.
It does not replace a second lane bound to the current candidate Core commit,
frozen Core lock, vendor sources and built artifact. An intentional vendor/API
change can still break compatibility and needs that current Core lane.

Update this manifest and lock together in a reviewed dependency change. Generate
the lock with **no existing fixture node_modules**; generating it from a Windows
installation can omit Linux native optional packages. Then
repeat the guard, empty-profile boot, packaged-plugin browser sweep and
aggregate double-mount on Linux Node 22. A guard pass alone is not proof of a
complete browser mount. CI must preserve failure reports and not skip original
browser assertions to make a dependency update appear successful.

`refresh-closure.mjs` is a maintenance helper, never an install/CI step. It reads
exact official package metadata, expands the DSH dependency/peer closure, and
records registry tarball integrity in `host-closure-source.json`. Regenerating
the closure does not validate compatibility; regenerate the npm lock and repeat
the full acceptance above before committing a change.
