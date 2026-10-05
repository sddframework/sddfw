import { mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

function errorDetails(error) {
  return {
    message: String(error?.message ?? error?.value ?? 'Unknown Playwright error'),
    ...(error?.stack ? { stack: String(error.stack) } : {}),
    ...(error?.location ? { location: error.location } : {}),
  };
}

function assertionCount(steps = []) {
  return steps.reduce((count, step) => count + (step.category === 'expect' ? 1 : 0) + assertionCount(step.steps), 0);
}

function testDetails(test, rootDir) {
  const titlePath = test.titlePath();
  const tags = [...new Set([
    ...(test.tags ?? []),
    ...titlePath.flatMap(title => title.match(/@[^\s]+/g) ?? []),
  ])];
  return {
    id: test.id,
    title: test.title,
    titlePath,
    tags,
    project: test.parent.project()?.name ?? '',
    file: test.location?.file ? path.relative(rootDir, test.location.file) : '',
    line: test.location?.line ?? null,
    expectedStatus: test.expectedStatus,
    retries: test.retries,
    repeatEachIndex: test.repeatEachIndex ?? 0,
    outcome: test.outcome(),
  };
}

function suiteDetails(suite, rootDir) {
  return {
    title: suite.title,
    type: suite.type,
    project: suite.project()?.name ?? null,
    file: suite.location?.file ? path.relative(rootDir, suite.location.file) : null,
    tests: suite.tests.map(test => test.id),
    suites: suite.suites.map(child => suiteDetails(child, rootDir)),
  };
}

/** Playwright's documented Reporter API, without importing its runner or collecting stdio/env. */
export default class SddfwReporter {
  constructor(options = {}) {
    this.outputFile = options.outputFile ?? process.env.SDDFW_PLAYWRIGHT_REPORT;
    this.tests = new Map();
    this.errors = [];
    this.suites = [];
    this.projects = [];
    this.rootDir = process.cwd();
  }

  printsToStdio() { return false; }

  onBegin(config, suite) {
    this.rootDir = config.rootDir ?? process.cwd();
    // Empty project suites are omitted by Playwright. Keep the configured inventory
    // so a project with no matching tests cannot silently disappear from acceptance.
    this.projects = (config.projects ?? []).map(project => ({
      name: project.name,
      dependencies: project.dependencies ?? [],
    })).filter((project, index, projects) => projects.findIndex(candidate => candidate.name === project.name) === index);
    this.suites = suite.suites.map(child => suiteDetails(child, this.rootDir));
    for (const test of suite.allTests()) this.tests.set(test.id, test);
  }

  onTestEnd(test) {
    // Preserve discoveries with no result as well as runtime skip/fail annotations.
    this.tests.set(test.id, test);
  }

  onError(error) { this.errors.push(errorDetails(error)); }

  async onEnd(result) {
    if (!this.outputFile) throw new Error('SDDFW_PLAYWRIGHT_REPORT is required by the SDDFW reporter.');
    const outputFile = path.resolve(this.outputFile);
    const outputDir = path.dirname(outputFile);
    await mkdir(outputDir, { recursive: true });
    let attachmentIndex = 0;
    const tests = [];
    for (const test of this.tests.values()) {
      const results = [];
      for (const attempt of test.results ?? []) {
        const attachments = [];
        for (const attachment of attempt.attachments ?? []) {
          const metadata = { name: attachment.name, contentType: attachment.contentType };
          if (attachment.path) metadata.path = path.resolve(attachment.path);
          if (attachment.body) {
            // Buffer attachments stay in local artifacts, never embedded in summaries or JSON.
            const extensions = { 'image/png': '.png', 'image/jpeg': '.jpg', 'application/json': '.json', 'text/plain': '.txt' };
            const localPath = path.join(outputDir, 'attachments', `${++attachmentIndex}${extensions[attachment.contentType] ?? '.bin'}`);
            await mkdir(path.dirname(localPath), { recursive: true });
            await writeFile(localPath, attachment.body);
            metadata.path = localPath;
            metadata.bodyLength = attachment.body.length;
          }
          attachments.push(metadata);
        }
        results.push({
          retry: attempt.retry,
          status: attempt.status,
          duration: attempt.duration,
          startTime: attempt.startTime?.toISOString?.() ?? null,
          errors: (attempt.errors?.length ? attempt.errors : attempt.error ? [attempt.error] : []).map(errorDetails),
          attachments,
          assertionSteps: Array.isArray(attempt.steps) ? assertionCount(attempt.steps) : null,
        });
      }
      tests.push({ ...testDetails(test, this.rootDir), status: results.at(-1)?.status ?? 'notRun', results });
    }
    const report = {
      schemaVersion: 1,
      projects: this.projects,
      suites: this.suites,
      tests,
      errors: this.errors,
      status: result.status,
      startedAt: result.startTime?.toISOString?.() ?? null,
      durationMs: result.duration ?? null,
    };
    // Avoid leaving a partly written report that could be mistaken for evidence.
    const temporaryPath = `${outputFile}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`);
    await rename(temporaryPath, outputFile);
  }
}
