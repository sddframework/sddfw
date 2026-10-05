import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repository = fileURLToPath(new URL('../../', import.meta.url));
function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120_000, maxBuffer: 2_000_000 });
  assert.ifError(result.error);
  return result;
}
test('packaged CLI installs and verifies real UI/API, failing code, skipped coverage and freshness', { timeout: 180_000 }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'sddfw-package-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packed = run('npm', ['pack', '--json', '--pack-destination', root], repository);
  assert.equal(packed.status, 0, packed.stderr);
  const tarball = path.join(root, JSON.parse(packed.stdout)[0].filename);
  const tool = path.join(root, 'tool'), project = path.join(root, 'project');
  await mkdir(tool); await mkdir(project);
  await writeFile(path.join(tool, 'package.json'), '{"private":true}');
  // Each installation must work with its own empty cache, including on fresh CI.
  const installed = run('npm', ['install', '--prefer-offline', '--cache', path.join(root, 'tool-cache'), tarball], tool);
  assert.equal(installed.status, 0, installed.stderr);
  const cli = path.join(tool, 'node_modules/@sddfw/cli/bin/sddfw.js');
  const invoke = (...args) => run(process.execPath, [cli, ...args], project, { SDDFW_DEMO_PORT: '4187' });
  const initialized = invoke('init', '--demo');
  assert.equal(initialized.status, 0, initialized.stdout + initialized.stderr);
  const deps = run('npm', ['install', '--prefer-offline', '--cache', path.join(root, 'demo-cache')], project);
  assert.equal(deps.status, 0, deps.stderr);
  assert.equal(invoke('verify', 'favorites').status, 2, 'Unreviewed specification must be rejected.');
  assert.equal(invoke('approve', 'favorites').status, 0);
  async function evidence() {
    const state = JSON.parse(await readFile(path.join(project, '.sddfw/changes/favorites/state.json'), 'utf8'));
    const dir = path.join(project, '.sddfw/runs', state.lastRun);
    return { dir, report: JSON.parse(await readFile(path.join(dir, 'acceptance.json'), 'utf8')) };
  }
  const verified = invoke('verify', 'favorites');
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
  const accepted = await evidence();
  assert.equal(accepted.report.status, 'passed'); assert.equal(accepted.report.summary.passed, 5);
  assert.ok(accepted.report.summary.assertionSteps > 0);
  assert.equal(invoke('report', 'favorites').status, 0);
  const server = path.join(project, 'server.mjs'), originalServer = await readFile(server, 'utf8');
  assert.ok(originalServer.includes('[...new Set([...current, id])]'));
  await writeFile(server, originalServer.replace('[...new Set([...current, id])]', '[...current, id]'));
  assert.equal(invoke('report', 'favorites').status, 1, 'Old evidence must become stale after a source edit.');
  assert.equal(invoke('verify', 'favorites').status, 1);
  const broken = await evidence();
  assert.equal(broken.report.criteria.find(c => c.id === 'FAV-003').status, 'failed');
  assert.match(await readFile(path.join(broken.dir, 'acceptance.html'), 'utf8'), /trace/);
  await writeFile(server, originalServer);
  const testsFile = path.join(project, 'tests/favorites.spec.mjs'), originalTests = await readFile(testsFile, 'utf8');
  await writeFile(testsFile, originalTests.replace("test('adding through", "test.skip('adding through"));
  assert.equal(invoke('verify', 'favorites').status, 1);
  assert.equal((await evidence()).report.criteria.find(c => c.id === 'FAV-001').status, 'unverified');
  await writeFile(testsFile, originalTests);
  const specFile = path.join(project, '.sddfw/changes/favorites/spec.json');
  const spec = JSON.parse(await readFile(specFile, 'utf8'));
  spec.criteria.push({ id: 'FAV-006', description: 'A deliberately unmapped scenario', given: 'A valid item', when: 'The user acts', then: 'The expected observable result occurs' });
  await writeFile(specFile, JSON.stringify(spec));
  assert.equal(invoke('verify', 'favorites').status, 2, 'Changed specs invalidate approval.');
  assert.equal(invoke('approve', 'favorites').status, 0);
  assert.equal(invoke('verify', 'favorites').status, 1);
  assert.equal((await evidence()).report.criteria.find(c => c.id === 'FAV-006').status, 'unverified');
});
