import { mkdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readSpec, specHash, writeJSON, changePaths } from './spec.js';
import { sourceSnapshot, snapshotHash, gitContext } from './provenance.js';
import { resolvePlaywright, exists, readConfig, projectPath } from './project.js';
import { execute } from './process.js';
import { evaluateAcceptance, writeAcceptanceReports } from './evidence.js';

export async function verify(root, slug, config, { quiet = false } = {}) {
  const spec = await readSpec(root, slug, { approved: true });
  const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const outputDir = path.join(root, '.sddfw', 'runs', id);
  await mkdir(outputDir, { recursive: true });
  const configHash = snapshotHash({ config: await readFile(path.join(root, '.sddfw/config.json'), 'utf8') });
  const snapshotOptions = { protectedPaths: [config.testDir, config.playwrightConfig] };
  const sources = await sourceSnapshot(root, snapshotOptions);
  const run = { id, startedAt: new Date().toISOString(), ...gitContext(root), specHash: specHash(spec), sourceHash: snapshotHash(sources), configHash, environment: config.environment, mockedServices: config.mockedServices, acceptanceProjects: config.acceptanceProjects, command: [], nodeVersion: process.version, playwrightVersion: null, outputDir, projectRoot: root };
  let raw = { schemaVersion: 1, projects: [], tests: [], errors: [], status: 'interrupted' }, runnerExitCode = 1;
  try {
    const playwright = resolvePlaywright(root);
    run.playwrightVersion = playwright.version;
    const reporter = fileURLToPath(new URL('./reporter.js', import.meta.url));
    const args = [playwright.cli, 'test', '--config', config.playwrightConfig, '--forbid-only', '--reporter', `list,${reporter}`, '--output', path.join(outputDir, 'artifacts')];
    run.command = [process.execPath, ...args];
    const result = await execute(process.execPath, args, { cwd: root, quiet, logFile: path.join(outputDir, 'runner.log'), env: { SDDFW_PLAYWRIGHT_REPORT: path.join(outputDir, 'playwright.json'), SDDFW_OUTPUT_DIR: outputDir, SDDFW_PROJECT_ROOT: root, SDDFW_PROTECTED_PATHS: JSON.stringify(snapshotOptions.protectedPaths) }, timeoutMs: 600_000 });
    runnerExitCode = result.code;
    if (await exists(path.join(outputDir, 'playwright.json'))) raw = JSON.parse(await readFile(path.join(outputDir, 'playwright.json'), 'utf8'));
    else raw.errors.push({ message: 'Playwright did not produce a report. Check runner.log for missing configuration, browser or service.' });
    if (result.timedOut || result.signal) raw.errors.push({ message: `Runner interrupted: ${result.timedOut ? '10 minute limit' : result.signal}` });
  } catch (error) { raw.errors.push({ message: error.message }); }
  try {
    if (!raw.sourceFiles || Array.isArray(raw.sourceFiles) || typeof raw.sourceFiles !== 'object' || !Array.isArray(raw.protectedPaths) || typeof raw.projectRoot !== 'string') throw new Error('Playwright did not capture the source snapshot before executing tests.');
    if (await realpath(raw.projectRoot) !== await realpath(root)) throw new Error('Playwright captured sources from a different project root.');
    for (const [file, digest] of Object.entries(raw.sourceFiles)) {
      await projectPath(root, file);
      if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid captured source digest.');
    }
    const actualPaths = [];
    for (const file of raw.protectedPaths) actualPaths.push(path.relative(root, await projectPath(root, file)).split(path.sep).join('/'));
    run.sourcePaths = [...new Set([...snapshotOptions.protectedPaths, ...actualPaths])];
    if (Object.entries(sources).some(([file, digest]) => raw.sourceFiles[file] !== digest)) raw.errors.push({ message: 'Source changed while preparing the Playwright run; rerun against a stable revision.' });
    run.sourceFiles = raw.sourceFiles;
    run.sourceHash = snapshotHash(raw.sourceFiles);
  } catch (error) { raw.errors.push({ message: error.message }); }
  run.finishedAt = new Date().toISOString();
  const currentSpec = await readSpec(root, slug, { approved: true });
  if (snapshotHash(await sourceSnapshot(root, { protectedPaths: run.sourcePaths ?? snapshotOptions.protectedPaths })) !== run.sourceHash || specHash(currentSpec) !== run.specHash || snapshotHash({ config: await readFile(path.join(root, '.sddfw/config.json'), 'utf8') }) !== configHash) raw.errors.push({ message: 'Source/spec/config changed during verification; rerun against a stable revision.' });
  const report = evaluateAcceptance({ spec, playwrightReport: raw, run, runnerExitCode });
  await writeAcceptanceReports(report, outputDir);
  await writeJSON(changePaths(root, slug).state, { schemaVersion: 1, lastRun: id, status: report.status, specHash: run.specHash });
  if (!quiet) {
    console.log(`\nAcceptance: ${report.status}\n${report.criteria.map(c => `${c.status.padEnd(10)} ${c.id} ${c.description}`).join('\n')}\nReport: ${path.join(outputDir, 'acceptance.html')}\nMarkdown: ${path.join(outputDir, 'acceptance.md')}`);
  }
  return report;
}
export async function latestReport(root, slug) {
  const spec = await readSpec(root, slug, { approved: true });
  const config = await readConfig(root);
  let state;
  try { state = JSON.parse(await readFile(changePaths(root, slug).state, 'utf8')); } catch { throw new Error(`No evidence yet. Run: sddfw verify ${slug}`); }
  if (!/^[a-zA-Z0-9-]+$/.test(state.lastRun ?? '')) throw new Error('Invalid evidence run ID.');
  const dir = path.join(root, '.sddfw/runs', state.lastRun);
  const report = JSON.parse(await readFile(path.join(dir, 'acceptance.json'), 'utf8'));
  const recordedPaths = report.run.sourcePaths ?? [config.testDir, config.playwrightConfig];
  for (const file of recordedPaths) await projectPath(root, file);
  const fresh = report.run.specHash === specHash(spec) && report.run.sourceHash === snapshotHash(await sourceSnapshot(root, { protectedPaths: recordedPaths })) && report.run.configHash === snapshotHash({ config: await readFile(path.join(root, '.sddfw/config.json'), 'utf8') });
  return { report, dir, fresh };
}
