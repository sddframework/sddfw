import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export function slugName(value) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value ?? '') || value.length > 80) throw new Error('Use a change name such as add-favorites (lowercase letters, numbers and hyphens).');
  return value;
}
export function specHash(spec) {
  return createHash('sha256').update(JSON.stringify(spec)).digest('hex');
}
export function validateSpec(spec) {
  if (!spec || spec.schemaVersion !== 1) throw new Error('spec.json must declare schemaVersion: 1.');
  for (const key of ['title', 'intent']) if (typeof spec[key] !== 'string' || !spec[key].trim()) throw new Error(`spec.json needs a nonempty ${key}.`);
  if (!Array.isArray(spec.criteria) || !spec.criteria.length) throw new Error('Add at least one acceptance criterion.');
  const ids = new Set();
  for (const criterion of spec.criteria) {
    if (!/^[A-Z][A-Z0-9]*-\d{3,}$/.test(criterion.id ?? '') || ids.has(criterion.id)) throw new Error(`Invalid or duplicate criterion ID: ${criterion.id}. Use FAV-001.`);
    ids.add(criterion.id);
    for (const key of ['description', 'given', 'when', 'then']) {
      if (typeof criterion[key] !== 'string' || !criterion[key].trim() || /^(TODO|TBD)$/i.test(criterion[key].trim()) || /\b(TODO|TBD)\s*:/i.test(criterion[key])) throw new Error(`${criterion.id} needs a concrete ${key}; replace TODO/TBD markers before approval.`);
    }
  }
  return spec;
}
export function changePaths(root, slug) {
  const dir = path.join(root, '.sddfw', 'changes', slugName(slug));
  return { dir, spec: path.join(dir, 'spec.json'), approval: path.join(dir, 'approval.json'), state: path.join(dir, 'state.json') };
}
export async function readSpec(root, slug, { approved = false } = {}) {
  const files = changePaths(root, slug);
  let spec;
  try { spec = JSON.parse(await readFile(files.spec, 'utf8')); } catch (error) { throw new Error(`Cannot read ${files.spec}: ${error.message}`); }
  validateSpec(spec);
  if (approved) {
    let approval;
    try { approval = JSON.parse(await readFile(files.approval, 'utf8')); } catch { throw new Error(`Review the specification, then run: sddfw approve ${slug}`); }
    if (approval.specHash !== specHash(spec)) throw new Error(`Specification changed after approval. Review it and run: sddfw approve ${slug}`);
  }
  return spec;
}
export async function approveSpec(root, slug) {
  const spec = await readSpec(root, slug);
  await writeJSON(changePaths(root, slug).approval, { schemaVersion: 1, specHash: specHash(spec), acceptedAt: new Date().toISOString(), method: 'explicit-cli-review' });
  return spec;
}
export async function writeJSON(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
