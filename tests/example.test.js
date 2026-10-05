import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createDemoServer } from '../templates/fullstack/server.mjs';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function fixture(context, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'sddfw-server-test-'));
  const dataFile = join(directory, 'favorites.json');
  const server = await createDemoServer({ dataFile, ...options });
  context.after(async () => { await close(server); await rm(directory, { recursive: true, force: true }); });
  const baseURL = await listen(server);
  const request = (path, identity, method = 'GET') => fetch(`${baseURL}${path}`, { method, headers: identity ? { 'X-Demo-User': identity } : {} });
  return { directory, dataFile, server, baseURL, request };
}

test('demo serves the accessible interface and real catalog without runtime dependencies', async context => {
  const { request } = await fixture(context);
  const response = await request('/');
  assert.equal(response.status, 200);
  const page = await response.text();
  assert.match(page, /<label for="identity">Demo identity<\/label>/);
  assert.match(page, /role="status"/);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await request('/app.js')).status, 200);
  const catalog = await (await request('/api/items')).json();
  assert.deepEqual(catalog.items.map(item => item.id), ['toast', 'salad', 'soup']);
  assert.equal((await request('/../server.mjs')).status, 404);
});

test('favorites persist in the configured file and survive a backend restart', async context => {
  const { dataFile, server, request } = await fixture(context);
  assert.equal((await request('/api/favorites/toast', 'alice', 'PUT')).status, 200);
  assert.deepEqual(JSON.parse(await readFile(dataFile, 'utf8')).favorites.alice, ['toast']);
  await close(server);
  const restarted = await createDemoServer({ dataFile });
  const restartedURL = await listen(restarted);
  context.after(() => close(restarted));
  const response = await fetch(`${restartedURL}/api/favorites`, { headers: { 'X-Demo-User': 'alice' } });
  assert.deepEqual((await response.json()).favorites.map(item => item.id), ['toast']);
});

test('concurrent additions and repeated deletions preserve idempotency and identity partitioning', async context => {
  const { request, dataFile } = await fixture(context);
  const additions = await Promise.all(Array.from({ length: 8 }, () => request('/api/favorites/toast', 'alice', 'PUT')));
  for (const response of additions) assert.equal(response.status, 200);
  await request('/api/favorites/salad', 'bob', 'PUT');
  assert.deepEqual((await (await request('/api/favorites', 'alice')).json()).favorites.map(item => item.id), ['toast']);
  assert.deepEqual((await (await request('/api/favorites', 'bob')).json()).favorites.map(item => item.id), ['salad']);
  await request('/api/favorites/toast', 'alice', 'DELETE');
  await request('/api/favorites/toast', 'alice', 'DELETE');
  assert.deepEqual(JSON.parse(await readFile(dataFile, 'utf8')).favorites, { alice: [], bob: ['salad'] });
});

test('invalid identities and items fail without corrupting saved state', async context => {
  const { request, dataFile } = await fixture(context);
  await request('/api/favorites/toast', 'alice', 'PUT');
  const before = await readFile(dataFile, 'utf8');
  assert.equal((await request('/api/favorites/salad', undefined, 'PUT')).status, 400);
  assert.equal((await request('/api/favorites/toast', 'mallory', 'DELETE')).status, 400);
  assert.equal((await request('/api/favorites/missing', 'alice', 'PUT')).status, 400);
  assert.equal((await request('/api/favorites/%E0%A4%A', 'alice', 'PUT')).status, 400);
  assert.equal(await readFile(dataFile, 'utf8'), before);
});

test('deterministic reset is absent by default and opt-in test mode resets both identities', async context => {
  const normal = await fixture(context);
  assert.equal((await normal.request('/__test/reset', undefined, 'POST')).status, 404);
  const isolated = await fixture(context, { testMode: true });
  await isolated.request('/api/favorites/toast', 'alice', 'PUT');
  await isolated.request('/api/favorites/salad', 'bob', 'PUT');
  assert.equal((await isolated.request('/__test/reset', undefined, 'POST')).status, 200);
  assert.deepEqual(JSON.parse(await readFile(isolated.dataFile, 'utf8')).favorites, { alice: [], bob: [] });
  assert.deepEqual((await (await normal.request('/api/favorites', 'alice')).json()).favorites, []);
});

test('corrupt persisted data is rejected rather than silently overwritten', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'sddfw-invalid-data-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const dataFile = join(directory, 'favorites.json');
  const malformed = JSON.stringify({ schemaVersion: 1, favorites: { alice: ['unknown'], bob: [] } });
  await writeFile(dataFile, malformed);
  await assert.rejects(createDemoServer({ dataFile }), /demo data file is invalid/);
  assert.equal(await readFile(dataFile, 'utf8'), malformed);
});
