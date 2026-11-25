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
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    button.primary { background: var(--primary); color: var(--on-primary); border-color: var(--primary); }
    button.primary:hover { opacity: 0.92; }
    button.danger { background: var(--danger-soft); color: var(--danger); border-color: transparent; }
    button.active { background: var(--primary-soft); color: var(--primary); border-color: var(--primary); }
    main { max-width: 920px; margin: 24px auto; padding: 0 16px 56px; }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 18px;
      margin-bottom: 14px;
    }
    .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .between { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
    .field label { font-size: 14px; font-weight: 600; color: var(--text); }
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
    .notice {
      border-radius: 10px;
      padding: 12px 14px;
      font-size: 14px;
      margin-top: 12px;
      background: var(--primary-soft);
      color: var(--primary);
      font-weight: 600;
    }
    .notice.err { background: var(--danger-soft); color: var(--danger); }
    .tag {
      display: inline-block;
      background: var(--muted);
      color: var(--text-secondary);
      border-radius: 8px;
      padding: 3px 9px;
      font-size: 13px;
      font-weight: 600;
    }
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
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 18, 16, 0.82);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
      z-index: 100;
    }
    .modal-backdrop.open { display: flex; }
    .modal-box {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 22px;
      width: 100%;
      max-width: 420px;
      text-align: center;
    }
    .qr-frame {
      background: #fcfbf8;
      border-radius: 14px;
      padding: 14px;
      display: inline-block;
      margin: 12px 0;
      border: 1px solid var(--border);
    }
    .qr-frame img { width: 240px; height: 240px; display: block; }
    .lightbox img { max-width: 92vw; max-height: 80vh; border-radius: 12px; }
    .lightbox-cap { color: #f2efe9; font-size: 15px; font-weight: 600; margin-top: 10px; }
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
      <button data-tab="import">Import</button>
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

      <div id="tab-import" class="hidden">
        <div class="card">
          <h3 style="margin-top:0;margin-bottom:6px;">Import from Running Grocy Server</h3>
          <p class="muted" style="margin-top:0;">
            Pulls locations, quantity units, categories, stores, products, barcodes, active stock batches, product photos, and shopping list from your existing Grocy server.
          </p>
          <div class="field">
            <label for="oldGrocyUrl">Original Grocy URL</label>
            <input id="oldGrocyUrl" placeholder="https://grocy.yourdomain.com or http://192.168.1.50:9283" />
          </div>
          <div class="field">
            <label for="oldGrocyKey">Original Grocy API Key</label>
            <input id="oldGrocyKey" type="password" placeholder="Paste API key from original Grocy" />
          </div>
          <div class="row" style="margin-bottom:14px;">
            <label class="row" style="font-size:14px;">
              <input id="importPhotosChk" type="checkbox" checked style="min-height:auto;width:18px;height:18px;" />
              Import product photos
            </label>
            <label class="row" style="font-size:14px;">
              <input id="clearApiChk" type="checkbox" style="min-height:auto;width:18px;height:18px;" />
              Replace existing GrocyGo data
            </label>
          </div>
          <button id="runApiImportBtn" class="primary">Import from Grocy API</button>
          <div id="apiImportStatus" class="hidden"></div>
        </div>

        <div class="card">
          <h3 style="margin-top:0;margin-bottom:6px;">Import from Original Grocy SQLite File (grocy.db)</h3>
          <p class="muted" style="margin-top:0;">
            Already stopped your old Grocy container? Upload <code>grocy.db</code> directly from your old appdata folder.
          </p>
          <div class="row" style="margin-bottom:12px;">
            <input id="grocyDbFile" type="file" accept=".db,.sqlite,.sqlite3,application/octet-stream" />
          </div>
          <div class="row" style="margin-bottom:14px;">
            <label class="row" style="font-size:14px;">
              <input id="clearDbChk" type="checkbox" style="min-height:auto;width:18px;height:18px;" />
              Replace existing GrocyGo data
            </label>
          </div>
          <button id="runDbImportBtn" class="primary">Upload &amp; Import grocy.db</button>
          <div id="dbImportStatus" class="hidden"></div>
        </div>
      </div>

      <div id="tab-keys" class="hidden">
        <div class="card">
          <div class="between" style="margin-bottom:10px;">
            <h3 style="margin:0;">API Keys &amp; Mobile QR Setup</h3>
            <button id="createKeyBtn" class="primary">New API Key</button>
          </div>
          <p class="muted" style="margin-top:0;">
            Click <strong>QR Code</strong> on any key and scan it from the GrocyGo mobile app to connect instantly.
          </p>
          <div id="keysList"></div>
        </div>

        <div class="card">
          <h3 style="margin-top:0;margin-bottom:6px;">Read-Only MCP Endpoint</h3>
          <p class="muted" style="margin-top:0;">Lightweight food inventory &amp; shopping list tools for AI agents.</p>
          <pre id="mcpSnippet"></pre>
        </div>
      </div>
    </section>
  </main>

  <!-- Photo Lightbox -->
  <div id="lightbox" class="modal-backdrop lightbox" onclick="this.classList.remove('open')">
    <div style="text-align:center;">
      <img id="lightboxImg" alt="Item photo" />
      <div id="lightboxCap" class="lightbox-cap"></div>
    </div>
  </div>

  <!-- API Key QR Code Modal -->
  <div id="qrModal" class="modal-backdrop" onclick="if(event.target===this)this.classList.remove('open')">
    <div class="modal-box">
      <div class="between" style="margin-bottom:8px;">
        <h3 style="margin:0;">Scan with GrocyGo App</h3>
        <button onclick="document.getElementById('qrModal').classList.remove('open')">Close</button>
      </div>
      <div class="field" style="text-align:left;margin-top:10px;">
        <label for="qrServerUrl">Server URL encoded in QR</label>
        <input id="qrServerUrl" placeholder="https://grocygo.yourdomain.com" />
        <span class="muted" style="font-size:12px;">Switch to your HTTPS reverse proxy URL if you opened this page via LAN IP.</span>
      </div>
      <div class="qr-frame">
        <img id="qrImg" alt="API Key QR code" />
      </div>
      <div class="muted" id="qrPayloadPreview" style="word-break:break-all;font-size:12px;"></div>
    </div>
  </div>

  <script>
    let apiKey = localStorage.getItem('grocygo_key') || '';
    let state = { stock: [], locations: [], units: [], shopping: [], keys: [] };
    let activeQrKey = '';

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

    function refreshQrImage() {
      const rawUrl = (document.getElementById('qrServerUrl').value || window.location.origin)
        .trim()
        .replace(/\\/+$/, '');
      const base = rawUrl.toLowerCase().endsWith('/api') ? rawUrl : rawUrl + '/api';
      const payload = base + '|' + activeQrKey;
      document.getElementById('qrImg').src =
        '/api/qr?text=' + encodeURIComponent(payload) + '&api_key=' + encodeURIComponent(apiKey);
      document.getElementById('qrPayloadPreview').textContent = base + ' | ' + activeQrKey.slice(0, 8) + '...';
    }

    window.openQrModal = (key) => {
      activeQrKey = key;
      const savedUrl = localStorage.getItem('grocygo_qr_url') || window.location.origin;
      document.getElementById('qrServerUrl').value = savedUrl;
      refreshQrImage();
      document.getElementById('qrModal').classList.add('open');
    };

    document.getElementById('qrServerUrl').oninput = () => {
      localStorage.setItem('grocygo_qr_url', document.getElementById('qrServerUrl').value.trim());
      refreshQrImage();
    };

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
        : '<div class="card muted">No stocked items yet. Scan items in GrocyGo or import from your old Grocy server.</div>';

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
            <div class="row">
              <button class="primary" onclick="openQrModal('\${escapeAttr(k.api_key)}')">QR Code</button>
              <button onclick="navigator.clipboard.writeText('\${escapeAttr(k.api_key)}')">Copy Key</button>
            </div>
          </div>\`)
        .join('');
    }

    function escapeHtml(s) {
      return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function escapeAttr(s) {
      return escapeHtml(s).replace(/'/g, "\\'");
    }
    function formatImportSummary(r) {
      return (
        'Import complete! Added ' +
        r.locations + ' locations, ' +
        r.quantity_units + ' units, ' +
        r.products + ' products, ' +
        r.barcodes + ' barcodes, ' +
        r.stock_entries + ' stock batches, ' +
        r.photos + ' photos, ' +
        r.shopping_list + ' shopping items.'
      );
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

    document.getElementById('runApiImportBtn').onclick = async () => {
      const btn = document.getElementById('runApiImportBtn');
      const statusEl = document.getElementById('apiImportStatus');
      const server_url = document.getElementById('oldGrocyUrl').value.trim();
      const api_key = document.getElementById('oldGrocyKey').value.trim();
      if (!server_url || !api_key) {
        statusEl.className = 'notice err';
        statusEl.textContent = 'Enter both your original Grocy URL and API key.';
        return;
      }
      btn.disabled = true;
      statusEl.className = 'notice';
      statusEl.textContent = 'Importing from original Grocy...';
      try {
        const report = await api('/api/import/grocy-api', {
          method: 'POST',
          body: JSON.stringify({
            server_url,
            api_key,
            import_photos: document.getElementById('importPhotosChk').checked,
            clear_existing: document.getElementById('clearApiChk').checked,
          }),
        });
        statusEl.className = 'notice';
        statusEl.textContent = formatImportSummary(report);
        await loadAll();
      } catch (e) {
        statusEl.className = 'notice err';
        statusEl.textContent = e.message;
      } finally {
        btn.disabled = false;
      }
    };

    document.getElementById('runDbImportBtn').onclick = async () => {
      const btn = document.getElementById('runDbImportBtn');
      const statusEl = document.getElementById('dbImportStatus');
      const file = document.getElementById('grocyDbFile').files[0];
      if (!file) {
        statusEl.className = 'notice err';
        statusEl.textContent = 'Select a grocy.db SQLite file first.';
        return;
      }
      btn.disabled = true;
      statusEl.className = 'notice';
      statusEl.textContent = 'Uploading and importing grocy.db...';
      try {
        const buf = await file.arrayBuffer();
        const clearFlag = document.getElementById('clearDbChk').checked ? '?clear_existing=1' : '';
        const res = await fetch('/api/import/grocy-db' + clearFlag, {
          method: 'POST',
          headers: { 'GROCY-API-KEY': apiKey, 'Content-Type': 'application/octet-stream' },
          body: buf,
        });
        const report = await res.json();
        if (!res.ok) throw new Error(report.error_message || 'Import failed');
        statusEl.className = 'notice';
        statusEl.textContent = formatImportSummary(report);
        await loadAll();
      } catch (e) {
        statusEl.className = 'notice err';
        statusEl.textContent = e.message;
      } finally {
        btn.disabled = false;
      }
    };

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
        ['inventory', 'shopping', 'locations', 'import', 'keys'].forEach((t) => {
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
