// Explicit maintenance only. Never called by npm ci or CI: updating this file's
// manifest output and the npm lock requires review and complete mount acceptance.
import { readFileSync, writeFileSync } from 'node:fs';

const filename = new URL('./package.json', import.meta.url);
const manifest = JSON.parse(readFileSync(filename, 'utf8'));
const queue = new Map(Object.entries(manifest.dependencies).filter(([name]) => name.startsWith('@deepseek-ai/')));
const sidebar = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
for (const name of Object.keys(sidebar.peerDependencies ?? {}).filter(name => name.startsWith('@deepseek-ai/dsh-'))) queue.set(name, '0.1.1-rc.2');
const visited = new Set();
const sources = [];
while ([...queue.keys()].some(name => !visited.has(name))) {
  const batch = [...queue].filter(([name]) => !visited.has(name)).slice(0, 12);
  const metadata = await Promise.all(batch.map(async ([name, version]) => {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`cannot read exact official package ${name}@${version}: ${response.status}`);
    return response.json();
  }));
  for (const pkg of metadata) {
    visited.add(pkg.name);
    sources.push({ name: pkg.name, version: pkg.version, dist: pkg.dist });
    const declared = { ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies };
    for (const name of Object.keys(declared).filter(name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))) {
      queue.set(name, '0.1.1-rc.2');
    }
  }
  process.stdout.write(`sealed metadata for ${visited.size} host packages; pending ${queue.size - visited.size}\n`);
}
for (const [name, version] of queue) {
  manifest.dependencies[name] = version;
  if (!name.startsWith('@deepseek-ai/dsh')) manifest.overrides[name] = `$${name}`;
}
// DSH siblings already have exact root specs and a frozen lock. Avoid attaching
// distinct override sets to every member of their cyclic peer graph: npm's
// Arborist can then report otherwise valid shared transitive ranges as invalid.
for (const name of Object.keys(manifest.overrides).filter(name => name.startsWith('@deepseek-ai/dsh'))) delete manifest.overrides[name];
manifest.dependencies = Object.fromEntries(Object.entries(manifest.dependencies).sort(([a], [b]) => a.localeCompare(b)));
manifest.overrides = Object.fromEntries(Object.entries(manifest.overrides).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(filename, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(new URL('./host-closure-source.json', import.meta.url), `${JSON.stringify({ registry: 'https://registry.npmjs.org/', packages: sources.sort((a, b) => a.name.localeCompare(b.name)) }, null, 2)}\n`);
