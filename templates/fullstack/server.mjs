import { createServer } from 'node:http';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

export const DEMO_ITEMS = Object.freeze([
  { id: 'toast', name: 'Sourdough toast', description: 'Avocado, tomato and a little lemon.' },
  { id: 'salad', name: 'Green salad', description: 'Crunchy greens, cucumber and fresh herbs.' },
  { id: 'soup', name: 'Tomato soup', description: 'Slow-roasted tomatoes with basil.' },
]);
const identities = ['alice', 'bob'];
const itemIds = new Set(DEMO_ITEMS.map(item => item.id));
const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const emptyState = () => ({ schemaVersion: 1, favorites: { alice: [], bob: [] } });

function validateState(state) {
  if (state?.schemaVersion !== 1 || !state.favorites ||
      !identities.every(identity => Array.isArray(state.favorites[identity]) &&
        state.favorites[identity].every(id => itemIds.has(id)) &&
        new Set(state.favorites[identity]).size === state.favorites[identity].length)) {
    throw new Error('The demo data file is invalid. Use a clean file or restore the documented JSON format.');
  }
  return { schemaVersion: 1, favorites: Object.fromEntries(identities.map(identity => [identity, [...state.favorites[identity]]])) };
}

async function persist(dataFile, state) {
  await mkdir(dirname(dataFile), { recursive: true });
  const temporaryFile = `${dataFile}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryFile, dataFile);
  } catch (error) {
    await unlink(temporaryFile).catch(() => {});
    throw error;
  }
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

/** Demo identity headers deliberately do not authenticate users. Bind locally only. */
export async function createDemoServer({ dataFile = resolve('.sddfw-demo/favorites.json'), testMode = false } = {}) {
  let state;
  try {
    state = validateState(JSON.parse(await readFile(dataFile, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = emptyState();
    await persist(dataFile, state);
  }
  let pendingMutation = Promise.resolve();
  const mutate = operation => {
    const next = pendingMutation.then(async () => {
      const updated = structuredClone(state);
      operation(updated);
      await persist(dataFile, updated);
      state = updated;
    });
    pendingMutation = next.catch(() => {});
    return next;
  };
  const favoritesFor = identity => ({
    identity,
    favorites: state.favorites[identity].map(id => DEMO_ITEMS.find(item => item.id === id)),
  });

  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const pathname = url.pathname;
      if (pathname === '/__test/reset') {
        if (!testMode) return json(response, 404, { error: 'Not found.' });
        if (request.method !== 'POST') return json(response, 405, { error: 'Use POST.' });
        await mutate(updated => { updated.favorites = emptyState().favorites; });
        return json(response, 200, { ok: true });
      }
      if (pathname === '/api/items') {
        if (request.method !== 'GET') return json(response, 405, { error: 'Use GET.' });
        return json(response, 200, { items: DEMO_ITEMS });
      }
      if (pathname === '/api/favorites' || pathname.startsWith('/api/favorites/')) {
        const identity = request.headers['x-demo-user'];
        if (!identities.includes(identity)) return json(response, 400, { error: 'Choose the demo identity alice or bob.' });
        if (pathname === '/api/favorites') {
          if (request.method !== 'GET') return json(response, 405, { error: 'Use GET or an item-specific PUT/DELETE URL.' });
          await pendingMutation;
          return json(response, 200, favoritesFor(identity));
        }
        const id = decodeURIComponent(pathname.slice('/api/favorites/'.length));
        if (!itemIds.has(id)) return json(response, 400, { error: 'Choose an item from the demo catalog.' });
        if (!['PUT', 'DELETE'].includes(request.method)) return json(response, 405, { error: 'Use PUT or DELETE.' });
        await mutate(updated => {
          const current = updated.favorites[identity];
          updated.favorites[identity] = request.method === 'PUT'
            ? [...new Set([...current, id])]
            : current.filter(saved => saved !== id);
        });
        return json(response, 200, favoritesFor(identity));
      }
      const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      if (request.method === 'GET' && assets[pathname]) {
        const [name, contentType] = assets[pathname];
        response.writeHead(200, {
          'Content-Type': `${contentType}; charset=utf-8`,
          'Content-Security-Policy': "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          'Cache-Control': 'no-store',
        });
        return response.end(await readFile(join(publicDir, name)));
      }
      return json(response, 404, { error: 'Not found.' });
    } catch (error) {
      if (error instanceof URIError) return json(response, 400, { error: 'Invalid item URL.' });
      if (!response.headersSent) return json(response, 500, { error: 'The local demo could not complete this request.' });
      response.destroy();
    }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.SDDFW_DEMO_PORT ?? 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SDDFW_DEMO_PORT must be an integer between 1 and 65535.');
  const server = await createDemoServer({
    dataFile: process.env.SDDFW_DEMO_DATA ? resolve(process.env.SDDFW_DEMO_DATA) : undefined,
    testMode: process.env.SDDFW_DEMO_TEST_MODE === '1',
  });
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`SDDFW favorites demo: http://127.0.0.1:${port}\n`);
    process.stdout.write('Alice and Bob are simulated identities, not authentication.\n');
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
