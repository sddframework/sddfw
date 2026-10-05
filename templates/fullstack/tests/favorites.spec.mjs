import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const headers = identity => ({ 'X-Demo-User': identity });
const favoriteIds = async (request, identity) => {
  const response = await request.get('/api/favorites', { headers: headers(identity) });
  expect(response.status()).toBe(200);
  return (await response.json()).favorites.map(item => item.id);
};

test.beforeEach(async ({ request }) => {
  const response = await request.post('/__test/reset');
  expect(response.status()).toBe(200);
});

test('adding through the UI persists across reload and into the data file @sddfw:FAV-001', async ({ page, request }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add Sourdough toast to favorites' }).click();
  await expect(page.getByRole('status')).toContainText('Saved in the backend.');
  await expect(page.getByRole('list', { name: 'Saved favorites' })).toHaveText('Sourdough toast');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Remove Sourdough toast from favorites' })).toBeVisible();
  expect(await favoriteIds(request, 'alice')).toEqual(['toast']);
  const stored = JSON.parse(await readFile(testInfo.config.metadata.demoDataFile, 'utf8'));
  expect(stored.favorites.alice).toEqual(['toast']);
  expect(stored.favorites.bob).toEqual([]);
});

test('removing through the UI persists across reload and API reads @sddfw:FAV-002', async ({ page, request }) => {
  expect((await request.put('/api/favorites/toast', { headers: headers('alice') })).status()).toBe(200);
  await page.goto('/');
  await page.getByRole('button', { name: 'Remove Sourdough toast from favorites' }).click();
  await expect(page.getByRole('status')).toContainText('removed from favorites.');
  await expect(page.getByText('No favorites yet.', { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Add Sourdough toast to favorites' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Saved favorites' }).getByRole('listitem')).toHaveCount(0);
  expect(await favoriteIds(request, 'alice')).toEqual([]);
});

test('concurrent and repeated real API additions stay idempotent @sddfw:FAV-003', async ({ page, request }) => {
  const responses = await Promise.all(Array.from({ length: 3 }, () => request.put('/api/favorites/toast', { headers: headers('alice') })));
  for (const response of responses) expect(response.status()).toBe(200);
  expect((await request.put('/api/favorites/toast', { headers: headers('alice') })).status()).toBe(200);
  expect(await favoriteIds(request, 'alice')).toEqual(['toast']);
  await page.goto('/');
  await expect(page.getByRole('list', { name: 'Saved favorites' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('list', { name: 'Saved favorites' })).toHaveText('Sourdough toast');
});

test('Alice and Bob retain isolated favorites in UI and real API @sddfw:FAV-004', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add Sourdough toast to favorites' }).click();
  await expect(page.getByRole('status')).toContainText('Saved in the backend.');
  await page.getByLabel('Demo identity').selectOption('bob');
  await expect(page.getByRole('heading', { name: "Bob's favorites" })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Saved favorites' }).getByRole('listitem')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add Green salad to favorites' }).click();
  await expect(page.getByRole('list', { name: 'Saved favorites' })).toHaveText('Green salad');
  await page.getByLabel('Demo identity').selectOption('alice');
  await expect(page.getByRole('heading', { name: "Alice's favorites" })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Saved favorites' })).toHaveText('Sourdough toast');
  expect(await favoriteIds(request, 'alice')).toEqual(['toast']);
  expect(await favoriteIds(request, 'bob')).toEqual(['salad']);
});

test('invalid real API mutations preserve both identities data @sddfw:FAV-005', async ({ request }) => {
  expect((await request.put('/api/favorites/toast', { headers: headers('alice') })).status()).toBe(200);
  const invalid = [
    await request.put('/api/favorites/unknown', { headers: headers('alice') }),
    await request.put('/api/favorites/salad', { headers: headers('mallory') }),
    await request.delete('/api/favorites/toast'),
  ];
  for (const response of invalid) {
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toBeTruthy();
  }
  expect(await favoriteIds(request, 'alice')).toEqual(['toast']);
  expect(await favoriteIds(request, 'bob')).toEqual([]);
});
