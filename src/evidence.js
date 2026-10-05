import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

const statuses = ['passed', 'failed', 'unverified', 'blocked', 'flaky'];
const priority = ['failed', 'blocked', 'flaky', 'unverified', 'passed'];
const testStatuses = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']);
const infrastructureError = /executable doesn't exist|browserType\.launch|browser executable|please run.*playwright install|connect ECONNREFUSED|net::ERR_CONNECTION_REFUSED|webServer.*(?:failed|timed out)|process from config\.webServer/i;

function combinedStatus(values) {
  return priority.find(status => values.includes(status)) ?? 'unverified';
}

function testEvidence(test) {
  const results = Array.isArray(test.results) ? test.results.filter(result => result && typeof result === 'object') : [];
  let status = 'unverified';
  let reason = 'Test was discovered but did not execute.';
  if (!Array.isArray(test.results) || !['passed', 'failed', 'skipped', 'timedOut', 'interrupted'].includes(test.expectedStatus)) {
    reason = 'Test evidence is incomplete or malformed.';
  } else if (test.expectedStatus !== 'passed') {
    reason = test.expectedStatus === 'skipped'
      ? 'Skipped or fixme test cannot verify acceptance.'
      : 'Test expects a failure and cannot verify acceptance.';
  } else if (results.length) {
    const final = results.at(-1);
    const invalidAttempts = results.length !== test.results.length || results.some((result, index) => !testStatuses.has(result.status) || result.retry !== index || !Array.isArray(result.errors));
    if (invalidAttempts) {
      reason = 'Test attempt evidence is incomplete or malformed.';
    } else if (final.status === 'interrupted') {
      status = 'blocked'; reason = 'Test execution was interrupted.';
    } else if (final.status === 'skipped') {
      reason = 'Test was skipped and did not verify acceptance.';
    } else if (final.status !== 'passed') {
      const errorText = final.errors.map(error => error?.message ?? '').join('\n');
      status = infrastructureError.test(errorText) ? 'blocked' : 'failed';
      reason = status === 'blocked' ? 'Required browser or service was unavailable.' : 'Test did not pass.';
    } else if (results.length > 1 || test.outcome === 'flaky') {
      status = 'flaky'; reason = 'Test passed only after retry; acceptance is not stable.';
    } else if (Array.isArray(final.errors) && final.errors.length) {
      status = 'failed'; reason = 'Test recorded errors despite a passed result.';
    } else if (!Number.isInteger(final.assertionSteps) || final.assertionSteps < 1) {
      reason = 'Test passed without recorded Playwright assertions; acceptance is not verified.';
    } else {
      status = 'passed'; reason = 'Test executed and passed without retries.';
    }
  }
  return {
    id: test.id,
    title: test.title,
    project: test.project,
    file: test.file,
    line: test.line,
    tags: test.tags,
    expectedStatus: test.expectedStatus,
    retries: test.retries,
    status,
    reason,
    results,
  };
}

/** A deterministic interpretation of executed tests, not a judgment that tests capture intent. */
export function evaluateAcceptance({ spec, playwrightReport, run = {}, runnerExitCode }) {
  const issues = [];
  const rawTests = Array.isArray(playwrightReport?.tests) ? playwrightReport.tests : [];
  const malformed = !playwrightReport || playwrightReport.schemaVersion !== 1 ||
    !Array.isArray(playwrightReport.tests) || !Array.isArray(playwrightReport.projects) ||
    !Array.isArray(playwrightReport.errors) || !['passed', 'failed', 'timedout', 'interrupted'].includes(playwrightReport.status);
  if (malformed) issues.push({ status: 'blocked', code: 'invalid_report', reason: 'Playwright evidence is missing or malformed.' });
  const ids = new Set();
  const tests = rawTests.filter(test => {
    if (!test || typeof test.id !== 'string' || ids.has(test.id) || typeof test.project !== 'string' || !Array.isArray(test.tags)) {
      issues.push({ status: 'blocked', code: 'invalid_test', reason: 'A test has missing, duplicate, or malformed identity evidence.' });
      return false;
    }
    ids.add(test.id);
    return true;
  }).map(testEvidence);
  const rawProjects = Array.isArray(playwrightReport?.projects) ? playwrightReport.projects : [];
  const discoveredProjects = [...new Set(rawProjects
    .map(project => typeof project === 'string' ? project : project?.name)
    .filter(name => typeof name === 'string'))];
  const dependencyNames = new Set(rawProjects.flatMap(project => Array.isArray(project?.dependencies) ? project.dependencies : []));
  const explicitProjects = Array.isArray(run.acceptanceProjects) && run.acceptanceProjects.length ? run.acceptanceProjects : null;
  const projects = explicitProjects ? [...new Set(explicitProjects)] : discoveredProjects.filter(name => !dependencyNames.has(name));
  if (rawProjects.some(project => typeof (typeof project === 'string' ? project : project?.name) !== 'string') ||
    tests.some(test => !discoveredProjects.includes(test.project))) issues.push({ status: 'blocked', code: 'invalid_project', reason: 'Test project evidence is incomplete or inconsistent.' });
  if (explicitProjects?.some(project => typeof project !== 'string' || !discoveredProjects.includes(project))) {
    issues.push({ status: 'blocked', code: 'missing_acceptance_project', reason: 'An explicitly selected acceptance project was not discovered by Playwright.' });
  }
  if (projects.length === 0) issues.push({ status: 'blocked', code: 'no_projects', reason: 'No selected Playwright project was recorded.' });
  if (playwrightReport?.errors?.length) issues.push({ status: 'blocked', code: 'global_error', reason: 'Playwright reported a global error; the run is incomplete.' });
  if (!Number.isInteger(runnerExitCode) || runnerExitCode < 0) {
    issues.push({ status: 'blocked', code: 'unknown_exit', reason: 'The runner exit code was not confirmed.' });
  } else if (runnerExitCode !== 0 && !tests.some(test => test.status === 'failed')) {
    issues.push({ status: 'blocked', code: 'runner_exit', reason: 'The runner exited unsuccessfully without a completed failing assertion.' });
  }
  if (playwrightReport?.status !== 'passed' && !malformed && !tests.some(test => test.status === 'failed')) {
    issues.push({ status: 'blocked', code: 'incomplete_run', reason: 'The Playwright run did not complete successfully.' });
  }
  const specCriteria = Array.isArray(spec?.criteria) ? spec.criteria : [];
  if (!specCriteria.length || new Set(specCriteria.map(criterion => criterion?.id)).size !== specCriteria.length ||
    specCriteria.some(criterion => !/^[A-Z][A-Z0-9]*-\d{3,}$/.test(criterion?.id ?? '') || typeof criterion?.description !== 'string' || !criterion.description.trim())) {
    issues.push({ status: 'blocked', code: 'invalid_spec', reason: 'The spec has no usable, uniquely identified acceptance criteria.' });
  }
  const criteria = specCriteria.filter(Boolean).map(criterion => {
    const mapped = tests.filter(test => test.tags.includes(`@sddfw:${criterion.id}`));
    const missing = projects.filter(project => !mapped.some(test => test.project === project));
    const status = combinedStatus([
      ...mapped.map(test => test.status),
      ...(missing.length || !mapped.length ? ['unverified'] : []),
    ]);
    const reasons = [...new Set(mapped.filter(test => test.status !== 'passed').map(test => test.reason))];
    if (!mapped.length) reasons.push('No test was discovered with the matching acceptance tag.');
    else if (missing.length) reasons.push(`No mapped test was discovered for project(s): ${missing.join(', ')}.`);
    return {
      id: criterion.id,
      description: criterion.description,
      status,
      reason: reasons.join(' ') || 'All mapped tests executed and passed in every selected project without retries.',
      tests: mapped,
    };
  });
  const summary = {
    total: criteria.length,
    ...Object.fromEntries(statuses.map(status => [status, criteria.filter(criterion => criterion.status === status).length])),
    tests: tests.length,
    assertionSteps: tests.reduce((count, test) => count + test.results.reduce((sum, result) => sum + (Number.isInteger(result.assertionSteps) && result.assertionSteps >= 0 ? result.assertionSteps : 0), 0), 0),
    runnerStatus: playwrightReport?.status ?? null,
    runnerExitCode: runnerExitCode ?? null,
    projects,
    issues,
  };
  return {
    schemaVersion: 1,
    title: spec?.title ?? 'Acceptance report',
    run: { ...run },
    criteria,
    status: combinedStatus([...criteria.map(criterion => criterion.status), ...tests.filter(test => ['failed', 'blocked', 'flaky'].includes(test.status)).map(test => test.status), ...issues.map(issue => issue.status)]),
    summary,
  };
}

function safeText(value) {
  return String(value ?? '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+\/-]+/gi, '$1 [redacted]')
    .replace(/\b(password|passwd|secret|token|api[_-]?key|authorization|cookie|access[_-]?token)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi, '$1=[redacted]');
}

function html(value) {
  return safeText(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function markdown(value) {
  return html(value).replace(/[\\`*_[\]{}|]/g, '\\$&').replace(/[\r\n]+/g, ' ');
}

async function artifactHref(attachment, outputDir) {
  if (!attachment?.path || !/\.(zip|png|jpe?g|webp|gif|webm|mp4|txt|json|log|bin)$/i.test(attachment.path)) return null;
  try {
    const [root, target] = await Promise.all([realpath(outputDir), realpath(path.resolve(attachment.path))]);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) return null;
    return `./${relative.split(path.sep).map(encodeURIComponent).join('/')}`;
  } catch { return null; }
}

/** Write local JSON plus escaped, shareable summaries. Detailed error messages stay in JSON. */
export async function writeAcceptanceReports(report, outputDir) {
  outputDir = path.resolve(outputDir);
  await mkdir(outputDir, { recursive: true });
  const artifacts = new Map();
  for (const criterion of report.criteria) {
    for (const test of criterion.tests) {
      const links = [];
      for (const result of test.results) {
        for (const attachment of result.attachments ?? []) {
          const href = await artifactHref(attachment, outputDir);
          if (href && !links.some(link => link.href === href)) links.push({ href, name: attachment.name ?? 'Artifact' });
        }
      }
      artifacts.set(test.id, links);
    }
  }
  const provenance = [
    ['Run', report.run.id], ['Started', report.run.startedAt], ['Finished', report.run.finishedAt ?? report.run.endedAt],
    ['Commit', report.run.commit], ['Working tree', report.run.dirty === null || report.run.dirty === undefined ? 'Git state unavailable' : report.run.dirty ? 'Modified' : 'Clean'],
    ['Spec SHA-256', report.run.specHash], ['Sources SHA-256', report.run.sourceHash],
    ['Environment', report.run.environment], ['Mocked services', (report.run.mockedServices ?? []).join(', ') || 'None declared'],
    ['Node.js', report.run.nodeVersion], ['Playwright', report.run.playwrightVersion], ['Runner exit', report.summary.runnerExitCode],
  ].filter(([, value]) => value !== undefined && value !== null);
  const boundary = 'These results show what the mapped tests checked in this historical run. Use sddfw report CHANGE to check source freshness; that does not recheck external services. Results do not prove that tests correctly interpret every requirement. Detailed JSON, traces and attachments are local and may contain sensitive data.';
  const md = [
    `# ${markdown(report.title)}`, '', `**Acceptance: ${markdown(report.status)}**`, '',
    `${markdown(report.summary.passed)}/${markdown(report.summary.total)} criteria passed. ${markdown(report.summary.tests)} discovered tests; ${markdown(report.summary.assertionSteps)} Playwright assertion steps recorded.`, '',
    ...provenance.map(([name, value]) => `- ${name}: ${markdown(value)}`), '',
    '| Criterion | Status | Result |', '| --- | --- | --- |',
    ...report.criteria.map(criterion => `| ${markdown(criterion.id)}: ${markdown(criterion.description)} | ${markdown(criterion.status)} | ${markdown(criterion.reason)} |`), '',
    ...report.summary.issues.map(issue => `- ${markdown(issue.reason)}`), '',
    ...report.criteria.flatMap(criterion => [
      `## ${markdown(criterion.id)}`, '',
      ...criterion.tests.map(test => `- ${markdown(test.project || '(default project)')} — ${markdown(test.title)} (${markdown(test.status)}; ${markdown(test.file)}:${markdown(test.line)}). ${(artifacts.get(test.id) ?? []).map(link => `[${markdown(link.name)}](${link.href})`).join(' ')}`), '',
    ]), boundary, '',
  ].join('\n');
  const content = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${html(report.title)} — SDDFW</title>
<style>body{margin:0;background:#f8f8f8;color:#202124;font:16px/1.55 system-ui,sans-serif}main{max-width:1000px;margin:auto;padding:32px 20px}h1{line-height:1.2}h2{font-size:1.2rem;margin-top:32px}.brand{color:#c82735;font-weight:750}.status{display:inline-block;border:1px solid #999;border-radius:6px;padding:4px 12px;font-weight:700}.passed{color:#17613d}.failed,.flaky{color:#a8212f}.blocked,.unverified{color:#725314}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{text-align:left;padding:12px;border-bottom:1px solid #ccc;vertical-align:top;overflow-wrap:anywhere}dl{display:grid;grid-template-columns:160px 1fr;gap:5px 15px}dt{font-weight:650}dd{margin:0;overflow-wrap:anywhere}a{color:#b22331}small{display:block;color:#666}.boundary{padding:16px;border:1px solid #ccc;border-radius:8px}@media(max-width:600px){main{padding:20px 12px}dl{display:block}dd{margin-bottom:10px}table{font-size:.9rem}th,td{padding:6px}}@media(prefers-color-scheme:dark){body{background:#202124;color:#e8eaed}small{color:#bdc1c6}td,th,.boundary{border-color:#555}.passed{color:#81c995}.failed,.flaky,a,.brand{color:#f28b82}.blocked,.unverified{color:#fdd663}}</style></head>
<body><main><p class="brand">SDDFW · Acceptance evidence</p><h1>${html(report.title)}</h1><p class="status ${html(report.status)}">${html(report.status)}</p><p>${html(report.summary.passed)}/${html(report.summary.total)} criteria passed. ${html(report.summary.tests)} discovered tests; ${html(report.summary.assertionSteps)} Playwright assertion steps recorded.</p><dl>${provenance.map(([name, value]) => `<dt>${html(name)}</dt><dd>${html(value)}</dd>`).join('')}</dl>
<table><thead><tr><th scope="col">Criterion</th><th scope="col">Status</th><th scope="col">Result</th></tr></thead><tbody>${report.criteria.map(criterion => `<tr><td>${html(criterion.id)}<small>${html(criterion.description)}</small></td><td class="${html(criterion.status)}">${html(criterion.status)}</td><td>${html(criterion.reason)}</td></tr>`).join('')}</tbody></table>
${report.summary.issues.length ? `<ul>${report.summary.issues.map(issue => `<li>${html(issue.reason)}</li>`).join('')}</ul>` : ''}
${report.criteria.map(criterion => `<section><h2>${html(criterion.id)}</h2><ul>${criterion.tests.map(test => `<li>${html(test.project || '(default project)')} — ${html(test.title)} <strong class="${html(test.status)}">${html(test.status)}</strong><small>${html(test.file)}:${html(test.line)}</small>${(artifacts.get(test.id) ?? []).map(link => `<a href="${html(link.href)}" rel="noreferrer">${html(link.name)}</a>`).join(' · ')}</li>`).join('')}</ul></section>`).join('')}
<p class="boundary">${html(boundary)}</p></main></body></html>\n`;
  const files = { json: path.join(outputDir, 'acceptance.json'), markdown: path.join(outputDir, 'acceptance.md'), html: path.join(outputDir, 'acceptance.html') };
  await Promise.all([
    writeFile(files.json, `${JSON.stringify(report, null, 2)}\n`),
    writeFile(files.markdown, md),
    writeFile(files.html, content),
  ]);
  return files;
}
