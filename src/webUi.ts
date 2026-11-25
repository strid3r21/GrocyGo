export function renderWebUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GrocyGo — Kitchen Inventory</title>
  <style>
    :root {
      --bg: #f5f2ec;
      --surface: #fcfbf8;
      --muted: #ebe5da;
      --border: #ddd5c7;
      --text: #1e2420;
      --text-secondary: #464f48;
      --text-muted: #636b64;
      --primary: #3b6449;
      --primary-soft: #e3ece5;
      --on-primary: #fcfbf8;
      --warning: #9a5b13;
      --warning-soft: #f9eedb;
      --danger: #a93f2b;
      --danger-soft: #f9e5e0;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #151816;
        --surface: #1e221f;
        --muted: #282d29;
        --border: #363d38;
        --text: #f2efe9;
        --text-secondary: #c8cec8;
        --text-muted: #9aa39b;
        --primary: #82ab8e;
        --primary-soft: rgba(130, 171, 142, 0.16);
        --on-primary: #112117;
        --warning: #e0ac5c;
        --warning-soft: rgba(224, 172, 92, 0.16);
        --danger: #e07d68;
        --danger-soft: rgba(224, 125, 104, 0.18);
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      font-size: 16px;
      line-height: 1.5;
    }
    header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 14px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .brand { font-weight: 700; font-size: 20px; letter-spacing: -0.01em; }
    nav { display: flex; gap: 6px; flex-wrap: wrap; }
    button {
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 15px;
      min-height: 44px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    button:hover { background: var(--muted); }
    button.primary { background: var(--primary); color: var(--on-primary); border-color: var(--primary); }
    button.primary:hover { opacity: 0.92; }
    button.danger { background: var(--danger-soft); color: var(--danger); border-color: transparent; }
    button.active { background: var(--primary-soft); color: var(--primary); border-color: var(--primary); }
    main { max-width: 920px; margin: 24px auto; padding: 0 16px 56px; }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 16px;
      margin-bottom: 12px;
    }
    .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .between { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    input, select {
      background: var(--bg);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 14px;
      min-height: 44px;
      font-size: 15px;
    }
    .meta { color: var(--text-secondary); font-size: 14px; }
    .muted { color: var(--text-muted); font-size: 14px; }
    .tag {
      display: inline-block;
      background: var(--muted);
      color: var(--text-secondary);
      border-radius: 8px;
      padding: 3px 9px;
      font-size: 13px;
      font-weight: 600;
    }
    .tag.warn { background: var(--warning-soft); color: var(--warning); }
    .tag.bad { background: var(--danger-soft); color: var(--danger); }
    .photo-pair { display: flex; gap: 8px; flex-shrink: 0; }
    .photo-slot {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      width: 68px;
    }
    .thumb {
      width: 64px;
      height: 64px;
      border-radius: 10px;
      object-fit: cover;
      border: 1px solid var(--border);
      cursor: pointer;
    }
    .thumb-empty {
      width: 64px;
      height: 64px;
      border-radius: 10px;
      background: var(--muted);
      border: 1px dashed var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      font-size: 12px;
      cursor: pointer;
    }
    .slot-label { font-size: 11px; color: var(--text-muted); font-weight: 600; }
    pre {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px;
      overflow-x: auto;
      font-size: 13px;
      color: var(--text);
    }
    .lightbox {
      position: fixed;
      inset: 0;
      background: rgba(15, 18, 16, 0.88);
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 20px;
      z-index: 100;
    }
    .lightbox.open { display: flex; }
    .lightbox img { max-width: 92vw; max-height: 80vh; border-radius: 12px; }
    .lightbox-cap { color: #f2efe9; font-size: 15px; font-weight: 600; }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <header>
    <div class="brand">GrocyGo</div>
    <nav id="navTabs" class="hidden" aria-label="Main navigation">
      <button data-tab="inventory" class="active">Inventory</button>
      <button data-tab="shopping">Shopping</button>
      <button data-tab="locations">Locations</button>
      <button data-tab="keys">API &amp; MCP</button>
      <button id="logoutBtn" class="danger">Sign Out</button>
    </nav>
  </header>

  <main>
    <section id="loginView" class="card" style="max-width:440px;margin:56px auto;">
      <h2 style="margin-top:0;margin-bottom:6px;">Sign in</h2>
      <p class="muted" style="margin-top:0;">Enter your API key from the server logs.</p>
      <div class="row" style="margin-top:14px;">
        <input id="apiKeyInput" type="password" placeholder="API key" aria-label="API key" style="flex:1;" />
        <button id="loginBtn" class="primary">Connect</button>
      </div>
      <p id="loginErr" style="color:var(--danger);font-size:14px;margin-bottom:0;"></p>
    </section>

    <section id="appView" class="hidden">
      <div id="tab-inventory">
        <div class="between" style="margin-bottom:14px;">
          <input id="searchInput" placeholder="Search food inventory..." aria-label="Search food inventory" style="flex:1;max-width:400px;" />
          <button id="refreshBtn">Refresh</button>
        </div>
        <div id="inventoryList"></div>
      </div>

      <div id="tab-shopping" class="hidden">
        <div class="card">
          <div class="row">
            <input id="shopItemInput" placeholder="Add grocery item..." aria-label="Add grocery item" style="flex:1;" />
            <input id="shopQtyInput" type="number" value="1" min="1" aria-label="Quantity" style="width:84px;" />
            <button id="addShopBtn" class="primary">Add</button>
            <button id="addMissingBtn">Add Low Stock</button>
            <button id="clearDoneBtn">Clear Checked</button>
          </div>
        </div>
        <div id="shoppingList"></div>
      </div>

      <div id="tab-locations" class="hidden">
        <div class="card">
          <div class="row">
            <input id="locNameInput" placeholder="New storage location (e.g. Garage Freezer)" aria-label="New storage location" style="flex:1;" />
            <label class="row" style="font-size:14px;"><input id="locFreezerInput" type="checkbox" style="min-height:auto;width:18px;height:18px;" /> Freezer</label>
            <button id="addLocBtn" class="primary">Add Location</button>
          </div>
        </div>
        <div id="locationsList"></div>
      </div>

      <div id="tab-keys" class="hidden">
        <div class="card">
          <h3 style="margin-top:0;margin-bottom:6px;">Read-Only MCP Endpoint</h3>
          <p class="muted" style="margin-top:0;">Lightweight inventory &amp; shopping list tools for AI agents.</p>
          <pre id="mcpSnippet"></pre>
        </div>

        <div class="card">
          <div class="between" style="margin-bottom:10px;">
            <h3 style="margin:0;">API Keys</h3>
            <button id="createKeyBtn" class="primary">New API Key</button>
          </div>
          <div id="keysList"></div>
        </div>
      </div>
    </section>
  </main>

  <div id="lightbox" class="lightbox" onclick="this.classList.remove('open')">
    <img id="lightboxImg" alt="Item photo" />
    <div id="lightboxCap" class="lightbox-cap"></div>
  </div>

  <script>
    let apiKey = localStorage.getItem('grocygo_key') || '';
    let state = { stock: [], locations: [], units: [], shopping: [], keys: [] };

    async function api(path, opts = {}) {
      const res = await fetch(path, {
        ...opts,
        headers: {
          'GROCY-API-KEY': apiKey,
          ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
          ...(opts.headers || {}),
        },
      });
      if (res.status === 204) return null;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error_message || 'Request failed (' + res.status + ')');
      return data;
    }

    function photoUrl(file) {
      return '/api/photos/' + encodeURIComponent(file) + '?api_key=' + encodeURIComponent(apiKey);
    }

    async function loadAll() {
      const [stock, locations, units, shopping, keys] = await Promise.all([
        api('/api/stock'),
        api('/api/objects/locations'),
        api('/api/objects/quantity_units'),
        api('/api/objects/shopping_list'),
        api('/api/objects/api_keys'),
      ]);
      state = { stock, locations, units, shopping, keys };
      renderAll();
    }

    function renderAll() {
      const q = (document.getElementById('searchInput').value || '').toLowerCase();
      const locMap = Object.fromEntries(state.locations.map((l) => [l.id, l]));
      const unitMap = Object.fromEntries(state.units.map((u) => [u.id, u]));

      const filtered = state.stock.filter((s) => s.product.name.toLowerCase().includes(q));
      const invEl = document.getElementById('inventoryList');
      invEl.innerHTML = filtered.length
        ? filtered
            .map((s) => {
              const loc = locMap[s.product.location_id];
              const u = unitMap[s.product.qu_id_stock];
              const prodPhoto = s.product_photo_file_name || s.product.picture_file_name;
              const shelfPhoto = s.storage_photo_file_name;
              const due = s.best_before_date && s.best_before_date !== '2999-12-31' ? 'Due ' + s.best_before_date : 'No expiry';
              const unitText = u ? (s.amount === 1 ? u.name : u.name_plural || u.name) : '';
              return \`
                <div class="card">
                  <div class="between" style="align-items:flex-start;">
                    <div class="row" style="align-items:flex-start;flex:1;min-width:240px;">
                      <div class="photo-pair">
                        <div class="photo-slot">
                          \${prodPhoto
                            ? \`<img class="thumb" src="\${photoUrl(prodPhoto)}" alt="Product photo" onclick="openPhoto('\${prodPhoto}', '\${escapeAttr(s.product.name)} — Product')" />\`
                            : \`<label class="thumb-empty">+ Item<input type="file" accept="image/*" style="display:none;" onchange="uploadPhoto('product', \${s.product_id}, this.files[0])" /></label>\`}
                          <label class="slot-label" style="cursor:pointer;">Product<input type="file" accept="image/*" style="display:none;" onchange="uploadPhoto('product', \${s.product_id}, this.files[0])" /></label>
                        </div>
                        <div class="photo-slot">
                          \${shelfPhoto
                            ? \`<img class="thumb" src="\${photoUrl(shelfPhoto)}" alt="Shelf location photo" onclick="openPhoto('\${shelfPhoto}', '\${escapeAttr(s.product.name)} — On the shelf')" />\`
                            : \`<label class="thumb-empty">+ Shelf<input type="file" accept="image/*" style="display:none;" onchange="uploadPhoto('product-storage', \${s.product_id}, this.files[0])" /></label>\`}
                          <label class="slot-label" style="cursor:pointer;">Shelf<input type="file" accept="image/*" style="display:none;" onchange="uploadPhoto('product-storage', \${s.product_id}, this.files[0])" /></label>
                        </div>
                      </div>
                      <div style="flex:1;min-width:160px;">
                        <div style="font-weight:700;font-size:17px;">\${escapeHtml(s.product.name)}</div>
                        <div class="meta" style="margin-top:4px;">
                          \${s.amount} \${escapeHtml(unitText)}\${loc ? ' · ' + escapeHtml(loc.name) : ''} · \${escapeHtml(due)}
                        </div>
                      </div>
                    </div>
                    <div class="row">
                      <button onclick="quickConsume(\${s.product_id})" aria-label="Consume one">-1</button>
                      <button onclick="quickAdd(\${s.product_id})" aria-label="Add one">+1</button>
                    </div>
                  </div>
                </div>\`;
            })
            .join('')
        : '<div class="card muted">No stocked items yet. Scan items in GrocyGo to add them.</div>';

      const shopEl = document.getElementById('shoppingList');
      shopEl.innerHTML = state.shopping.length
        ? state.shopping
            .map((item) => \`
              <div class="card between">
                <label class="row" style="cursor:pointer;flex:1;">
                  <input type="checkbox" style="min-height:auto;width:20px;height:20px;" \${item.done ? 'checked' : ''} onchange="toggleShop(\${item.id}, this.checked)" />
                  <span style="\${item.done ? 'text-decoration:line-through;opacity:0.55;' : ''}">
                    <strong>\${escapeHtml(item.product_name || item.note || 'Item')}</strong>
                    &times; \${item.amount}
                  </span>
                </label>
                <button class="danger" onclick="deleteShop(\${item.id})">Remove</button>
              </div>\`)
            .join('')
        : '<div class="card muted">Shopping list is empty.</div>';

      const locEl = document.getElementById('locationsList');
      locEl.innerHTML = state.locations
        .map((l) => \`
          <div class="card between">
            <div>
              <strong>\${escapeHtml(l.name)}</strong>
              \${l.is_freezer ? '<span class="tag" style="margin-left:8px;">Freezer</span>' : ''}
              \${l.description ? \`<div class="muted">\${escapeHtml(l.description)}</div>\` : ''}
            </div>
            <button class="danger" onclick="deleteLoc(\${l.id})">Delete</button>
          </div>\`)
        .join('');

      const origin = window.location.origin;
      document.getElementById('mcpSnippet').textContent = JSON.stringify(
        {
          mcpServers: {
            grocygo: {
              url: origin + '/mcp',
              headers: { 'GROCY-API-KEY': apiKey },
            },
          },
        },
        null,
        2
      );

      document.getElementById('keysList').innerHTML = state.keys
        .map((k) => \`
          <div class="between" style="padding:12px 0;border-top:1px solid var(--border);">
            <div>
              <code style="font-size:14px;">\${escapeHtml(k.api_key)}</code>
              <div class="muted">\${escapeHtml(k.description || 'API Key')}</div>
            </div>
            <button onclick="navigator.clipboard.writeText('\${origin}|\${k.api_key}')">Copy QR String</button>
          </div>\`)
        .join('');
    }

    function escapeHtml(s) {
      return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function escapeAttr(s) {
      return escapeHtml(s).replace(/'/g, "\\'");
    }

    window.openPhoto = (file, caption) => {
      document.getElementById('lightboxImg').src = photoUrl(file);
      document.getElementById('lightboxCap').textContent = caption || '';
      document.getElementById('lightbox').classList.add('open');
    };
    window.quickConsume = async (id) => { await api('/api/stock/products/' + id + '/consume', { method: 'POST', body: JSON.stringify({ amount: 1 }) }); await loadAll(); };
    window.quickAdd = async (id) => { await api('/api/stock/products/' + id + '/add', { method: 'POST', body: JSON.stringify({ amount: 1 }) }); await loadAll(); };
    window.uploadPhoto = async (kind, id, file) => {
      if (!file) return;
      const buf = await file.arrayBuffer();
      await fetch('/api/photos/' + kind + '/' + id, {
        method: 'POST',
        headers: { 'GROCY-API-KEY': apiKey, 'Content-Type': file.type || 'image/jpeg' },
        body: buf,
      });
      await loadAll();
    };
    window.toggleShop = async (id, done) => { await api('/api/objects/shopping_list/' + id, { method: 'PUT', body: JSON.stringify({ done: done ? 1 : 0 }) }); await loadAll(); };
    window.deleteShop = async (id) => { await api('/api/objects/shopping_list/' + id, { method: 'DELETE' }); await loadAll(); };
    window.deleteLoc = async (id) => { try { await api('/api/objects/locations/' + id, { method: 'DELETE' }); await loadAll(); } catch (e) { alert(e.message); } };

    document.getElementById('loginBtn').onclick = async () => {
      apiKey = document.getElementById('apiKeyInput').value.trim();
      document.getElementById('loginErr').textContent = '';
      try {
        await api('/api/system/info');
        localStorage.setItem('grocygo_key', apiKey);
        showApp();
      } catch (e) {
        document.getElementById('loginErr').textContent = e.message;
      }
    };

    document.getElementById('logoutBtn').onclick = () => {
      localStorage.removeItem('grocygo_key');
      apiKey = '';
      document.getElementById('appView').classList.add('hidden');
      document.getElementById('navTabs').classList.add('hidden');
      document.getElementById('loginView').classList.remove('hidden');
    };

    document.querySelectorAll('#navTabs button[data-tab]').forEach((btn) => {
      btn.onclick = () => {
        document.querySelectorAll('#navTabs button[data-tab]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        ['inventory', 'shopping', 'locations', 'keys'].forEach((t) => {
          document.getElementById('tab-' + t).classList.toggle('hidden', t !== btn.dataset.tab);
        });
      };
    });

    document.getElementById('searchInput').oninput = renderAll;
    document.getElementById('refreshBtn').onclick = loadAll;
    document.getElementById('addShopBtn').onclick = async () => {
      const note = document.getElementById('shopItemInput').value.trim();
      const amount = Number(document.getElementById('shopQtyInput').value || 1);
      if (!note) return;
      await api('/api/objects/shopping_list', { method: 'POST', body: JSON.stringify({ note, amount, shopping_list_id: 1, done: 0 }) });
      document.getElementById('shopItemInput').value = '';
      await loadAll();
    };
    document.getElementById('addMissingBtn').onclick = async () => { await api('/api/stock/shoppinglist/add-missing-products', { method: 'POST', body: '{}' }); await loadAll(); };
    document.getElementById('clearDoneBtn').onclick = async () => { await api('/api/stock/shoppinglist/clear', { method: 'POST', body: JSON.stringify({ done_only: true }) }); await loadAll(); };
    document.getElementById('addLocBtn').onclick = async () => {
      const name = document.getElementById('locNameInput').value.trim();
      const is_freezer = document.getElementById('locFreezerInput').checked ? 1 : 0;
      if (!name) return;
      await api('/api/objects/locations', { method: 'POST', body: JSON.stringify({ name, is_freezer }) });
      document.getElementById('locNameInput').value = '';
      document.getElementById('locFreezerInput').checked = false;
      await loadAll();
    };
    document.getElementById('createKeyBtn').onclick = async () => {
      await api('/api/objects/api_keys', { method: 'POST', body: JSON.stringify({ description: 'Generated from Web UI' }) });
      await loadAll();
    };

    async function showApp() {
      document.getElementById('loginView').classList.add('hidden');
      document.getElementById('appView').classList.remove('hidden');
      document.getElementById('navTabs').classList.remove('hidden');
      await loadAll();
    }

    if (apiKey) {
      api('/api/system/info').then(showApp).catch(() => {});
    }
  </script>
</body>
</html>`;
}
