import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const FIXTURE = dirname(fileURLToPath(import.meta.url));
export const EXPECTED = Object.freeze({
  '@deepseek-ai/dsh': '0.1.1-rc.2',
  '@deepseek-ai/cordis': '4.0.1',
  '@deepseek-ai/cordis-plugin-group': '1.0.1',
  '@deepseek-ai/cordis-plugin-hmr': '1.0.16',
  '@deepseek-ai/cordis-plugin-include': '1.0.6',
  '@deepseek-ai/cordis-plugin-loader': '1.0.2',
  '@deepseek-ai/cordis-plugin-logger-console': '1.0.1',
  '@deepseek-ai/cordis-plugin-timer': '1.1.3',
  '@deepseek-ai/cosmokit': '1.8.2',
  '@deepseek-ai/schemastery': '3.18.1',
  react: '18.2.0',
  'react-dom': '18.2.0',
});
// These services must resolve from the Profile for the CLI's post-boot watcher.
// Other fixture packages are checked when the Profile or a real consumer uses
// them; CLI fallback links only its own dependency/peer closure.
export const PROFILE_REQUIRED = Object.freeze([
  '@deepseek-ai/cordis',
  '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/cordis-plugin-hmr',
  '@deepseek-ai/cordis-plugin-timer',
]);
const json = filename => JSON.parse(readFileSync(filename, 'utf8'));
const sha256 = filename => createHash('sha256').update(readFileSync(filename)).digest('hex');

export function assertPinned(name, version) {
  if (EXPECTED[name]) assert.equal(version, EXPECTED[name], `legacy runtime drift: ${name}`);
  if (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) {
    assert.equal(version, '0.1.1-rc.2', `mixed legacy DSH release: ${name}`);
  }
}

export function assertLockClosure(lock) {
  function resolveRecord(parent, name) {
    while (true) {
      const candidate = `${parent ? `${parent}/` : ''}node_modules/${name}`;
      if (lock.packages[candidate]) return lock.packages[candidate];
      if (!parent) return undefined;
      const index = parent.lastIndexOf('/node_modules/');
      parent = index === -1 ? '' : parent.slice(0, index);
    }
  }
  for (const [parent, record] of Object.entries(lock.packages)) {
    const required = { ...record.dependencies, ...record.optionalDependencies };
    for (const [name, spec] of Object.entries(record.peerDependencies ?? {})) {
      if (!record.peerDependenciesMeta?.[name]?.optional) required[name] = spec;
    }
    for (const name of Object.keys(required)) {
      assert.ok(resolveRecord(parent, name), `lock omits dependency ${name} required by ${parent || 'fixture root'} (including other-platform optional packages)`);
    }
  }
}

export function resolvePackage(from, name) {
  const require = createRequire(from);
  let manifest;
  try {
    manifest = require.resolve(`${name}/package.json`);
  } catch {
    let directory = dirname(require.resolve(name));
    while (true) {
      const candidate = join(directory, 'package.json');
      if (existsSync(candidate) && json(candidate).name === name) {
        manifest = candidate;
        break;
      }
      const parent = dirname(directory);
      assert.notEqual(parent, directory, `cannot find manifest for ${name} from ${from}`);
      directory = parent;
    }
  }
  const metadata = json(manifest);
  assert.equal(metadata.name, name, `unexpected package for ${name}`);
  return { name, version: metadata.version, manifest: realpathSync(manifest), metadata };
}

// npm's real installation, including nested dependency instances. Symlinked
// profile packages are followed once; hidden pnpm internals are not treated as
// additional Node resolution roots.
export function installedPackages(nodeModules) {
  const result = [];
  const visited = new Set();
  function packageAt(directory) {
    const filename = join(directory, 'package.json');
    if (!existsSync(filename)) return;
    const canonical = realpathSync(filename);
    if (visited.has(canonical)) return;
    visited.add(canonical);
    const metadata = json(canonical);
    result.push({ name: metadata.name, version: metadata.version, manifest: canonical, installedPath: directory, metadata });
    modulesAt(join(directory, 'node_modules'));
  }
  function modulesAt(directory) {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const child = join(directory, entry.name);
      if (entry.name.startsWith('@')) {
        for (const scoped of readdirSync(child, { withFileTypes: true })) packageAt(join(child, scoped.name));
      } else packageAt(child);
    }
  }
  modulesAt(nodeModules);
  return result.sort((a, b) => a.installedPath.localeCompare(b.installedPath));
}

export function assertResolutionIdentity(name, actual, expected) {
  assertPinned(name, actual.version);
  assert.equal(actual.manifest, expected.manifest, `duplicate or shadow host instance: ${name}`);
}

export function assertHmrReady(ctx) {
  assert.ok(ctx.get('hmr'), 'awaited HMR creation returned before the HMR service was available');
  assert.equal(typeof ctx.get('hmr').registerConfig, 'function', 'legacy registerConfig API is missing');
}

export async function cleanupGuardResources(operations) {
  const errors = [];
  for (const operation of operations) {
    try { await operation(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'legacy guard cleanup failed');
}

export function inspectConsumerDependencies(consumer, scope, roots, resolutions) {
  const declared = { ...consumer.metadata.dependencies, ...consumer.metadata.peerDependencies };
  for (const name of [...roots.keys()].filter(name => name in declared)) {
    const actual = resolvePackage(consumer.manifest, name);
    assertResolutionIdentity(name, actual, roots.get(name));
    resolutions.push({ scope, consumer: consumer.name, dependency: name, version: actual.version, manifest: actual.manifest });
  }
}

export function inspectProfileDependencies(profile, roots, resolutions = []) {
  const profileManifest = resolve(profile, 'package.json');
  const profileMetadata = json(profileManifest);
  const profileInventory = installedPackages(resolve(profile, 'node_modules'));
  const fallbackInventory = installedPackages(resolve(profile, '..', 'node_modules'));
  for (const name of PROFILE_REQUIRED) {
    const actual = resolvePackage(profileManifest, name);
    assertResolutionIdentity(name, actual, roots.get(name));
    resolutions.push({ scope: 'profile-root', consumer: profileMetadata.name, dependency: name, version: actual.version, manifest: actual.manifest });
  }
  inspectConsumerDependencies({ name: profileMetadata.name, manifest: profileManifest, metadata: profileMetadata }, 'profile-manifest', roots, resolutions);
  for (const [scope, inventory] of [['profile', profileInventory], ['profile-fallback', fallbackInventory]]) {
    for (const consumer of inventory) {
      assertPinned(consumer.name, consumer.version);
      if (roots.has(consumer.name)) assertResolutionIdentity(consumer.name, consumer, roots.get(consumer.name));
      inspectConsumerDependencies(consumer, scope, roots, resolutions);
    }
  }
  for (const name of ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-app-boot']) {
    const actual = resolvePackage(profileManifest, name);
    assertResolutionIdentity(name, actual, roots.get(name));
  }
  return { manifest: profileManifest, packageCount: profileInventory.length, fallbackPackageCount: fallbackInventory.length, bundles: profileMetadata.dsh?.profile?.bundles ?? [], requiredRootPackages: PROFILE_REQUIRED };
}

export async function runGuard({ profile } = {}) {
  assert.ok(process.execArgv.includes('--expose-internals'), 'run guard with node --expose-internals');
  const manifestFile = join(FIXTURE, 'package.json');
  const lockFile = join(FIXTURE, 'package-lock.json');
  const manifest = json(manifestFile);
  const lock = json(lockFile);
  assert.equal(lock.lockfileVersion, 3);
  assertLockClosure(lock);
  for (const [name, version] of Object.entries(EXPECTED)) {
    assert.equal(manifest.dependencies[name], version, `fixture must pin ${name}`);
    assert.equal(lock.packages[''].dependencies[name], version, `lock root must pin ${name}`);
  }
  for (const [path, record] of Object.entries(lock.packages)) {
    if (!path) continue;
    const name = record.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    assertPinned(name, record.version);
    assert.ok(record.integrity && record.resolved, `unsealed lock entry: ${path}`);
    if (!record.optional) assert.ok(existsSync(join(FIXTURE, path, 'package.json')), `required locked package is missing: ${path}`);
  }
  const inventory = installedPackages(join(FIXTURE, 'node_modules'));
  assert.ok(inventory.length > Object.keys(EXPECTED).length, 'complete CLI runtime has not been installed');
  for (const pkg of inventory) {
    const key = relative(FIXTURE, pkg.installedPath).split(sep).join('/');
    assert.ok(lock.packages[key], `installed package is absent from lock: ${key}`);
    assert.equal(pkg.version, lock.packages[key].version, `installed package differs from lock: ${key}`);
    assertPinned(pkg.name, pkg.version);
  }
  const hostNames = Object.keys(manifest.dependencies).filter(name => name.startsWith('@deepseek-ai/') || name in EXPECTED);
  const roots = new Map(hostNames.map(name => [name, resolvePackage(manifestFile, name)]));
  for (const pkg of inventory.filter(pkg => hostNames.includes(pkg.name))) assertResolutionIdentity(pkg.name, pkg, roots.get(pkg.name));
  const resolutions = [];
  const inspectConsumer = (consumer, scope) => inspectConsumerDependencies(consumer, scope, roots, resolutions);
  for (const consumer of inventory) inspectConsumer(consumer, 'fixture');
  for (const name of ['@deepseek-ai/dsh', '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-app-boot']) {
    const consumer = resolvePackage(manifestFile, name);
    assertPinned(name, consumer.version);
    inspectConsumer(consumer, 'entry-point');
  }
  const profileReport = profile ? inspectProfileDependencies(profile, roots, resolutions) : undefined;

  // Resolve from the actual CLI entry, rather than from a separate mini-tree.
  const cliEntry = join(dirname(roots.get('@deepseek-ai/dsh').manifest), 'lib', 'bin.js');
  const cliRequire = createRequire(cliEntry);
  const { Context } = await import(pathToFileURL(cliRequire.resolve('@deepseek-ai/cordis')).href);
  const { default: Loader } = await import(pathToFileURL(cliRequire.resolve('@deepseek-ai/cordis-plugin-loader')).href);
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-legacy-hmr-guard-'));
  const ctx = new Context();
  let disposeConfig;
  let executionError;
  const hmr = { immediatelyAvailable: false, registerConfigType: 'undefined', configRegistrationDisposed: false, contextDisposed: false, scratchRemoved: false };
  try {
    ctx.baseUrl = pathToFileURL(cliEntry).href;
    await ctx.plugin(Loader);
    await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-timer' });
    await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-hmr', config: { root: [] } });
    hmr.immediatelyAvailable = ctx.get('hmr') !== undefined;
    hmr.registerConfigType = typeof ctx.get('hmr')?.registerConfig;
    assertHmrReady(ctx);
    const configFile = join(scratch, 'cordis.patch.yml');
    await writeFile(configFile, '[]\n');
    disposeConfig = await ctx.get('hmr').registerConfig(configFile, () => {});
    assert.equal(typeof disposeConfig, 'function', 'registerConfig did not return a disposer');
    await disposeConfig();
    disposeConfig = undefined;
    hmr.configRegistrationDisposed = true;
  } catch (error) {
    executionError = error;
    throw error;
  } finally {
    try {
      await cleanupGuardResources([
        async () => { await disposeConfig?.(); },
        async () => { await ctx.fiber.dispose(); hmr.contextDisposed = true; },
        async () => { await rm(scratch, { recursive: true, force: true }); hmr.scratchRemoved = !existsSync(scratch); },
      ]);
    } catch (cleanupError) {
      if (executionError) throw new AggregateError([executionError, cleanupError], 'legacy guard execution and cleanup failed');
      throw cleanupError;
    }
  }
  return {
    status: 'PASS',
    kind: 'legacy-runtime-and-hmr-contract',
    node: process.version,
    platform: process.platform,
    fixture: FIXTURE,
    manifestSha256: sha256(manifestFile),
    lockSha256: sha256(lockFile),
    cliEntry,
    installedPackageCount: inventory.length,
    lockPackageCount: Object.keys(lock.packages).length - 1,
    installedPackages: inventory.map(({ name, version, manifest }) => ({ name, version, manifest })),
    hostFamily: Object.fromEntries([...roots].map(([name, pkg]) => [name, { version: pkg.version, manifest: pkg.manifest }])),
    resolutions,
    profile: profileReport,
    hmr,
    fullBrowserMountVerified: false,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    assert.ok(['--profile', '--output'].includes(args[index]), `unknown option: ${args[index]}`);
    assert.ok(args[index + 1], `missing value for ${args[index]}`);
    options[args[index].slice(2)] = args[index + 1];
  }
  let report;
  try {
    report = await runGuard(options);
  } catch (error) {
    report = { status: 'FAIL', kind: 'legacy-runtime-and-hmr-contract', node: process.version, error: { message: error.message, stack: error.stack } };
    process.exitCode = 1;
  }
  if (options.output) {
    const filename = resolve(options.output);
    mkdirSync(dirname(filename), { recursive: true });
    writeFileSync(filename, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
