#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { initialize, readConfig, resolvePlaywright, exists } from '../src/project.js';
import { changePaths, writeJSON, readSpec, approveSpec } from '../src/spec.js';
import { chooseAgent, availableAgents, draftWithAgent, createPlan, runAgentPhase } from '../src/agents.js';
import { verify, latestReport } from '../src/verify.js';

const help = `SDDFW 0.1 — Build with intent. Ship with evidence.

  sddfw init [--demo] [--install]     Initialize project; demo needs a clean directory
  sddfw change NAME --intent TEXT [--agent auto|codex|claude|manual]
                                    Draft a specification (AI optional)
  sddfw approve NAME                Record your explicit review of the spec
  sddfw plan NAME                   Export scenarios and agent instructions
  sddfw run NAME [--agent auto|codex|claude|manual]
                                    Prepare tests, implement and verify
  sddfw verify NAME                 Run Playwright, generate acceptance reports
  sddfw report NAME                 Show latest evidence and source freshness
  sddfw doctor                      Check configuration, tools and browser

Options: --cwd DIR, --help, --version; init --config FILE --test-dir DIR.
Existing files are preserved by init.
AI calls use your installed/authenticated coding agent; provider usage applies.
Results remain local. Review scenarios and evidence before merging.
`;
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: {
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }, demo: { type: 'boolean' }, install: { type: 'boolean' }, intent: { type: 'string' }, agent: { type: 'string' }, cwd: { type: 'string' }, config: { type: 'string' }, 'test-dir': { type: 'string' }
  } });
  const [command = 'help', slug] = positionals;
  if (values.version) { console.log('0.1.0'); return; }
  if (values.help || command === 'help') { console.log(help); return; }
  const root = path.resolve(values.cwd ?? process.cwd());
  await mkdir(root, { recursive: true });
  if (command === 'init') { await initialize(root, values); return; }
  if (command === 'doctor') {
    const problems = [];
    console.log(`Node ${process.version}; agents: ${availableAgents().join(', ') || 'none (manual instructions supported)'}`);
    try {
      const config = await readConfig(root); console.log(`Config: ${config.playwrightConfig}; environment: ${config.environment}`);
      if (!(await exists(path.join(root, config.playwrightConfig)))) problems.push('Playwright configuration is missing.');
      const playwright = resolvePlaywright(root); console.log(`Playwright ${playwright.version}`);
      const { createRequire } = await import('node:module');
      const require = createRequire(path.join(root, 'package.json'));
      const browser = require('@playwright/test').chromium.executablePath();
      if (!(await exists(browser))) problems.push('Chromium is missing: npx playwright install chromium');
      else console.log('Chromium installed. Other configured browsers are checked when tests run.');
    } catch (error) { problems.push(error.message); }
    if (problems.length) { console.error(problems.join('\n')); process.exitCode = 2; } else console.log('Ready for local verification.');
    return;
  }
  const config = await readConfig(root);
  if (command === 'change') {
    const files = changePaths(root, slug);
    if (await exists(files.spec)) throw new Error(`Change ${slug} already exists; edit its spec.json and approve again.`);
    if (!values.intent?.trim()) throw new Error('Describe the change with --intent "Expected behavior".');
    await writeJSON(files.spec, { schemaVersion: 1, title: slug, intent: values.intent, criteria: [{ id: 'AC-001', description: 'TODO: observable behavior', given: 'TODO: initial state', when: 'TODO: user action', then: 'TODO: expected outcome' }] });
    if (values.agent && values.agent !== 'manual') await draftWithAgent(root, slug, chooseAgent(values.agent), config);
    console.log(`Draft: ${files.spec}\nReview the scenarios and resolve TODOs, then: sddfw approve ${slug}`);
    return;
  }
  if (command === 'approve') {
    const spec = await approveSpec(root, slug);
    console.log(`Accepted ${spec.title} with ${spec.criteria.length} criteria. Next: sddfw run ${slug} (or sddfw verify ${slug} for existing tests).`); return;
  }
  if (command === 'plan') { console.log((await createPlan(root, slug, config)).planFile); return; }
  if (command === 'verify') { const report = await verify(root, slug, config); process.exitCode = report.status === 'passed' ? 0 : 1; return; }
  if (command === 'report') {
    const { report, dir, fresh } = await latestReport(root, slug);
    console.log(`${fresh ? report.status : 'STALE — sources/config changed; rerun verification'}\n${path.join(dir, 'acceptance.html')}\n${path.join(dir, 'acceptance.md')}`);
    process.exitCode = fresh && report.status === 'passed' ? 0 : 1; return;
  }
  if (command === 'run') {
    const { planFile } = await createPlan(root, slug, config);
    const agent = chooseAgent(values.agent);
    if (agent === 'manual') { console.log(`Task instructions: ${planFile}\nUse them with your coding agent; then: sddfw verify ${slug}\nNo implementation was executed.`); return; }
    resolvePlaywright(root);
    console.log('1/4 Preparing acceptance tests…'); await runAgentPhase(root, slug, config, agent, 'tests');
    console.log('2/4 Checking prepared tests against the current product…');
    const baseline = await verify(root, slug, config);
    if (baseline.criteria.some(c => ['blocked', 'unverified', 'flaky'].includes(c.status)) || baseline.summary.issues.length) throw new Error(`Prepared tests have missing, blocked or unstable evidence; inspect the report before implementation. Correct coverage/environment or review unstable tests, then run again.`);
    const frozenPaths = baseline.run.sourcePaths;
    const frozenFiles = Object.fromEntries(Object.entries(baseline.run.sourceFiles).filter(([file]) => frozenPaths.some(target => file === target || file.startsWith(`${target}/`))));
    let report = baseline;
    for (let attempt = 1; attempt <= 2; attempt++) {
      console.log(`3/4 Implementing against the accepted spec and frozen tests (attempt ${attempt}/2)…`);
      await runAgentPhase(root, slug, config, agent, 'implement', { attempt, lastReport: report.status === 'failed' ? report : undefined, frozenPaths, frozenFiles });
      console.log('4/4 Verifying the change…');
      report = await verify(root, slug, config);
      if (report.status !== 'failed' || report.criteria.some(c => ['blocked', 'unverified', 'flaky'].includes(c.status)) || report.summary.issues.length) break;
    }
    process.exitCode = report.status === 'passed' ? 0 : 1; return;
  }
  throw new Error(`Unknown command: ${command}. Run sddfw help.`);
}
main().catch(error => { console.error(`SDDFW: ${error.message}`); process.exitCode = 2; });
