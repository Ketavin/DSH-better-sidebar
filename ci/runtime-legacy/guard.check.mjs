import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { EXPECTED, FIXTURE, assertHmrReady, assertLockClosure, assertPinned, assertResolutionIdentity, cleanupGuardResources, inspectProfileDependencies, resolvePackage } from './guard.mjs';

test('rejects the newer Loader/HMR API combination before mounting', () => {
  assert.throws(() => assertPinned('@deepseek-ai/cordis-plugin-loader', '1.0.5'), /legacy runtime drift/);
  assert.throws(() => assertPinned('@deepseek-ai/cordis-plugin-hmr', '1.0.19'), /legacy runtime drift/);
});

test('rejects mixed DSH releases in the legacy dependency closure', () => {
  assertPinned('@deepseek-ai/dsh-app-boot', '0.1.1-rc.2');
  assert.throws(() => assertPinned('@deepseek-ai/dsh-web-app', '0.2.0-rc.2'), /mixed legacy DSH release/);
});

test('rejects React 19 from automatic peer resolution in the React 18 host', () => {
  assert.throws(() => assertPinned('react', '19.3.0'), /legacy runtime drift/);
  assert.throws(() => assertPinned('react-dom', '19.3.0'), /legacy runtime drift/);
});

test('rejects a separate Cordis instance even when versions match', () => {
  assert.throws(() => assertResolutionIdentity('@deepseek-ai/cordis', { version: '4.0.1', manifest: '/profile/cordis/package.json' }, { manifest: '/fixture/cordis/package.json' }), /duplicate or shadow host instance/);
});

test('requires immediate HMR availability and the legacy config watch API', () => {
  assert.throws(() => assertHmrReady({ get: () => undefined }), /returned before/);
  assert.throws(() => assertHmrReady({ get: () => ({}) }), /registerConfig API is missing/);
  assertHmrReady({ get: () => ({ registerConfig() {} }) });
});

test('rejects a shadow same-version Settings package used by instanceof consumers', () => {
  assert.throws(() => assertResolutionIdentity('@deepseek-ai/dsh-settings', { version: '0.1.1-rc.2', manifest: '/profile/settings/package.json' }, { manifest: '/fixture/settings/package.json' }), /duplicate or shadow host instance/);
});

test('always disposes the context and scratch after config disposer errors', async () => {
  const attempts = [];
  await assert.rejects(cleanupGuardResources([
    async () => { attempts.push('config'); throw new Error('config disposal failed'); },
    async () => { attempts.push('context'); },
    async () => { attempts.push('scratch'); },
  ]), /legacy guard cleanup failed/);
  assert.deepEqual(attempts, ['config', 'context', 'scratch']);
});

test('rejects lock regeneration that omits another platform native dependency', () => {
  const lock = { packages: {
    '': { dependencies: { sharp: '1.0.0' } },
    'node_modules/sharp': { optionalDependencies: { 'sharp-linux': '1.0.0', 'sharp-win': '1.0.0' } },
    'node_modules/sharp-win': { version: '1.0.0' },
  } };
  assert.throws(() => assertLockClosure(lock), /omits dependency sharp-linux/);
  lock.packages['node_modules/sharp-linux'] = { version: '1.0.0' };
  assertLockClosure(lock);
});

// Use the published CLI's own fallback healer in a home outside the fixture's
// ancestors, so Node cannot accidentally find extra fixture packages directly.
async function withNativeProfile(check) {
  const fixtureManifest = join(FIXTURE, 'package.json');
  const manifest = JSON.parse(readFileSync(fixtureManifest, 'utf8'));
  const names = Object.keys(manifest.dependencies).filter(name => name.startsWith('@deepseek-ai/') || name in EXPECTED);
  const roots = new Map(names.map(name => [name, resolvePackage(fixtureManifest, name)]));
  const { healProfilesModuleFallback } = await import(pathToFileURL(join(dirname(roots.get('@deepseek-ai/dsh-app-boot').manifest), 'lib', 'index.js')).href);
  const home = await mkdtemp(join(tmpdir(), 'dsh-legacy-profile-check-'));
  const profile = join(home, 'profiles', 'web');
  const metadata = { name: 'native-legacy-profile-check', private: true, dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } };
  try {
    await mkdir(profile, { recursive: true });
    await writeFile(join(profile, 'package.json'), `${JSON.stringify(metadata)}\n`);
    healProfilesModuleFallback(roots.get('@deepseek-ai/dsh').manifest, home);
    await check({ home, profile, metadata, roots });
  } finally {
    assert.equal(dirname(home), tmpdir());
    assert.ok(basename(home).startsWith('dsh-legacy-profile-check-'));
    await rm(home, { recursive: true, force: true });
  }
}

test('real CLI fallback passes when unused fixture logger is not linked', async () => {
  await withNativeProfile(async ({ profile, roots }) => {
    assert.throws(() => resolvePackage(join(profile, 'package.json'), '@deepseek-ai/cordis-plugin-logger-console'), /Cannot find module/);
    const resolutions = [];
    const report = inspectProfileDependencies(profile, roots, resolutions);
    assert.ok(report.fallbackPackageCount > 100);
    assert.ok(resolutions.some(item => item.scope === 'profile-fallback' && item.dependency === '@deepseek-ai/dsh-settings'));
  });
});

test('real CLI fallback with missing critical HMR is rejected', async () => {
  await withNativeProfile(async ({ home, profile, roots }) => {
    await unlink(join(home, 'profiles', 'node_modules', '@deepseek-ai', 'cordis-plugin-hmr'));
    assert.throws(() => inspectProfileDependencies(profile, roots), /Cannot find module.*cordis-plugin-hmr/);
  });
});

test('unused logger becomes mandatory if the Profile declares it', async () => {
  await withNativeProfile(async ({ profile, metadata, roots }) => {
    metadata.dependencies['@deepseek-ai/cordis-plugin-logger-console'] = '1.0.1';
    await writeFile(join(profile, 'package.json'), `${JSON.stringify(metadata)}\n`);
    assert.throws(() => inspectProfileDependencies(profile, roots), /Cannot find module.*logger-console/);
  });
});

test('missing logger declared by an installed consumer is rejected', async () => {
  await withNativeProfile(async ({ profile, roots }) => {
    const consumer = join(profile, 'node_modules', 'guard-consumer');
    await mkdir(consumer, { recursive: true });
    await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'guard-consumer', version: '1.0.0', peerDependencies: { '@deepseek-ai/cordis-plugin-logger-console': '1.0.1' } }));
    assert.throws(() => inspectProfileDependencies(profile, roots), /Cannot find module.*logger-console/);
  });
});

test('same-version Settings shadow in the Profile is rejected', async () => {
  await withNativeProfile(async ({ profile, roots }) => {
    const shadow = join(profile, 'node_modules', '@deepseek-ai', 'dsh-settings');
    await mkdir(shadow, { recursive: true });
    await copyFile(roots.get('@deepseek-ai/dsh-settings').manifest, join(shadow, 'package.json'));
    assert.throws(() => inspectProfileDependencies(profile, roots), /duplicate or shadow host instance.*dsh-settings/);
  });
});

test('same-version unused logger shadow in the parent fallback is rejected', async () => {
  await withNativeProfile(async ({ home, profile, roots }) => {
    const shadow = join(home, 'profiles', 'node_modules', '@deepseek-ai', 'cordis-plugin-logger-console');
    assert.equal(existsSync(shadow), false);
    await mkdir(shadow, { recursive: true });
    await copyFile(roots.get('@deepseek-ai/cordis-plugin-logger-console').manifest, join(shadow, 'package.json'));
    assert.throws(() => inspectProfileDependencies(profile, roots), /duplicate or shadow host instance.*logger-console/);
  });
});

async function browserPeerConsumer(profile, { name = 'dsh-better-sidebar', hostSource = 'export const name = "guard-host";', hostDependency = false } = {}) {
  const directory = join(profile, 'node_modules', name);
  await mkdir(join(directory, 'lib'), { recursive: true });
  const peers = { '@deepseek-ai/dsh-client-ui-primitives': '^0.1.0-rc.8', '@deepseek-ai/dsh-client-ui-slots': '^0.1.0-rc.8' };
  const metadata = { name, version: '0.17.8', main: 'lib/index.js', peerDependencies: peers, dsh: { client: { platform: 'web' } } };
  if (hostDependency) metadata.dependencies = { '@deepseek-ai/dsh-client-ui-primitives': '^0.1.0-rc.8' };
  await writeFile(join(directory, 'package.json'), JSON.stringify(metadata));
  await writeFile(join(directory, 'lib', 'index.js'), hostSource);
  return directory;
}

test('only Sidebar browser peers delegate when native Node fallback omits static frontend seeds', async () => {
  await withNativeProfile(async ({ profile, roots }) => {
    const consumer = await browserPeerConsumer(profile);
    for (const name of ['@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-slots']) {
      assert.throws(() => resolvePackage(join(consumer, 'package.json'), name), /Cannot find module/);
    }
    const resolutions = [];
    inspectProfileDependencies(profile, roots, resolutions);
    const browserPeers = resolutions.filter(item => item.scope === 'browser-platform-peer');
    assert.equal(browserPeers.length, 2);
    assert.ok(browserPeers.every(item => item.nodeResolutionRequired === false && item.verification === 'delegated-to-real-browser-mount'));
  });
});

test('a browser peer declared as a real Sidebar host dependency remains mandatory', async () => {
  await withNativeProfile(async ({ profile, roots }) => {
    await browserPeerConsumer(profile, { hostDependency: true });
    assert.throws(() => inspectProfileDependencies(profile, roots), /Cannot find module.*client-ui-primitives/);
  });
});

test('another consumer cannot opt into the Sidebar browser peer exception', async () => {
  await withNativeProfile(async ({ profile, roots }) => {
    await browserPeerConsumer(profile, { name: 'another-browser-consumer' });
    assert.throws(() => inspectProfileDependencies(profile, roots), /Cannot find module.*client-ui-primitives/);
  });
});

test('an actual Sidebar host reference cannot be hidden as a browser peer', async () => {
  await withNativeProfile(async ({ profile, roots }) => {
    await browserPeerConsumer(profile, { hostSource: 'import { Menu } from "@deepseek-ai/dsh-client-ui-primitives";' });
    assert.throws(() => inspectProfileDependencies(profile, roots), /host artifact references browser-only peer.*Node resolution must remain required/);
  });
});
