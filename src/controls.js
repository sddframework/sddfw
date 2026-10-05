import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readConfig } from './project.js';
import { changePaths, readSpec, specHash } from './spec.js';
import { snapshotHash } from './provenance.js';

export async function captureWorkflowControls(root, slug, config) {
  const configFile = path.join(root, '.sddfw/config.json');
  const configText = await readFile(configFile, 'utf8');
  if (JSON.stringify(await readConfig(root)) !== JSON.stringify(config) || configText !== await readFile(configFile, 'utf8')) {
    throw new Error('SDDFW configuration changed after it was loaded. Restart the workflow against the reviewed configuration.');
  }
  const spec = await readSpec(root, slug, { approved: true });
  const approvalText = await readFile(changePaths(root, slug).approval, 'utf8');
  if (JSON.parse(approvalText).specHash !== specHash(spec)) {
    throw new Error('Accepted specification/config/approval changed since workflow preparation. Review the preserved changes and restart the workflow.');
  }
  return { specHash: specHash(spec), configHash: snapshotHash({ config: configText }), approvalHash: snapshotHash({ approval: approvalText }) };
}

export async function assertWorkflowControls(root, slug, config, expected) {
  const keys = ['specHash', 'configHash', 'approvalHash'];
  if (!expected || keys.some(key => !/^[a-f0-9]{64}$/.test(expected[key] ?? ''))) {
    throw new Error('Accepted workflow preparation hashes are required before implementation.');
  }
  const actual = await captureWorkflowControls(root, slug, config);
  if (keys.some(key => actual[key] !== expected[key])) {
    throw new Error('Accepted specification/config/approval changed since workflow preparation. Review the preserved changes and restart the workflow.');
  }
  return actual;
}
