import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const excluded = new Set(['.git', '.sddfw', 'node_modules', 'test-results', 'playwright-report', '.artifacts', '.data', 'dist', 'coverage', '.next', '.cache']);
const privateName = /^(\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx)|auth\.json|storage[Ss]tate\.json)$/;
export async function sourceSnapshot(root, { protectedPaths = [] } = {}) {
  const files = {};
  async function walk(dir, excludedParent = false) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name), relative = path.relative(root, full).split(path.sep).join('/');
      const protectedPath = protectedPaths.some(target => relative === target || relative.startsWith(`${target}/`) || target.startsWith(`${relative}/`));
      const excludedPath = excludedParent || excluded.has(entry.name) || privateName.test(entry.name);
      if (!protectedPath && excludedPath) continue;
      if (entry.isDirectory()) await walk(full, excludedPath);
      else if (entry.isSymbolicLink()) throw new Error(`Source snapshot does not follow symlinks: ${relative}. Move generated links outside source directories.`);
      else if (entry.isFile()) {
        if ((await stat(full)).size > 20_000_000) throw new Error(`Source file too large to record: ${relative}. Move generated artifacts to .artifacts/ or another excluded output directory.`);
        files[relative] = createHash('sha256').update(await readFile(full)).digest('hex');
      }
    }
  }
  await walk(root);
  return files;
}
// Reporter.onBegin is synchronous in Playwright 1.50+, so its source capture must
// finish before returning to the runner. Keep the same policy as sourceSnapshot.
export function sourceSnapshotSync(root, { protectedPaths = [] } = {}) {
  const files = {};
  function walk(dir, excludedParent = false) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name), relative = path.relative(root, full).split(path.sep).join('/');
      const protectedPath = protectedPaths.some(target => relative === target || relative.startsWith(`${target}/`) || target.startsWith(`${relative}/`));
      const excludedPath = excludedParent || excluded.has(entry.name) || privateName.test(entry.name);
      if (!protectedPath && excludedPath) continue;
      if (entry.isDirectory()) walk(full, excludedPath);
      else if (entry.isSymbolicLink()) throw new Error(`Source snapshot does not follow symlinks: ${relative}. Move generated links outside source directories.`);
      else if (entry.isFile()) {
        if (statSync(full).size > 20_000_000) throw new Error(`Source file too large to record: ${relative}. Move generated artifacts to .artifacts/ or another excluded output directory.`);
        files[relative] = createHash('sha256').update(readFileSync(full)).digest('hex');
      }
    }
  }
  walk(root);
  return files;
}
export function snapshotHash(files) { return createHash('sha256').update(JSON.stringify(Object.entries(files).sort(([a],[b]) => a.localeCompare(b)))).digest('hex'); }
export function changedFiles(before, after) { return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(file => before[file] !== after[file]); }
export async function controlSnapshot(root, allowedSpec) {
  const files = {};
  async function walk(dir) {
    let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name), relative = path.relative(root, full).split(path.sep).join('/');
      if (entry.name === 'runs') continue;
      if (entry.isDirectory()) await walk(full);
      else if (entry.isSymbolicLink()) throw new Error(`SDDFW control files cannot be symlinks: ${relative}`);
      else if (['spec.json', 'approval.json', 'config.json', 'AGENT.md'].includes(entry.name) && relative !== allowedSpec) files[relative] = createHash('sha256').update(await readFile(full)).digest('hex');
    }
  }
  await walk(path.join(root, '.sddfw'));
  return files;
}
export function gitContext(root) {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
    return { commit, dirty };
  } catch { return { commit: null, dirty: null }; }
}
