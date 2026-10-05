import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const cli = path.join(repository, 'bin/sddfw.js');
const existingTests = `import { test, expect } from '@playwright/test';
import { appendFileSync } from 'node:fs';
test('status endpoint remains available @sddfw:API-001', async ({ request }) => {
  const response = await request.get('/status');
  expect(response.status()).toBe(200);
});
`;
const preparedTests = existingTests + `test('status exposes the accepted message @sddfw:API-002', async ({ request }) => {
  const response = await request.get('/status');
  const body = await response.json();
  appendFileSync(process.env.SDDFW_FIXTURE_AUDIT, JSON.stringify({ event: 'playwright', message: body.message }) + '\\n');
  expect(body.message).toBe('ready');
});
`;

// This executable simulates an installed local Codex adapter. It never invokes AI.
// Playwright, the HTTP service, reports, snapshots, and CLI orchestration are real.
const simulatedCodex = `#!/usr/bin/env node
const { readFileSync, writeFileSync, appendFileSync } = require('node:fs');
const assert = require('node:assert/strict');
if (process.argv.includes('--version')) { console.log('codex simulated-integration-fixture'); process.exit(0); }
assert.deepEqual(process.argv.slice(2), ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '--color', 'never', '-']);
const prompt = readFileSync(0, 'utf8');
const record = value => appendFileSync(process.env.SDDFW_FIXTURE_AUDIT, JSON.stringify(value) + '\\n');
if (prompt.startsWith('You are executing the SDDFW tests phase')) {
  assert.equal(readFileSync('tests/status.spec.mjs', 'utf8'), ${JSON.stringify(existingTests)});
  assert.equal(readFileSync('product.json', 'utf8'), JSON.stringify({ message: 'baseline' }));
  writeFileSync('tests/status.spec.mjs', ${JSON.stringify(preparedTests)});
  record({ event: 'agent-tests', simulated: true });
} else {
  assert.ok(prompt.startsWith('You are executing the SDDFW implement phase'));
  assert.equal(readFileSync('tests/status.spec.mjs', 'utf8'), ${JSON.stringify(preparedTests)});
  const attempt = Number(prompt.match(/This is implementation attempt (\\d+)/)?.[1]);
  assert.ok(attempt === 1 || attempt === 2, 'Only two implementation attempts are allowed');
  const reportPath = prompt.match(/Inspect the local report (.+?) to diagnose failures/)?.[1];
  assert.ok(reportPath, 'Executed failures must be supplied as a local diagnostic');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(report.status, 'failed');
  const failure = report.criteria.find(criterion => criterion.id === 'API-002');
  assert.equal(failure.status, 'failed');
  const errors = failure.tests.flatMap(check => check.results.flatMap(result => result.errors.map(error => error.message.replace(/\\u001b\\[[0-9;]*m/g, ''))));
  assert.ok(errors.some(message => message.includes('ready')), JSON.stringify(errors));
  const message = attempt === 2 && process.env.SDDFW_FIXTURE_MODE === 'repair' ? 'ready' : 'repair-incomplete';
  writeFileSync('product.json', JSON.stringify({ message }));
  record({ event: 'agent-implement', simulated: true, attempt, diagnosticRun: report.run.id, errors, message });
}
console.log('Simulated coding-agent adapter; no AI inference executed.');
`;

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

test('simulated local agent workflow repairs executed API failures once with frozen tests and stops after two attempts', { timeout: 180_000 }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'sddfw-workflow-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  await mkdir(bin);
  const adapter = path.join(bin, 'codex');
  await writeFile(adapter, simulatedCodex);
  await chmod(adapter, 0o755);
  // resolveInvocation uses the known Node CLI entry point on Windows.
  const windowsAdapter = path.join(bin, 'node_modules/@openai/codex/bin/codex.js');
  await mkdir(path.dirname(windowsAdapter), { recursive: true });
  await writeFile(windowsAdapter, simulatedCodex);

  for (const mode of ['repair', 'still-failing']) {
    const project = path.join(root, mode), auditFile = path.join(root, `${mode}-audit.jsonl`);
    await mkdir(path.join(project, 'tests'), { recursive: true });
    await symlink(path.join(repository, 'node_modules'), path.join(project, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(path.join(project, 'package.json'), '{"private":true,"type":"module"}');
    await writeFile(path.join(project, 'product.json'), JSON.stringify({ message: 'baseline' }));
    await writeFile(path.join(project, 'tests/status.spec.mjs'), existingTests);
    const port = await unusedPort();
    await writeFile(path.join(project, 'server.mjs'), `import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
createServer((request, response) => {
  response.writeHead(request.url === '/status' ? 200 : 404, { 'content-type': 'application/json' });
  response.end(readFileSync(new URL('./product.json', import.meta.url)));
}).listen(${port}, '127.0.0.1');
`);
    const config = `import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', workers: 1, retries: 0, timeout: 5000,
  use: { baseURL: 'http://127.0.0.1:${port}', trace: 'retain-on-failure' },
  webServer: { command: 'node server.mjs', url: 'http://127.0.0.1:${port}/status', reuseExistingServer: false, timeout: 15000 }
});
`;
    await writeFile(path.join(project, 'playwright.config.mjs'), config);
    const env = { ...process.env, PATH: [bin, path.dirname(process.execPath), process.env.PATH].join(path.delimiter), SDDFW_FIXTURE_AUDIT: auditFile, SDDFW_FIXTURE_MODE: mode };
    const invoke = (...args) => {
      const result = spawnSync(process.execPath, [cli, ...args], { cwd: project, env, encoding: 'utf8', timeout: 90_000, maxBuffer: 2_000_000 });
      assert.ifError(result.error);
      return result;
    };
    const initialized = invoke('init');
    assert.equal(initialized.status, 0, initialized.stdout + initialized.stderr);
    const change = path.join(project, '.sddfw/changes/status-message');
    await mkdir(change, { recursive: true });
    await writeFile(path.join(change, 'spec.json'), JSON.stringify({ schemaVersion: 1, title: 'Expose readiness', intent: 'Return the accepted status message while preserving endpoint availability', criteria: [
      { id: 'API-001', description: 'Status endpoint remains available', given: 'The HTTP service is running', when: 'A client requests /status', then: 'The response status is 200' },
      { id: 'API-002', description: 'The status message indicates readiness', given: 'The HTTP service is running', when: 'A client requests /status', then: 'The JSON message is exactly ready' },
    ] }));
    const approved = invoke('approve', 'status-message');
    assert.equal(approved.status, 0, approved.stdout + approved.stderr);
    const executed = invoke('run', 'status-message', '--agent', 'codex');
    const expectedExit = mode === 'repair' ? 0 : 1;
    const adapterLogs = executed.status === expectedExit ? '' : (await Promise.all((await readdir(change)).filter(file => file.startsWith('agent-') && file.endsWith('.log')).map(file => readFile(path.join(change, file), 'utf8')))).join('\n');
    assert.equal(executed.status, expectedExit, executed.stdout + executed.stderr + adapterLogs);
    const audit = (await readFile(auditFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(audit.map(entry => entry.event), ['agent-tests', 'playwright', 'agent-implement', 'playwright', 'agent-implement', 'playwright']);
    const attempts = audit.filter(entry => entry.event === 'agent-implement');
    assert.deepEqual(attempts.map(entry => entry.attempt), [1, 2], 'No third implementation is invoked, even when acceptance still fails.');
    assert.deepEqual(audit.filter(entry => entry.event === 'playwright').map(entry => entry.message), ['baseline', 'repair-incomplete', mode === 'repair' ? 'ready' : 'repair-incomplete']);
    const runDirs = await readdir(path.join(project, '.sddfw/runs'));
    assert.equal(runDirs.length, 3, 'Baseline plus exactly two implementation verifications must execute.');
    const reports = await Promise.all(runDirs.map(async id => JSON.parse(await readFile(path.join(project, '.sddfw/runs', id, 'acceptance.json'), 'utf8'))));
    const byID = new Map(reports.map(report => [report.run.id, report]));
    const state = JSON.parse(await readFile(path.join(change, 'state.json'), 'utf8'));
    const orderedReports = [byID.get(attempts[0].diagnosticRun), byID.get(attempts[1].diagnosticRun), byID.get(state.lastRun)];
    assert.equal(new Set(orderedReports.map(report => report.run.id)).size, 3, 'The repair receives the first implementation failure, not a stale baseline.');
    assert.deepEqual(orderedReports.map(report => report.status), ['failed', 'failed', mode === 'repair' ? 'passed' : 'failed']);
    for (const key of ['specHash', 'configHash', 'approvalHash']) {
      assert.match(orderedReports[0].run[key], /^[a-f0-9]{64}$/);
      assert.ok(orderedReports.every(report => report.run[key] === orderedReports[0].run[key]), `${key} must remain bound to the original workflow.`);
    }
    for (const [index, report] of orderedReports.entries()) {
      assert.deepEqual(report.summary.issues, []);
      assert.equal(report.summary.tests, 2);
      assert.ok(report.summary.assertionSteps >= 2);
      assert.equal(report.criteria.find(criterion => criterion.id === 'API-001').status, 'passed', 'Existing regression checks remain intact.');
      assert.equal(report.run.sourceFiles['tests/status.spec.mjs'], createHash('sha256').update(preparedTests).digest('hex'));
      assert.equal(report.run.sourceFiles['playwright.config.mjs'], createHash('sha256').update(config).digest('hex'));
      if (index < 2) {
        const observed = index === 0 ? 'baseline' : 'repair-incomplete';
        assert.ok(attempts[index].errors.some(message => message.includes(observed)), 'The adapter reads the actual failed assertion diagnostic.');
      }
    }
    assert.equal(await readFile(path.join(project, 'tests/status.spec.mjs'), 'utf8'), preparedTests);
    assert.equal(await readFile(path.join(project, 'playwright.config.mjs'), 'utf8'), config);
    const implementation = JSON.parse(await readFile(path.join(change, 'implement-changes.json'), 'utf8'));
    assert.equal(implementation.attempt, 2);
    assert.deepEqual(implementation.changedFiles, mode === 'repair' ? ['product.json'] : []);
  }
});
