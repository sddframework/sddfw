import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captureWorkflowControls, assertWorkflowControls } from '../src/controls.js';
import { runAgentPhase, assertFrozenTests } from '../src/agents.js';
import { readConfig, exists } from '../src/project.js';
import { sourceSnapshot } from '../src/provenance.js';
import { approveSpec, changePaths, specHash, writeJSON } from '../src/spec.js';
import { verify } from '../src/verify.js';

const changedControls = /Accepted specification\/config\/approval changed since workflow preparation/;
const staleConfig = /SDDFW configuration changed after it was loaded/;
const slug = 'favorites';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'sddfw-controls-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'tests'), { recursive: true });
  await mkdir(path.join(root, 'dist/mobile-tests'), { recursive: true });
  await writeFile(path.join(root, 'playwright.config.mjs'), 'export default { testDir: "./tests" };\n');
  await writeFile(path.join(root, 'tests/favorites.spec.mjs'), '// frozen desktop assertions\n');
  await writeFile(path.join(root, 'dist/mobile-tests/favorites.spec.mjs'), '// frozen mobile assertions\n');
  await writeJSON(path.join(root, '.sddfw/config.json'), {
    schemaVersion: 1, playwrightConfig: './playwright.config.mjs', testDir: './tests',
    environment: 'local', mockedServices: [],
  });
  const spec = {
    schemaVersion: 1, title: 'Save favorites', intent: 'Keep the selected favorite',
    criteria: [{ id: 'FAV-001', description: 'Persists a favorite', given: 'An empty list', when: 'The user saves and reloads', then: 'Exactly that favorite remains' }],
  };
  await writeJSON(changePaths(root, slug).spec, spec);
  await approveSpec(root, slug);
  // Give the original approval a deterministic historical timestamp so a later
  // normal approveSpec call is a distinct approval even on a fast filesystem.
  const approval = JSON.parse(await readFile(changePaths(root, slug).approval, 'utf8'));
  await writeJSON(changePaths(root, slug).approval, { ...approval, acceptedAt: '2020-01-01T00:00:00.000Z' });
  const config = await readConfig(root);
  const workflowControls = await captureWorkflowControls(root, slug, config);
  const frozenPaths = [config.testDir, config.playwrightConfig, 'dist/mobile-tests'];
  const sources = await sourceSnapshot(root, { protectedPaths: frozenPaths });
  const frozenFiles = Object.fromEntries(Object.entries(sources).filter(([file]) => frozenPaths.some(target => file === target || file.startsWith(`${target}/`))));
  return { root, spec, config, workflowControls, frozenPaths, frozenFiles };
}

async function unchangedFrozenTests(context) {
  const current = await sourceSnapshot(context.root, { protectedPaths: context.frozenPaths });
  assert.deepEqual(assertFrozenTests(current, context.frozenFiles, context.frozenPaths), context.frozenFiles);
  assert.deepEqual((await readdir(changePaths(context.root, slug).dir)).filter(name => name.startsWith('agent-')), [], 'The agent must not be invoked.');
}

async function rejectsPhase(context, phase, expected, { config = context.config, attempt = 1 } = {}) {
  await assert.rejects(runAgentPhase(context.root, slug, config, 'agent-must-not-run', phase, {
    attempt, workflowControls: context.workflowControls,
    frozenPaths: context.frozenPaths, frozenFiles: context.frozenFiles,
  }), expected);
  await unchangedFrozenTests(context);
}

test('workflow controls bind the approved meaning, config and approval while accepting normalized paths', async t => {
  const context = await fixture(t);
  assert.equal(context.workflowControls.specHash, specHash(context.spec));
  for (const field of ['specHash', 'configHash', 'approvalHash']) assert.match(context.workflowControls[field], /^[a-f0-9]{64}$/);
  assert.deepEqual(await assertWorkflowControls(context.root, slug, context.config, context.workflowControls), context.workflowControls);
  await unchangedFrozenTests(context);
});

test('reapproving a changed spec after the baseline stops either implementation attempt before the agent', async t => {
  const context = await fixture(t);
  context.spec.criteria[0].then = 'A different newly approved outcome';
  await writeJSON(changePaths(context.root, slug).spec, context.spec);
  await approveSpec(context.root, slug);
  for (const attempt of [1, 2]) await rejectsPhase(context, 'implement', changedControls, { attempt });
  await assert.rejects(verify(context.root, slug, context.config, { quiet: true, expectedControls: context.workflowControls }), changedControls);
  assert.equal(await exists(path.join(context.root, '.sddfw/runs')), false, 'Changed controls must stop verification before the runner starts.');
});

test('a new approval of the same spec stops test preparation and implementation without changing frozen tests', async t => {
  const context = await fixture(t);
  await approveSpec(context.root, slug);
  const current = await captureWorkflowControls(context.root, slug, context.config);
  assert.equal(current.specHash, context.workflowControls.specHash);
  assert.equal(current.configHash, context.workflowControls.configHash);
  assert.notEqual(current.approvalHash, context.workflowControls.approvalHash);
  await rejectsPhase(context, 'tests', changedControls);
  await rejectsPhase(context, 'implement', changedControls, { attempt: 2 });
});

test('loading an edited config cannot replace the workflow config between phases', async t => {
  const context = await fixture(t);
  await writeJSON(path.join(context.root, '.sddfw/config.json'), { ...context.config, environment: 'changed-local-context' });
  const changedConfig = await readConfig(context.root);
  await rejectsPhase(context, 'tests', changedControls, { config: changedConfig });
  await rejectsPhase(context, 'implement', changedControls, { config: changedConfig, attempt: 2 });
  await assert.rejects(verify(context.root, slug, changedConfig, { quiet: true, expectedControls: context.workflowControls }), changedControls);
  assert.equal(await exists(path.join(context.root, '.sddfw/runs')), false);
});

test('cached configuration cannot describe an edited config during capture, agent phases or verification', async t => {
  const context = await fixture(t);
  await writeJSON(path.join(context.root, '.sddfw/config.json'), { ...context.config, mockedServices: ['newly declared mock'] });
  await assert.rejects(captureWorkflowControls(context.root, slug, context.config), staleConfig);
  await rejectsPhase(context, 'tests', staleConfig);
  await rejectsPhase(context, 'implement', staleConfig);
  await assert.rejects(verify(context.root, slug, context.config, { quiet: true, expectedControls: context.workflowControls }), staleConfig);
  assert.equal(await exists(path.join(context.root, '.sddfw/runs')), false);
});
