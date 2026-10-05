import { rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

export default async function cleanup(config) {
  const directory = config.metadata.demoDataDir;
  if (typeof directory !== 'string' || dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('sddfw-favorites-test-')) {
    throw new Error('Refusing to clean an unexpected demo data directory.');
  }
  await rm(directory, { recursive: true, force: true });
}
