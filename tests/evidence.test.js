import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateAcceptance, writeAcceptanceReports } from '../src/evidence.js';
import Reporter from '../src/reporter.js';
import { sourceSnapshot, snapshotHash } from '../src/provenance.js';

const spec = { title: 'Favorites', criteria: [{ id: 'FAV-001', description: 'A favorite survives reload.' }] };
const attempt = (status = 'passed', retry = 0, errors = []) => ({ status, retry, errors, attachments: [], assertionSteps: 1 });
const result = (overrides = {}) => ({ id: 'chromium:favorite', title: 'favorite', tags: ['@sddfw:FAV-001'], project: 'chromium', file: 'tests/favorites.spec.js', line: 3, expectedStatus: 'passed', retries: 0, results: [attempt()], ...overrides });
const raw = (tests = [result()], overrides = {}) => ({ schemaVersion: 1, projects: [{ name: 'chromium' }], suites: [], tests, errors: [], status: 'passed', ...overrides });
const evaluate = (playwrightReport = raw(), options = {}) => evaluateAcceptance({ spec, playwrightReport, run: { id: 'run-1', environment: 'local', mockedServices: [] }, runnerExitCode: 0, ...options });

test('all mapped tests must execute and pass in every selected project', () => {
  const report = evaluate(raw([result(), result({ id: 'webkit:favorite', project: 'webkit' })], { projects: [{ name: 'chromium' }, { name: 'webkit' }] }));
  assert.equal(report.status, 'passed');
  assert.equal(report.criteria[0].tests.length, 2);
  assert.equal(report.summary.passed, 1);
  assert.equal(report.summary.assertionSteps, 2);
});

test('no test mapping, no execution, skipped and expected failures cannot be green', () => {
  for (const tests of [[], [result({ tags: [] })], [result({ results: [] })], [result({ results: [attempt('skipped')] })], [result({ expectedStatus: 'skipped', results: [attempt('skipped')] })], [result({ expectedStatus: 'failed', results: [attempt('failed', 0, [{ message: 'known issue' }])] })], [result({ expectedStatus: 'failed' })]]) {
    assert.equal(evaluate(raw(tests)).status, 'unverified');
  }
  const missingProject = evaluate(raw([result()], { projects: [{ name: 'chromium' }, { name: 'webkit' }] }));
  assert.equal(missingProject.status, 'unverified');
  assert.match(missingProject.criteria[0].reason, /webkit/);
});

test('an unrelated deliberately skipped test does not invalidate mapped acceptance', () => {
  assert.equal(evaluate(raw([result(), result({ id: 'unrelated', tags: [], expectedStatus: 'skipped', results: [attempt('skipped')] })])).status, 'passed');
});

test('setup dependencies need no criterion tags, while their failures still fail the run', () => {
  const setup = result({ id: 'setup', project: 'setup', tags: [] });
  const projects = [{ name: 'setup', dependencies: [] }, { name: 'chromium', dependencies: ['setup'] }];
  const report = evaluate(raw([setup, result()], { projects }));
  assert.equal(report.status, 'passed');
  assert.deepEqual(report.summary.projects, ['chromium']);
  assert.equal(evaluate(raw([result({ ...setup, results: [attempt('failed')] }), result()], { projects }), { runnerExitCode: 1 }).status, 'failed');
});

test('explicit acceptance projects override dependency selection and must be discovered', () => {
  const report = raw([result()], { projects: [{ name: 'chromium' }, { name: 'webkit' }] });
  assert.equal(evaluate(report, { run: { acceptanceProjects: ['chromium'] } }).status, 'passed');
  assert.equal(evaluate(report, { run: { acceptanceProjects: ['webkit'] } }).status, 'unverified');
  assert.equal(evaluate(report, { run: { acceptanceProjects: ['absent'] } }).status, 'blocked');
});

test('empty or unknown assertion evidence cannot verify a passing mapped test', () => {
  for (const assertionSteps of [0, null, undefined, -1, '1']) {
    assert.equal(evaluate(raw([result({ results: [{ ...attempt(), assertionSteps }] })])).status, 'unverified');
  }
});

test('flaky retries are distinct from passed and a final failure remains failed', () => {
  assert.equal(evaluate(raw([result({ retries: 1, results: [attempt('failed'), attempt('passed', 1)] })])).status, 'flaky');
  assert.equal(evaluate(raw([result({ results: [attempt('passed', 1)] })])).status, 'unverified');
  assert.equal(evaluate(raw([result({ results: [attempt('failed'), attempt('failed', 1)] })], { status: 'failed' }), { runnerExitCode: 1 }).status, 'failed');
});

test('a failing test prevents acceptance even when its tag is missing', () => {
  const report = evaluate(raw([result(), result({ id: 'regression', tags: [], results: [attempt('failed', 0, [{ message: 'expected 2 received 1' }])] })], { status: 'failed' }), { runnerExitCode: 1 });
  assert.equal(report.criteria[0].status, 'passed');
  assert.equal(report.status, 'failed');
});

test('global errors, missing browser/service, interruptions and runner errors are blocked', () => {
  assert.equal(evaluate(raw(undefined, { errors: [{ message: 'global setup failed' }] })).status, 'blocked');
  for (const message of ["browserType.launch: Executable doesn't exist", 'connect ECONNREFUSED 127.0.0.1:3000']) {
    const report = evaluate(raw([result({ results: [attempt('failed', 0, [{ message }])] })], { status: 'failed' }), { runnerExitCode: 1 });
    assert.equal(report.status, 'blocked');
    assert.equal(report.criteria[0].status, 'blocked');
  }
  assert.equal(evaluate(raw(), { runnerExitCode: null }).status, 'blocked');
  assert.equal(evaluate(raw(), { runnerExitCode: 1 }).status, 'blocked');
  assert.equal(evaluate(raw([], { status: 'interrupted' })).status, 'blocked');
});

test('malformed evidence and empty or duplicate specs cannot produce passed', () => {
  const malformedReports = [
    null, {}, { tests: 'invalid', projects: 2, errors: null },
    raw(undefined, { projects: 'invalid' }), raw([result(), result()]),
    raw([result({ results: [null] })]), raw([result({ project: 'unknown' })]),
    raw([result({ results: [attempt('passed', 0, [{ message: 'contradictory' }])] })]),
  ];
  for (const malformed of malformedReports) {
    assert.notEqual(evaluate(malformed).status, 'passed');
  }
  assert.equal(evaluate(raw(), { spec: { title: 'empty', criteria: [] } }).status, 'blocked');
  assert.equal(evaluate(raw(), { spec: { ...spec, criteria: [...spec.criteria, ...spec.criteria] } }).status, 'blocked');
});

test('local reports escape prose, redact known secret fields, and only link contained artifacts', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sddfw-evidence-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outside = path.join(directory, 'outside.txt');
  const outputDir = path.join(directory, 'run');
  await mkdir(outputDir);
  await writeFile(outside, 'private');
  await writeFile(path.join(outputDir, 'trace.zip'), 'trace');
  await writeFile(path.join(outputDir, 'unsafe.html'), '<script>alert(1)</script>');
  await symlink(outside, path.join(outputDir, 'escape.txt'));
  const report = evaluate(raw([result({ title: '<script>bad()</script> token=hidden-value', results: [{ ...attempt(), attachments: [
    { name: 'Trace', path: path.join(outputDir, 'trace.zip') },
    { name: 'External', path: outside },
    { name: 'Symlink', path: path.join(outputDir, 'escape.txt') },
    { name: 'Unsafe', path: path.join(outputDir, 'unsafe.html') },
    { name: 'Remote', path: 'javascript:alert(1).txt' },
  ] }] })]), { spec: { title: '<img src=x onerror=bad()>', criteria: [{ id: 'FAV-001', description: 'Value | **bold** [link](javascript:bad) <script>bad()</script>' }] }, run: { id: 'run-1', command: ['TOKEN=never-in-summary'], environment: 'local', mockedServices: [], dirty: null, nodeVersion: process.version } });
  const files = await writeAcceptanceReports(report, outputDir);
  const [page, md, json] = await Promise.all([readFile(files.html, 'utf8'), readFile(files.markdown, 'utf8'), readFile(files.json, 'utf8')]);
  assert.match(page, /&lt;script&gt;/);
  assert.match(page, /Git state unavailable/);
  assert.ok(page.includes(process.version));
  assert.doesNotMatch(page, /<script>|onerror=bad\(\)>|hidden-value|never-in-summary/);
  assert.match(page, /href="\.\/trace.zip"/);
  assert.doesNotMatch(page, /href="[^\"]*(?:outside|escape|unsafe|javascript)/);
  assert.match(md, /\\\|/);
  assert.doesNotMatch(md, /<script>|hidden-value|never-in-summary/);
  assert.match(md, /\[Trace\]\(\.\/trace.zip\)/);
  assert.equal(JSON.parse(json).status, 'passed');
});

test('reporter preserves suite discoveries, runtime annotations, assertion counts and local buffer attachments', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sddfw-reporter-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const project = { name: 'chromium' };
  await writeFile(path.join(directory, 'test.js'), 'test source');
  const testCase = { id: 'one', title: 'Tagged @sddfw:FAV-001', titlePath: () => ['', 'chromium', 'Tagged @sddfw:FAV-001'], tags: [], parent: { project: () => project }, location: { file: path.join(directory, 'test.js'), line: 5 }, expectedStatus: 'passed', retries: 0, outcome: () => 'expected', results: [{ ...attempt(), duration: 2, startTime: new Date('2026-01-01T00:00:00Z'), steps: [{ category: 'test.step', steps: [{ category: 'expect', steps: [] }] }], attachments: [{ name: 'detail', contentType: 'text/plain', body: Buffer.from('local evidence') }] }] };
  const omitted = { ...testCase, id: 'two', results: [] };
  const suite = { title: 'chromium', type: 'project', project: () => project, tests: [testCase, omitted], suites: [] };
  const reporter = new Reporter({ outputFile: path.join(directory, 'playwright.json') });
  const config = { rootDir: directory, projects: [project] };
  const rootSuite = { suites: [suite], allTests: () => [testCase, omitted] };
  assert.equal(reporter.onBegin(config, rootSuite), undefined);
  assert.ok(reporter.sourceFiles['test.js']);
  await reporter.onBegin(config, rootSuite);
  testCase.expectedStatus = 'failed';
  reporter.onTestEnd(testCase);
  reporter.onError({ message: 'global failure' });
  await reporter.onEnd({ status: 'failed', startTime: new Date('2026-01-01T00:00:00Z'), duration: 2 });
  const report = JSON.parse(await readFile(path.join(directory, 'playwright.json'), 'utf8'));
  assert.equal(report.tests.length, 2);
  assert.equal(report.tests[0].expectedStatus, 'failed');
  assert.ok(report.tests[0].tags.includes('@sddfw:FAV-001'));
  assert.equal(report.tests[0].results[0].assertionSteps, 1);
  assert.equal(report.tests[1].status, 'notRun');
  assert.equal(report.errors.length, 1);
  assert.equal(await readFile(report.tests[0].results[0].attachments[0].path, 'utf8'), 'local evidence');
  assert.equal(report.suites[0].tests.length, 2);
  assert.ok(report.sourceFiles['test.js']);
});

test('real Playwright reporter distinguishes pass, skip, expected failure, flaky and missing tag', async t => {
  const require = createRequire(import.meta.url);
  let playwrightRoot;
  try { playwrightRoot = path.dirname(require.resolve('@playwright/test/package.json')); }
  catch { t.skip('Install development dependencies to run the real Playwright reporter check.'); return; }
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sddfw-real-reporter-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reporterPath = fileURLToPath(new URL('../src/reporter.js', import.meta.url));
  await writeFile(path.join(directory, 'playwright.config.mjs'), `export default { testDir: '.', workers: 1, retries: 1, reporter: [[${JSON.stringify(reporterPath)}]], projects: [{name:'node'}] };\n`);
  await writeFile(path.join(directory, 'evidence.spec.cjs'), `const { test, expect } = require(${JSON.stringify(playwrightRoot)});
test('passes @sddfw:FAV-001', () => expect(1).toBe(1));
test.skip('skipped @sddfw:FAV-002', () => {});
test('known failing @sddfw:FAV-003', () => { test.fail(); expect(1).toBe(2); });
test('flaky @sddfw:FAV-004', ({}, info) => expect(info.retry).toBe(1));
test('unmapped', () => expect(true).toBe(true));
`);
  const outputFile = path.join(directory, 'run', 'playwright.json');
  const processResult = spawnSync(process.execPath, [path.join(playwrightRoot, 'cli.js'), 'test', '--config', path.join(directory, 'playwright.config.mjs')], { cwd: directory, env: { ...process.env, SDDFW_PLAYWRIGHT_REPORT: outputFile }, encoding: 'utf8', timeout: 30_000 });
  assert.equal(processResult.status, 0, processResult.stderr || processResult.stdout);
  const report = JSON.parse(await readFile(outputFile, 'utf8'));
  const acceptance = evaluate(report, { spec: { title: 'Runner cases', criteria: [1, 2, 3, 4, 5].map(number => ({ id: `FAV-00${number}`, description: `Criterion ${number}` })) }, runnerExitCode: processResult.status });
  assert.deepEqual(acceptance.criteria.map(criterion => criterion.status), ['passed', 'unverified', 'unverified', 'flaky', 'unverified']);
  assert.equal(acceptance.status, 'flaky');
  assert.ok(acceptance.summary.assertionSteps >= 5);
  // A real unexpected assertion failure must turn acceptance red, even with no matching tag.
  await writeFile(path.join(directory, 'evidence.spec.cjs'), `const { test, expect } = require(${JSON.stringify(playwrightRoot)});
test('passes @sddfw:FAV-001', () => expect(1).toBe(1));
test('regression without tag', () => expect(1).toBe(2));
`);
  const mutation = spawnSync(process.execPath, [path.join(playwrightRoot, 'cli.js'), 'test', '--config', path.join(directory, 'playwright.config.mjs')], { cwd: directory, env: { ...process.env, SDDFW_PLAYWRIGHT_REPORT: outputFile }, encoding: 'utf8', timeout: 30_000 });
  assert.equal(mutation.status, 1, mutation.stderr || mutation.stdout);
  const failure = evaluate(JSON.parse(await readFile(outputFile, 'utf8')), { runnerExitCode: mutation.status });
  assert.equal(failure.criteria[0].status, 'passed');
  assert.equal(failure.status, 'failed');
});

test('real Playwright configured project with no tests remains unverified despite a successful runner', async t => {
  const require = createRequire(import.meta.url);
  let playwrightRoot;
  try { playwrightRoot = path.dirname(require.resolve('@playwright/test/package.json')); }
  catch { t.skip('Install development dependencies to run the real Playwright reporter check.'); return; }
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sddfw-empty-project-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reporterPath = fileURLToPath(new URL('../src/reporter.js', import.meta.url));
  await writeFile(path.join(directory, 'playwright.config.mjs'), `export default {
    testDir: '.', workers: 1, reporter: [[${JSON.stringify(reporterPath)}]],
    projects: [
      {name:'chromium', testMatch:'evidence.spec.cjs'},
      {name:'firefox', testMatch:'nonexistent.spec.cjs'}
    ]
  };\n`);
  await writeFile(path.join(directory, 'evidence.spec.cjs'), `const { test, expect } = require(${JSON.stringify(playwrightRoot)});
test('passes @sddfw:FAV-001', () => expect(1).toBe(1));
`);
  const outputFile = path.join(directory, 'run', 'playwright.json');
  const runner = spawnSync(process.execPath, [path.join(playwrightRoot, 'cli.js'), 'test', '--config', path.join(directory, 'playwright.config.mjs')], { cwd: directory, env: { ...process.env, SDDFW_PLAYWRIGHT_REPORT: outputFile }, encoding: 'utf8', timeout: 30_000 });
  assert.equal(runner.status, 0, runner.stderr || runner.stdout);
  const report = JSON.parse(await readFile(outputFile, 'utf8'));
  assert.deepEqual(report.projects.map(project => project.name), ['chromium', 'firefox']);
  assert.deepEqual(report.tests.map(test => test.project), ['chromium']);
  const acceptance = evaluate(report, { runnerExitCode: runner.status });
  assert.equal(acceptance.status, 'unverified');
  assert.equal(acceptance.criteria[0].status, 'unverified');
  assert.match(acceptance.criteria[0].reason, /firefox/);
  // Deliberately choosing chromium still verifies the explicitly scoped run.
  assert.equal(evaluate(report, { runnerExitCode: runner.status, run: { acceptanceProjects: ['chromium'] } }).status, 'passed');
});

test('real Playwright captures all project test directories before execution, including excluded output directories', async t => {
  const require = createRequire(import.meta.url);
  let playwrightRoot;
  try { playwrightRoot = path.dirname(require.resolve('@playwright/test/package.json')); }
  catch { t.skip('Install development dependencies to run the real Playwright reporter check.'); return; }
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sddfw-project-sources-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reporterPath = fileURLToPath(new URL('../src/reporter.js', import.meta.url));
  await mkdir(path.join(directory, 'tests'));
  await mkdir(path.join(directory, 'dist', 'mobile-tests'), { recursive: true });
  await writeFile(path.join(directory, 'playwright.config.mjs'), `export default {
    workers: 1, reporter: [[${JSON.stringify(reporterPath)}]],
    projects: [
      {name:'desktop', testDir:'./tests'},
      {name:'mobile', testDir:'./dist/mobile-tests'}
    ]
  };\n`);
  const testSource = `const { test, expect } = require(${JSON.stringify(playwrightRoot)});
test('passes @sddfw:FAV-001', () => expect(1).toBe(1));\n`;
  await writeFile(path.join(directory, 'tests', 'desktop.spec.cjs'), testSource);
  const mobileFile = path.join(directory, 'dist', 'mobile-tests', 'mobile.spec.cjs');
  await writeFile(mobileFile, testSource);
  const outputFile = path.join(directory, '.sddfw', 'runs', 'run', 'playwright.json');
  const runner = spawnSync(process.execPath, [path.join(playwrightRoot, 'cli.js'), 'test', '--config', path.join(directory, 'playwright.config.mjs')], {
    cwd: directory,
    env: { ...process.env, SDDFW_PLAYWRIGHT_REPORT: outputFile, SDDFW_PROJECT_ROOT: directory, SDDFW_PROTECTED_PATHS: JSON.stringify(['tests', 'playwright.config.mjs']) },
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(runner.status, 0, runner.stderr || runner.stdout);
  const report = JSON.parse(await readFile(outputFile, 'utf8'));
  assert.deepEqual(report.errors, []);
  assert.equal(report.projectRoot, await realpath(directory));
  assert.deepEqual(report.projects.map(project => project.testDir), ['tests', 'dist/mobile-tests']);
  assert.ok(report.protectedPaths.includes('dist/mobile-tests'));
  assert.ok(report.protectedPaths.includes('dist/mobile-tests/mobile.spec.cjs'));
  assert.ok(report.sourceFiles['tests/desktop.spec.cjs']);
  assert.ok(report.sourceFiles['dist/mobile-tests/mobile.spec.cjs']);
  assert.deepEqual(report.tests.map(test => test.file).sort(), ['dist/mobile-tests/mobile.spec.cjs', 'tests/desktop.spec.cjs']);
  assert.equal(evaluate(report, { runnerExitCode: runner.status }).status, 'passed');
  const capturedHash = snapshotHash(report.sourceFiles);
  await writeFile(mobileFile, `${testSource}\n// changed after execution\n`);
  const current = await sourceSnapshot(directory, { protectedPaths: report.protectedPaths });
  assert.notEqual(snapshotHash(current), capturedHash);
});
