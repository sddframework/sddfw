import { access, readFile, writeFile, mkdir, cp, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execute } from './process.js';
import { writeJSON, changePaths } from './spec.js';

export const packageRoot = fileURLToPath(new URL('../', import.meta.url));
export async function exists(file) { try { await access(file); return true; } catch { return false; } }
export async function projectPath(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(p => p === '..' || p === '.git' || p === 'node_modules' || p === '.sddfw')) throw new Error(`Expected a relative project path: ${relative}`);
  const resolved = path.resolve(root, relative.replaceAll('\\', path.sep));
  if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`Path outside project: ${relative}`);
  return resolved;
}
export async function readConfig(root) {
  let config;
  try { config = JSON.parse(await readFile(path.join(root, '.sddfw/config.json'), 'utf8')); } catch { throw new Error('Initialize this project first: sddfw init'); }
  if (config.schemaVersion !== 1 || typeof config.environment !== 'string' || !config.environment.trim() || !Array.isArray(config.mockedServices) || config.mockedServices.some(x => typeof x !== 'string')) throw new Error('Invalid .sddfw/config.json. Check schemaVersion, environment and mockedServices.');
  if (config.acceptanceProjects !== undefined && (!Array.isArray(config.acceptanceProjects) || !config.acceptanceProjects.length || config.acceptanceProjects.some(x => typeof x !== 'string'))) throw new Error('acceptanceProjects must be a nonempty list of Playwright project names.');
  config.playwrightConfig = path.relative(root, await projectPath(root, config.playwrightConfig)).split(path.sep).join('/');
  config.testDir = path.relative(root, await projectPath(root, config.testDir)).split(path.sep).join('/');
  return config;
}
export async function initialize(root, { demo = false, install = false, 'test-dir': testDirOption, config: configOption } = {}) {
  const configFile = path.join(root, '.sddfw/config.json');
  if (demo) {
    const templateRoot = path.join(packageRoot, 'templates/fullstack');
    for (const item of [...await readdir(templateRoot), '.sddfw']) if (await exists(path.join(root, item))) throw new Error(`Demo needs a clean directory; ${item} already exists. Use sddfw init for an existing project.`);
    for (const entry of await readdir(templateRoot)) await cp(path.join(templateRoot, entry), path.join(root, entry), { recursive: true, force: false, errorOnExist: true, filter: source => !path.relative(templateRoot, source).split(path.sep).some(part => ['node_modules', 'test-results', '.data'].includes(part)) });
    const spec = JSON.parse(await readFile(path.join(root, 'spec.json'), 'utf8'));
    await writeJSON(changePaths(root, 'favorites').spec, spec);
  }
  const configNames = ['playwright.config.ts', 'playwright.config.mts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs'];
  let playwrightConfig = configOption;
  if (playwrightConfig) await projectPath(root, playwrightConfig);
  if (!playwrightConfig) for (const name of configNames) if (await exists(path.join(root, name))) { playwrightConfig = name; break; }
  if (!playwrightConfig) {
    playwrightConfig = 'playwright.config.mjs';
    await writeFile(path.join(root, playwrightConfig), "import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: './tests', forbidOnly: true, retries: 0, use: { baseURL: process.env.SDDFW_BASE_URL || 'http://127.0.0.1:3000', trace: 'retain-on-failure', screenshot: 'only-on-failure' } });\n", { flag: 'wx' });
  }
  const configText = await exists(path.join(root, playwrightConfig)) ? await readFile(path.join(root, playwrightConfig), 'utf8') : '';
  const inferred = configText.match(/\btestDir\s*:\s*['"]([^'"]+)['"]/)?.[1] ?? 'tests';
  const inferredRelative = path.relative(root, path.resolve(root, path.dirname(playwrightConfig), inferred.replaceAll('\\', path.sep)));
  const testDir = path.relative(root, await projectPath(root, testDirOption ?? inferredRelative)).split(path.sep).join('/');
  playwrightConfig = path.relative(root, await projectPath(root, playwrightConfig)).split(path.sep).join('/');
  if (!(await exists(configFile))) await writeJSON(configFile, { schemaVersion: 1, playwrightConfig, testDir, environment: 'local', mockedServices: demo ? ['demo identity selector (not authentication)'] : [] });
  if (!(await exists(path.join(root, 'package.json')))) await writeJSON(path.join(root, 'package.json'), { name: 'sddfw-project', private: true, type: 'module', scripts: { 'test:e2e': 'playwright test' } });
  await mkdir(path.join(root, testDir), { recursive: true });
  const ignorePath = path.join(root, '.gitignore');
  const previousIgnore = await exists(ignorePath) ? await readFile(ignorePath, 'utf8') : '';
  const ignores = ['node_modules/', '.sddfw/runs/', '.sddfw/changes/*/agent-*.log', 'test-results/', 'playwright-report/', '.data/'];
  const additions = ignores.filter(value => !previousIgnore.split(/\r?\n/).includes(value));
  if (additions.length) await writeFile(ignorePath, `${previousIgnore}${previousIgnore && !previousIgnore.endsWith('\n') ? '\n' : ''}${additions.join('\n')}\n`);
  if (!(await exists(path.join(root, '.sddfw/AGENT.md')))) await writeFile(path.join(root, '.sddfw/AGENT.md'), agentInstructions);
  if (install) {
    console.log('Installing Playwright and Chromium in this project…');
    const installed = await execute(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--save-dev', '@playwright/test@1.63.0'], { cwd: root });
    if (installed.code !== 0) throw new Error('Dependency installation failed. Retry npm install --save-dev @playwright/test.');
    const browser = await execute(process.execPath, [resolvePlaywright(root).cli, 'install', 'chromium'], { cwd: root });
    if (browser.code !== 0) throw new Error('Browser installation failed. Retry npx playwright install chromium.');
  }
  console.log(`Initialized SDDFW. ${demo ? 'Review .sddfw/changes/favorites/spec.json, then: sddfw approve favorites && sddfw verify favorites' : 'Next: sddfw change my-change --intent "Describe the behavior" --agent auto'}`);
  return readConfig(root);
}
export function resolvePlaywright(root) {
  const require = createRequire(path.join(root, 'package.json'));
  try {
    const location = require.resolve('@playwright/test/package.json');
    const metadata = require('@playwright/test/package.json');
    return { cli: path.join(path.dirname(location), 'cli.js'), version: metadata.version };
  } catch { throw new Error('Playwright is missing from this project. Run: npm install --save-dev @playwright/test && npx playwright install chromium'); }
}
export const agentInstructions = `# SDDFW agent workflow\n\nRead the accepted change specification and plan before editing. Propose observable Given/When/Then scenarios. Reuse existing Playwright tests; create or adapt tests for missing coverage. Tag every acceptance test with @sddfw:CRITERION-ID. Preserve expected behavior, assertions, spec and approval. Never skip, mark expected failure or weaken a test to get green. Diagnose whether failures belong to product, test or environment. During implementation preserve the approved tests. Report any needed test correction for explicit review. Execute verification through sddfw verify CHANGE. Do not deploy, publish, commit, read credentials or alter unrelated files. Respect the user's agent permissions.\n`;
