import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSpec, specHash, writeJSON, changePaths, approveSpec, readSpec } from '../src/spec.js';
import { initialize, readConfig, projectPath } from '../src/project.js';
import { sourceSnapshot, controlSnapshot, snapshotHash, changedFiles } from '../src/provenance.js';
import { createPlan, phasePrompt, assertFrozenTests, runAgentPhase } from '../src/agents.js';
import { resolveInvocation } from '../src/process.js';

const cli = fileURLToPath(new URL('../bin/sddfw.js', import.meta.url));
const valid = () => ({ schemaVersion: 1, title: 'Save a favorite', intent: 'Keep user choices', criteria: [{ id: 'FAV-001', description: 'Persists a saved favorite', given: 'An empty favorites list', when: 'The user adds an item and reloads', then: 'Exactly that item remains in the list' }] });
async function temp(t) { const root = await mkdtemp(path.join(tmpdir(), 'sddfw-core-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }
function invoke(root, ...args) { return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 15000 }); }

test('approval binds the reviewed scenarios and rejects subsequent spec changes', async t => {
  const root = await temp(t), spec = valid();
  await writeJSON(changePaths(root, 'favorites').spec, spec);
  await assert.rejects(readSpec(root, 'favorites', { approved: true }), /Review/);
  await approveSpec(root, 'favorites');
  assert.equal(specHash(await readSpec(root, 'favorites', { approved: true })), specHash(spec));
  spec.criteria[0].then = 'An entirely different result';
  await writeJSON(changePaths(root, 'favorites').spec, spec);
  await assert.rejects(readSpec(root, 'favorites', { approved: true }), /changed after approval/);
});
test('incomplete, duplicate and unsafe specifications cannot be approved', async t => {
  const spec = valid();
  spec.criteria[0].then = 'TODO'; assert.throws(() => validateSpec(spec), /concrete then/);
  spec.criteria[0].then = 'Saved'; spec.criteria.push({ ...spec.criteria[0] }); assert.throws(() => validateSpec(spec), /duplicate/);
  const root = await temp(t);
  assert.throws(() => changePaths(root, '../../outside'), /change name/);
  await assert.rejects(projectPath(root, '../outside'), /relative/);
});
test('todo domain vocabulary is accepted while explicit unresolved markers block approval', () => {
  const spec = valid();
  Object.assign(spec.criteria[0], { description: 'A todo item survives reload', given: 'The todo list is empty', when: 'The user saves a todo item', then: 'The saved todo item remains after reload' });
  assert.equal(validateSpec(spec), spec);
  spec.criteria[0].then = 'TODO: decide whether completed items stay visible';
  assert.throws(() => validateSpec(spec), /replace TODO/);
  spec.criteria[0].then = 'The default is TBD: decide with the user';
  assert.throws(() => validateSpec(spec), /replace TODO/);
});
test('initialization preserves config, tests, scripts and existing agent instructions', async t => {
  const root = await temp(t);
  const pkg = '{"name":"existing","scripts":{"test":"original"}}\n';
  const config = "export default { testDir: './e2e' };\n";
  await writeFile(path.join(root, 'package.json'), pkg);
  await writeFile(path.join(root, 'playwright.config.mjs'), config);
  await writeFile(path.join(root, 'AGENTS.md'), 'user rules\n');
  await mkdir(path.join(root, 'e2e')); await writeFile(path.join(root, 'e2e/existing.spec.js'), 'original test\n');
  await initialize(root); await initialize(root);
  assert.equal(await readFile(path.join(root, 'package.json'), 'utf8'), pkg);
  assert.equal(await readFile(path.join(root, 'playwright.config.mjs'), 'utf8'), config);
  assert.equal(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), 'user rules\n');
  assert.equal(await readFile(path.join(root, 'e2e/existing.spec.js'), 'utf8'), 'original test\n');
  assert.equal((await readConfig(root)).testDir, 'e2e');
});
test('source freshness tracks code, additions and deletions, excluding generated evidence', async t => {
  const root = await temp(t);
  await writeFile(path.join(root, 'app.js'), 'before');
  const before = await sourceSnapshot(root);
  await mkdir(path.join(root, '.sddfw/runs/test'), { recursive: true });
  await writeFile(path.join(root, '.sddfw/runs/test/evidence.json'), 'noise');
  assert.equal(snapshotHash(await sourceSnapshot(root)), snapshotHash(before));
  await writeFile(path.join(root, 'app.js'), 'after');
  await writeFile(path.join(root, 'added.js'), 'new');
  assert.deepEqual(changedFiles(before, await sourceSnapshot(root)).sort(), ['added.js', 'app.js']);
});
test('configured tests remain frozen and fresh even beneath generated-output directories', async t => {
  const root = await temp(t);
  await mkdir(path.join(root, 'dist/tests'), { recursive: true });
  await writeFile(path.join(root, 'dist/tests/behavior.spec.js'), 'original assertion');
  await writeFile(path.join(root, 'dist/playwright.config.mjs'), 'original config');
  await writeFile(path.join(root, 'dist/generated.js'), 'generated output');
  const options = { protectedPaths: ['dist/tests', 'dist/playwright.config.mjs'] };
  const before = await sourceSnapshot(root, options);
  assert.equal(before['dist/generated.js'], undefined);
  await writeFile(path.join(root, 'dist/tests/behavior.spec.js'), 'weakened assertion');
  await writeFile(path.join(root, 'dist/playwright.config.mjs'), 'changed selection');
  await writeFile(path.join(root, 'dist/tests/new.spec.js'), 'new test');
  assert.deepEqual(changedFiles(before, await sourceSnapshot(root, options)).sort(), ['dist/playwright.config.mjs', 'dist/tests/behavior.spec.js', 'dist/tests/new.spec.js']);
  await rm(path.join(root, 'dist/tests/behavior.spec.js'));
  assert.notEqual(snapshotHash(before), snapshotHash(await sourceSnapshot(root, options)));
});
test('baseline freeze protects all project test paths against edits, removals and additions', () => {
  const testPaths = ['tests', 'dist/mobile-tests', 'playwright.config.mjs'];
  const frozen = {
    'tests/favorites.spec.mjs': 'desktop assertions',
    'dist/mobile-tests/favorites.spec.mjs': 'mobile assertions',
    'playwright.config.mjs': 'selected projects',
  };
  assert.deepEqual(assertFrozenTests({ ...frozen, 'src/app.js': 'changed product' }, frozen, testPaths), frozen);
  assert.doesNotThrow(() => assertFrozenTests({ ...frozen, 'dist/mobile-tests-extra/product.js': 'product' }, frozen, testPaths));
  for (const file of Object.keys(frozen)) {
    assert.throws(() => assertFrozenTests({ ...frozen, [file]: 'weakened assertion or selection' }, frozen, testPaths), /Frozen acceptance tests changed/);
    const deleted = { ...frozen }; delete deleted[file];
    assert.throws(() => assertFrozenTests(deleted, frozen, testPaths), /Frozen acceptance tests changed/);
  }
  for (const file of ['tests/new.spec.mjs', 'dist/mobile-tests/new.spec.mjs']) {
    assert.throws(() => assertFrozenTests({ ...frozen, [file]: 'new test' }, frozen, testPaths), /Frozen acceptance tests changed/);
  }
  assert.throws(() => assertFrozenTests(frozen, undefined, testPaths), /baseline file hashes/);
});
test('implementation rejects a changed secondary project test before invoking an agent', async t => {
  const root = await temp(t);
  await initialize(root);
  await writeJSON(changePaths(root, 'favorites').spec, valid());
  await approveSpec(root, 'favorites');
  await mkdir(path.join(root, 'dist/mobile-tests'), { recursive: true });
  const mobileTest = path.join(root, 'dist/mobile-tests/favorites.spec.mjs');
  await writeFile(mobileTest, 'original mobile assertion');
  const config = await readConfig(root);
  const frozenPaths = [config.testDir, config.playwrightConfig, 'dist/mobile-tests'];
  const baseline = await sourceSnapshot(root, { protectedPaths: frozenPaths });
  const frozenFiles = Object.fromEntries(Object.entries(baseline).filter(([file]) => frozenPaths.some(target => file === target || file.startsWith(`${target}/`))));
  await writeFile(mobileTest, 'weakened mobile assertion');
  await assert.rejects(runAgentPhase(root, 'favorites', config, 'agent-must-not-run', 'implement', { frozenPaths, frozenFiles }), /Frozen acceptance tests changed: dist\/mobile-tests\/favorites\.spec\.mjs/);
  await writeFile(mobileTest, 'original mobile assertion');
  await writeFile(path.join(root, 'dist/mobile-tests/new.spec.mjs'), 'new mobile test');
  await assert.rejects(runAgentPhase(root, 'favorites', config, 'agent-must-not-run', 'implement', { attempt: 2, frozenPaths, frozenFiles }), /Frozen acceptance tests changed: dist\/mobile-tests\/new\.spec\.mjs/);
});
test('CLI prepares a manual lifecycle without claiming agent execution', async t => {
  const root = await temp(t);
  assert.equal(invoke(root, 'init').status, 0);
  assert.equal(invoke(root, 'change', 'favorites', '--intent', 'Save favorites').status, 0);
  assert.equal(invoke(root, 'approve', 'favorites').status, 2);
  await writeJSON(changePaths(root, 'favorites').spec, valid());
  assert.equal(invoke(root, 'approve', 'favorites').status, 0);
  const run = invoke(root, 'run', 'favorites', '--agent', 'manual');
  assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /No implementation was executed/);
  assert.match(await readFile(path.join(changePaths(root, 'favorites').dir, 'plan.md'), 'utf8'), /@sddfw:FAV-001/);
  const verify = invoke(root, 'verify', 'favorites');
  assert.equal(verify.status, 1); assert.match(verify.stdout, /blocked/);
  const state = JSON.parse(await readFile(changePaths(root, 'favorites').state, 'utf8'));
  const evidence = JSON.parse(await readFile(path.join(root, '.sddfw/runs', state.lastRun, 'acceptance.json'), 'utf8'));
  assert.equal(evidence.status, 'blocked');
});
test('agent tasks preserve accepted behavior and constrain separate test and implementation phases', () => {
  const config = { testDir: 'e2e', playwrightConfig: 'playwright.config.mjs' };
  assert.match(phasePrompt('tests', { slug: 'favorites', spec: valid(), config }), /Do not implement product changes/);
  assert.match(phasePrompt('implement', { slug: 'favorites', spec: valid(), config }), /tests prepared for this change are frozen/);
});
test('nested configuration and equivalent paths resolve to the actual frozen test directory', async t => {
  const root = await temp(t);
  await mkdir(path.join(root, 'qa'));
  await writeFile(path.join(root, 'qa/playwright.config.mjs'), "export default {testDir:'./tests'};");
  await initialize(root, { config: './qa/playwright.config.mjs' });
  const config = await readConfig(root);
  assert.equal(config.testDir, 'qa/tests'); assert.equal(config.playwrightConfig, 'qa/playwright.config.mjs');
  const saved = JSON.parse(await readFile(path.join(root, '.sddfw/config.json'), 'utf8'));
  saved.testDir = './qa/tests'; saved.playwrightConfig = './qa/playwright.config.mjs';
  await writeJSON(path.join(root, '.sddfw/config.json'), saved);
  assert.equal((await readConfig(root)).testDir, 'qa/tests');
});
test('demo preflight preserves existing documentation and refuses to overwrite it', async t => {
  const root = await temp(t);
  await writeFile(path.join(root, 'README.md'), 'User documentation');
  await assert.rejects(initialize(root, { demo: true }), /README.md already exists/);
  assert.equal(await readFile(path.join(root, 'README.md'), 'utf8'), 'User documentation');
});
test('draft control snapshots allow only the draft and detect manufactured approvals', async t => {
  const root = await temp(t);
  await initialize(root);
  const target = changePaths(root, 'new-change').spec;
  await writeJSON(target, valid());
  const permitted = '.sddfw/changes/new-change/spec.json';
  const before = await controlSnapshot(root, permitted);
  await writeJSON(target, { ...valid(), title: 'Updated draft' });
  assert.deepEqual(changedFiles(before, await controlSnapshot(root, permitted)), []);
  await writeJSON(changePaths(root, 'new-change').approval, { specHash: 'untrusted' });
  assert.deepEqual(changedFiles(before, await controlSnapshot(root, permitted)), ['.sddfw/changes/new-change/approval.json']);
});
test('Windows npm shims resolve to Node scripts without shell interpolation', async t => {
  const root = await temp(t);
  await mkdir(path.join(root, 'node_modules/npm/bin'), { recursive: true });
  const script = path.join(root, 'node_modules/npm/bin/npm-cli.js');
  await writeFile(script, '');
  const invocation = resolveInvocation('npm.cmd', ['install', 'a value with spaces'], { platform: 'win32', env: { PATH: root } });
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.args, [script, 'install', 'a value with spaces']);
});
