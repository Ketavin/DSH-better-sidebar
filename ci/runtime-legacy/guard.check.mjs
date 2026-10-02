import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertHmrReady, assertLockClosure, assertPinned, assertResolutionIdentity, cleanupGuardResources } from './guard.mjs';

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
