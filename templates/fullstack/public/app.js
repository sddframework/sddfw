const identitySelector = document.querySelector('#identity');
const catalog = document.querySelector('#catalog');
const favoritesList = document.querySelector('#favorites');
const favoritesHeading = document.querySelector('#favorites-heading');
const emptyFavorites = document.querySelector('#empty-favorites');
const status = document.querySelector('#status');
let items = [];
let favorites = [];
let busy = false;

async function api(path, { method = 'GET', identity = identitySelector.value } = {}) {
  const response = await fetch(path, { method, headers: { 'X-Demo-User': identity } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'The local server could not complete the request.');
  return body;
}

function setBusy(value) {
  busy = value;
  identitySelector.disabled = value;
  catalog.querySelectorAll('button').forEach(button => { button.disabled = value; });
  catalog.setAttribute('aria-busy', String(value));
}

function announce(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}

function render(focusItemId) {
  const favoriteIds = new Set(favorites.map(item => item.id));
  catalog.replaceChildren();
  favoritesList.replaceChildren();
  for (const item of items) {
    const row = document.createElement('li');
    row.className = 'menu-card';
    const name = document.createElement('h3');
    name.textContent = item.name;
    const description = document.createElement('p');
    description.textContent = item.description;
    const button = document.createElement('button');
    const saved = favoriteIds.has(item.id);
    button.type = 'button';
    button.dataset.item = item.id;
    button.textContent = saved ? 'Remove favorite' : 'Add favorite';
    button.setAttribute('aria-label', `${saved ? 'Remove' : 'Add'} ${item.name} ${saved ? 'from' : 'to'} favorites`);
    button.setAttribute('aria-pressed', String(saved));
    button.className = saved ? 'favorite-button saved' : 'favorite-button';
    button.disabled = busy;
    button.addEventListener('click', () => toggleFavorite(item, saved));
    row.append(name, description, button);
    catalog.append(row);
  }
  for (const item of favorites) {
    const row = document.createElement('li');
    row.textContent = item.name;
    favoritesList.append(row);
  }
  emptyFavorites.hidden = favorites.length !== 0;
  favoritesHeading.textContent = `${identitySelector.selectedOptions[0].text}'s favorites`;
  if (focusItemId) catalog.querySelector(`[data-item="${focusItemId}"]`)?.focus();
}

async function loadIdentity() {
  setBusy(true);
  try {
    const result = await api('/api/favorites');
    favorites = result.favorites;
    render();
    announce(`${identitySelector.selectedOptions[0].text}'s favorites loaded from the backend.`);
  } catch (error) {
    favorites = [];
    render();
    announce(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function toggleFavorite(item, saved) {
  if (busy) return;
  setBusy(true);
  try {
    const result = await api(`/api/favorites/${encodeURIComponent(item.id)}`, { method: saved ? 'DELETE' : 'PUT' });
    favorites = result.favorites;
    render();
    announce(`${item.name} ${saved ? 'removed from' : 'added to'} favorites. Saved in the backend.`);
  } catch (error) {
    announce(error.message, true);
  } finally {
    setBusy(false);
    catalog.querySelector(`[data-item="${item.id}"]`)?.focus();
  }
}

identitySelector.addEventListener('change', loadIdentity);
setBusy(true);
try {
  const result = await api('/api/items');
  items = result.items;
  await loadIdentity();
} catch (error) {
  announce(`${error.message} Reload the page after starting the local server.`, true);
  setBusy(false);
}
