import { mkdir, writeFile, rename } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { sourceSnapshotSync } from './provenance.js';

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

function sourceFileLocation(rootDir, file) {
  let resolved = path.resolve(rootDir, file);
  try { resolved = realpathSync(resolved); } catch { /* Preserve location if a test removed its source. */ }
  return path.relative(rootDir, resolved).split(path.sep).join('/');
}

function relativeSourceFile(rootDir, file) {
  let resolved = file;
  try { resolved = realpathSync(file); } catch {}
  return path.relative(rootDir, resolved).split(path.sep).join('/');
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
    file: test.location?.file ? sourceFileLocation(rootDir, test.location.file) : '',
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
    file: suite.location?.file ? sourceFileLocation(rootDir, suite.location.file) : null,
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
    this.protectedPaths = [];
    this.sourceFiles = null;
    this.sourceCaptured = false;
  }

  printsToStdio() { return false; }

  onBegin(config, suite) {
    if (this.sourceCaptured) return;
    this.sourceCaptured = true;
    this.rootDir = path.resolve(process.env.SDDFW_PROJECT_ROOT ?? config.rootDir ?? process.cwd());
    try { this.rootDir = realpathSync(this.rootDir); }
    catch (error) { this.errors.push({ message: `Project root is unavailable: ${error.message}` }); }
    const protectedPaths = new Set();
    const relativePath = (candidate, label) => {
      if (typeof candidate !== 'string' || !candidate) {
        this.errors.push({ message: `${label} is missing or is not a path.` });
        return null;
      }
      let resolved = path.resolve(this.rootDir, candidate);
      try { resolved = realpathSync(resolved); } catch { /* Missing configured paths are still recorded. */ }
      const relative = path.relative(this.rootDir, resolved);
      if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
        this.errors.push({ message: `${label} is outside the SDDFW project root.` });
        return null;
      }
      return relative.split(path.sep).join('/') || '.';
    };
    try {
      const declared = JSON.parse(process.env.SDDFW_PROTECTED_PATHS ?? '[]');
      if (!Array.isArray(declared) || declared.some(candidate => typeof candidate !== 'string')) throw new Error('Expected a JSON array of paths.');
      for (const candidate of declared) {
        const relative = relativePath(candidate, 'Protected path');
        if (relative && relative !== '.') protectedPaths.add(relative);
      }
    } catch (error) {
      this.errors.push({ message: `Invalid SDDFW_PROTECTED_PATHS: ${error.message}` });
    }
    // Empty project suites are omitted by Playwright. Keep the configured inventory
    // so a project with no matching tests cannot silently disappear from acceptance.
    this.projects = (config.projects ?? []).map(project => {
      const testDir = relativePath(project.testDir ?? config.rootDir, `Test directory for project ${project.name}`);
      if (testDir && testDir !== '.') protectedPaths.add(testDir);
      return { name: project.name, dependencies: project.dependencies ?? [], testDir };
    }).filter((project, index, projects) => projects.findIndex(candidate => candidate.name === project.name) === index);
    this.suites = suite.suites.map(child => suiteDetails(child, this.rootDir));
    const discoveredFiles = [];
    for (const test of suite.allTests()) {
      this.tests.set(test.id, test);
      const file = relativePath(test.location?.file, 'Discovered test file');
      if (file && file !== '.') {
        protectedPaths.add(file);
        discoveredFiles.push(file);
      }
    }
    this.protectedPaths = [...protectedPaths].sort();
    try {
      this.sourceFiles = sourceSnapshotSync(this.rootDir, { protectedPaths: this.protectedPaths });
      for (const file of discoveredFiles) {
        if (!Object.hasOwn(this.sourceFiles, file)) this.errors.push({ message: `Discovered test was not captured in the source snapshot: ${file}` });
      }
    } catch (error) {
      this.errors.push({ message: `Source snapshot failed: ${error.message}` });
    }
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
    if (!this.sourceCaptured) this.errors.push({ message: 'Source snapshot was not captured before test execution.' });
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
      projectRoot: this.rootDir,
      protectedPaths: this.protectedPaths,
      sourceFiles: this.sourceFiles,
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
