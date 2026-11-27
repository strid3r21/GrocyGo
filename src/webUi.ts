export function renderWebUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" type="image/png" href="/favicon.png" />
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
      font-size: 15px;
      line-height: 1.45;
    }
    header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 12px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .brand { font-weight: 700; font-size: 20px; letter-spacing: -0.01em; display:flex; align-items:center; gap:10px; }
    nav { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    button {
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 9px;
      padding: 8px 13px;
      min-height: 40px;
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
    button.sm { min-height: 34px; padding: 5px 10px; font-size: 13px; }
    main { max-width: 1080px; margin: 20px auto; padding: 0 16px 56px; }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 14px;
    }
    .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .between { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; text-align: left; }
    .field label { font-size: 13px; font-weight: 600; color: var(--text); }
    input, select {
      background: var(--bg);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 9px;
      padding: 8px 12px;
      min-height: 40px;
      font-size: 14px;
    }
    .meta { color: var(--text-secondary); font-size: 13px; }
    .muted { color: var(--text-muted); font-size: 13px; }
    .notice {
      border-radius: 10px;
      padding: 10px 14px;
      font-size: 14px;
      margin-top: 10px;
      background: var(--primary-soft);
      color: var(--primary);
      font-weight: 600;
    }
    .notice.err { background: var(--danger-soft); color: var(--danger); }
    .tag {
      display: inline-block;
      background: var(--muted);
      color: var(--text-secondary);
      border-radius: 7px;
      padding: 2px 8px;
      font-size: 12px;
      font-weight: 600;
    }
    .tag.warn { background: var(--warning-soft); color: var(--warning); }
    .tag.bad { background: var(--danger-soft); color: var(--danger); }
    .bulk-bar {
      background: var(--primary-soft);
      border: 1px solid var(--primary);
      border-radius: 10px;
      padding: 10px 14px;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }
    table.inv-table {
      width: 100%;
      border-collapse: collapse;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
    }
    table.inv-table th {
      text-align: left;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
      background: var(--muted);
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }
    table.inv-table td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
    }
    table.inv-table tr:last-child td { border-bottom: none; }
    table.inv-table tr:hover td { background: rgba(128, 128, 128, 0.04); }
    .table-wrap { overflow-x: auto; border-radius: 12px; }
    .thumb-sm {
      width: 38px;
      height: 38px;
      border-radius: 7px;
      object-fit: cover;
      border: 1px solid var(--border);
      cursor: pointer;
    }
    .thumb-btn {
      width: 38px;
      height: 38px;
      border-radius: 7px;
      background: var(--muted);
      border: 1px dashed var(--border);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      font-size: 10px;
      font-weight: 600;
      cursor: pointer;
    }
    pre { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 14px; overflow-x: auto; font-size: 13px; color: var(--text); }
    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(15, 18, 16, 0.8);
      display: none; align-items: center; justify-content: center; padding: 20px; z-index: 100;
    }
    .modal-backdrop.open { display: flex; }
    .modal-box {
      background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
      padding: 20px; width: 100%; max-width: 460px; max-height: 90vh; overflow-y: auto;
    }
    .qr-frame { background: #fcfbf8; border-radius: 14px; padding: 14px; display: inline-block; margin: 12px 0; border: 1px solid var(--border); }
    .qr-frame img { width: 240px; height: 240px; display: block; }
    .lightbox img { max-width: 92vw; max-height: 80vh; border-radius: 12px; }
    .lightbox-cap { color: #f2efe9; font-size: 15px; font-weight: 600; margin-top: 10px; }
    .hidden { display: none !important; }
    .link-btn { background: none; border: none; color: var(--primary); padding: 4px; min-height: auto; text-decoration: underline; }
    .activity-row { padding: 10px 0; border-top: 1px solid var(--border); display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .activity-row:first-child { border-top: none; padding-top: 4px; }
    .shop-row {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px 14px;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .chk-big { width: 22px; height: 22px; min-height: auto; cursor: pointer; accent-color: var(--primary); }
    .label-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; align-items: start; }
    .label-preview-stage {
      background: var(--bg);
      border: 1px dashed var(--border);
      border-radius: 12px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      margin: 12px 0;
    }
    .label-card-2x1 {
      width: 300px;
      height: 150px;
      background: #ffffff;
      color: #000000;
      border: 1px solid #c8c2b8;
      border-radius: 6px;
      padding: 8px 10px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .label-card-1x2 {
      width: 150px;
      height: 300px;
      background: #ffffff;
      color: #000000;
      border: 1px solid #c8c2b8;
      border-radius: 6px;
      padding: 10px 8px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 14px; }
    .kpi-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px; }
    .kpi-val { font-size: 26px; font-weight: 800; line-height: 1.15; margin-top: 4px; }
    .kpi-lbl { font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; }
    .bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 13px; }
    .bar-label { width: 120px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .bar-track { flex: 1; height: 10px; background: var(--muted); border-radius: 99px; overflow: hidden; }
    .bar-fill { height: 100%; background: var(--primary); border-radius: 99px; min-width: 2px; }
    .bar-fill.warn { background: var(--warning); }
    .bar-fill.bad { background: var(--danger); }
    .bar-val { width: 68px; text-align: right; color: var(--text-secondary); font-weight: 600; flex-shrink: 0; }
    .mini-list-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg); margin-bottom: 6px; font-size: 13px; }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <img src="/favicon.png" alt="" style="width:28px;height:28px;border-radius:7px;" />
      <span>GrocyGo</span>
      <span id="userPill" class="tag hidden"></span>
    </div>
    <nav id="navTabs" class="hidden" aria-label="Main navigation">
      <button data-tab="inventory" class="active">Inventory</button>
      <button data-tab="stats">Stats</button>
      <button data-tab="receipts">Receipts</button>
      <button data-tab="shopping">Shopping</button>
      <button data-tab="labels">Labels</button>
      <button data-tab="locations">Locations</button>
      <button data-tab="activity">Activity</button>
      <button data-tab="users" id="usersTabBtn" class="hidden">Users</button>
      <button data-tab="import" id="importTabBtn" class="hidden">Import &amp; Backups</button>
      <button data-tab="keys">API &amp; MCP</button>
      <button id="logoutBtn" class="danger">Sign Out</button>
    </nav>
  </header>

  <main>
    <!-- Login View -->
    <section id="loginView" class="card" style="max-width:440px;margin:48px auto;">
      <h2 style="margin-top:0;margin-bottom:6px;">Sign in to GrocyGo</h2>
      <div id="pwLoginBox">
        <p class="muted" style="margin-top:0;">Use your household username and password.</p>
        <div class="field">
          <label for="loginUsername">Username</label>
          <input id="loginUsername" autocomplete="username" placeholder="admin" />
        </div>
        <div class="field">
          <label for="loginPassword">Password</label>
          <input id="loginPassword" type="password" autocomplete="current-password" placeholder="Password" />
        </div>
        <button id="pwLoginBtn" class="primary" style="width:100%;">Sign In</button>
        <div style="text-align:center;margin-top:12px;">
          <button class="link-btn" id="switchToKeyBtn">Or sign in with API Key</button>
        </div>
      </div>

      <div id="keyLoginBox" class="hidden">
        <p class="muted" style="margin-top:0;">Enter your personal API key.</p>
        <div class="field">
          <label for="apiKeyInput">API Key</label>
          <input id="apiKeyInput" type="password" placeholder="gg_..." />
        </div>
        <button id="keyLoginBtn" class="primary" style="width:100%;">Connect with API Key</button>
        <div style="text-align:center;margin-top:12px;">
          <button class="link-btn" id="switchToPwBtn">Back to Username &amp; Password</button>
        </div>
      </div>
      <p id="loginErr" style="color:var(--danger);font-size:14px;margin-bottom:0;"></p>
    </section>

    <section id="appView" class="hidden">
      <!-- Inventory Tab -->
      <div id="tab-inventory">
        <!-- Filter, Sort & Group Toolbar -->
        <div class="card" style="padding:14px;">
          <div class="row" style="margin-bottom:10px;">
            <input id="searchInput" placeholder="Search items..." style="flex:1;min-width:180px;" />
            <select id="groupFilter" aria-label="Filter by group"></select>
            <select id="locationFilter" aria-label="Filter by location"></select>
            <select id="sortBy" aria-label="Sort items">
              <option value="name_asc">Sort: Name (A–Z)</option>
              <option value="name_desc">Sort: Name (Z–A)</option>
              <option value="due_asc">Sort: Expiry (Soonest)</option>
              <option value="due_desc">Sort: Expiry (Latest)</option>
              <option value="qty_asc">Sort: Qty (Low → High)</option>
              <option value="qty_desc">Sort: Qty (High → Low)</option>
              <option value="recent">Sort: Recently Added</option>
            </select>
          </div>
          <div class="between">
            <div class="row">
              <button id="modeStockBtn" class="sm active">In Stock</button>
              <button id="modeAllBtn" class="sm">All Items</button>
              <span id="invCountLabel" class="muted" style="margin-left:6px;"></span>
            </div>
            <div class="row">
              <button id="toggleGroupsBtn" class="sm">Manage Groups</button>
              <button id="refreshBtn" class="sm">Refresh</button>
            </div>
          </div>

          <!-- Collapsible Group Manager -->
          <div id="groupsPanel" class="hidden" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);">
            <div class="row" style="margin-bottom:10px;">
              <input id="newGroupInput" placeholder="New group (e.g. Perishables, Non-Perishables, Dry, Wet, Frozen)" style="flex:1;" />
              <button id="addGroupBtn" class="primary sm">Create Group</button>
            </div>
            <div id="groupsChips" class="row"></div>
          </div>
        </div>

        <!-- Bulk Action Bar (appears when items checked) -->
        <div id="bulkBar" class="bulk-bar hidden">
          <div class="row">
            <strong id="bulkCountLabel">0 selected</strong>
            <select id="bulkGroupSelect" aria-label="Target group"></select>
            <button id="applyBulkGroupBtn" class="primary sm">Assign to Group</button>
          </div>
          <div class="row">
            <button id="bulkDeleteBtn" class="danger sm">Delete Selected</button>
            <button id="clearSelectionBtn" class="sm">Clear</button>
          </div>
        </div>

        <div class="table-wrap" id="inventoryTableWrap"></div>
      </div>

      <!-- Stats & Insights Tab -->
      <div id="tab-stats" class="hidden">
        <div class="card between" style="padding:14px;">
          <div>
            <h3 style="margin:0;">Inventory Stats &amp; Insights</h3>
            <div class="muted">Live health, waste tracking, consumption trends, and storage distribution.</div>
          </div>
          <div class="row">
            <select id="statsWindowSelect" aria-label="Stats time window">
              <option value="30">Last 30 Days</option>
              <option value="90">Last 90 Days</option>
              <option value="365">Last 365 Days</option>
            </select>
            <button id="refreshStatsBtn" class="sm">Refresh</button>
          </div>
        </div>
        <div id="statsKpis" class="kpi-grid"></div>
        <div id="statsPanels" class="stats-grid"></div>
      </div>

      <!-- Receipts Tab -->
      <div id="tab-receipts" class="hidden">
        <div class="card" style="padding:14px;">
          <div class="between" style="margin-bottom:10px;">
            <div>
              <h3 style="margin:0;">Receipts &amp; Store Spending</h3>
              <div class="muted">Review OCR receipts, fix store names or prices, and automatically update linked item price history.</div>
            </div>
            <div class="row">
              <label class="sm" style="display:inline-flex;align-items:center;cursor:pointer;background:var(--primary);color:var(--on-primary);border:1px solid var(--primary);border-radius:9px;padding:6px 12px;min-height:36px;font-size:13px;font-weight:600;">
                Upload &amp; OCR Receipt
                <input id="uploadReceiptFile" type="file" accept="image/*" style="display:none;" />
              </label>
              <button id="newManualReceiptBtn" class="sm" type="button">+ Manual Receipt</button>
              <button id="refreshReceiptsBtn" class="sm" type="button">Refresh</button>
            </div>
          </div>
          <div id="receiptOcrStatus" class="hidden"></div>
          <div class="row" style="margin-top:8px;">
            <select id="receiptStoreFilter" aria-label="Filter by store" style="min-width:170px;"></select>
            <select id="receiptSortBy" aria-label="Sort receipts">
              <option value="date_desc">Sort: Date (Newest)</option>
              <option value="date_asc">Sort: Date (Oldest)</option>
              <option value="total_desc">Sort: Total (High → Low)</option>
              <option value="total_asc">Sort: Total (Low → High)</option>
              <option value="store_asc">Sort: Store (A–Z)</option>
            </select>
            <span id="receiptsTotalSummary" class="tag" style="padding:6px 10px;font-size:13px;"></span>
            <button id="toggleAllReceiptsBtn" class="sm" type="button">Expand All</button>
          </div>
          <div id="receiptStoreChips" class="row" style="margin-top:10px;gap:6px;"></div>
        </div>
        <div id="receiptsList"></div>
      </div>

      <!-- Shopping Tab (Global household list: Delete left, Checkbox right) -->
      <div id="tab-shopping" class="hidden">
        <div class="card">
          <div class="row">
            <input id="shopItemInput" placeholder="Add to global household shopping list..." style="flex:1;" />
            <input id="shopQtyInput" type="number" value="1" min="1" style="width:80px;" />
            <button id="addShopBtn" class="primary">Add</button>
            <button id="addMissingBtn">Refill (7d)</button>
            <button id="clearDoneBtn">Delete Checked</button>
          </div>
        </div>
        <div id="shoppingList"></div>
      </div>

      <!-- Labels Tab (1" x 2" Printable QR / Barcode Labels + Create Matching Item) -->
      <div id="tab-labels" class="hidden">
        <div class="label-grid">
          <div class="card">
            <div class="between" style="margin-bottom:8px;">
              <h3 style="margin:0;">1&Prime; &times; 2&Prime; Label Creator</h3>
              <button id="genLabelCodeBtn" class="sm" type="button">New Code</button>
            </div>
            <p class="muted" style="margin-top:0;">Print a crisp QR code or Code 128 barcode onto a 1&Prime;&times;2&Prime; label for items without a barcode.</p>

            <div class="field">
              <label for="labelExistingProd">Load Existing Item (optional)</label>
              <select id="labelExistingProd"></select>
            </div>

            <div class="row" style="gap:10px;">
              <div class="field" style="flex:1.4;">
                <label for="labelCodeInput">Label Code</label>
                <input id="labelCodeInput" placeholder="GG-XXXXXX" />
              </div>
              <div class="field" style="flex:1;">
                <label for="labelFormatSelect">Code Type</label>
                <select id="labelFormatSelect">
                  <option value="qr">QR Code</option>
                  <option value="barcode">Barcode (Code 128)</option>
                </select>
              </div>
            </div>

            <div class="field">
              <label for="labelTitleInput">Label Title (printed on label)</label>
              <input id="labelTitleInput" placeholder="e.g. Homemade Tomato Soup" />
            </div>

            <div class="row" style="gap:10px;">
              <div class="field" style="flex:1.2;">
                <label for="labelSubInput">Note / Date (optional)</label>
                <input id="labelSubInput" placeholder="e.g. Made 2026-11-25" />
              </div>
              <div class="field" style="flex:1;">
                <label for="labelOrientSelect">Label Size</label>
                <select id="labelOrientSelect">
                  <option value="2x1">2&Prime; &times; 1&Prime; (Landscape)</option>
                  <option value="1x2">1&Prime; &times; 2&Prime; (Portrait)</option>
                </select>
              </div>
            </div>

            <div class="row" style="gap:10px;">
              <div class="field" style="flex:1;">
                <label for="labelBatchInput">Unique Codes (Batch Qty)</label>
                <input id="labelBatchInput" type="number" min="1" max="50" value="1" />
              </div>
              <div class="field" style="flex:1;">
                <label for="labelCopiesInput">Copies per Code (Copy Qty)</label>
                <input id="labelCopiesInput" type="number" min="1" max="20" value="1" />
              </div>
            </div>

            <div class="label-preview-stage">
              <div id="labelPreviewCard" class="label-card-2x1"></div>
              <div id="labelBatchSummary" class="muted" style="font-size:12px;">Live preview (prints exact 2&Prime;&times;1&Prime; / 1&Prime;&times;2&Prime; vector SVG)</div>
              <div id="labelBatchList" class="row hidden" style="justify-content:center;gap:6px;max-height:84px;overflow-y:auto;"></div>
            </div>

            <button id="printLabelBtn" class="primary" style="width:100%;" type="button">Print 1&Prime; &times; 2&Prime; Label</button>
          </div>

          <div class="card">
            <h3 style="margin-top:0;margin-bottom:6px;">Create Matching Item</h3>
            <p class="muted" style="margin-top:0;">Create a new inventory item linked to this QR/Barcode right here — or just stick the label on the container and scan it with the GrocyGo mobile app.</p>

            <div class="field">
              <label for="lblItemName">Item Name</label>
              <input id="lblItemName" placeholder="e.g. Homemade Tomato Soup" />
            </div>
            <div class="field">
              <label for="lblItemCode">Linked QR / Barcode</label>
              <input id="lblItemCode" readonly style="opacity:0.85;font-family:monospace;" />
            </div>
            <div class="row" style="gap:10px;">
              <div class="field" style="flex:1;">
                <label for="lblItemLocation">Location</label>
                <select id="lblItemLocation"></select>
              </div>
              <div class="field" style="flex:1;">
                <label for="lblItemGroup">Group</label>
                <select id="lblItemGroup"></select>
              </div>
            </div>
            <div class="row" style="gap:10px;">
              <div class="field" style="flex:1;">
                <label for="lblItemQty">Initial Qty</label>
                <input id="lblItemQty" type="number" min="0" step="0.25" value="1" />
              </div>
              <div class="field" style="flex:1;">
                <label for="lblItemUnit">Unit</label>
                <select id="lblItemUnit"></select>
              </div>
            </div>
            <div class="field">
              <label for="lblItemExpiry">Expiration / Best-Before Date (optional)</label>
              <input id="lblItemExpiry" type="date" />
            </div>
            <button id="createLabeledItemBtn" class="primary" style="width:100%;" type="button">Create Item &amp; Link Code</button>
            <div id="labelItemStatus" class="hidden"></div>
          </div>
        </div>
      </div>

      <!-- Locations Tab -->
      <div id="tab-locations" class="hidden">
        <div class="card">
          <div class="row">
            <input id="locNameInput" placeholder="New storage location (e.g. Garage Freezer)" style="flex:1;" />
            <label class="row" style="font-size:14px;"><input id="locFreezerInput" type="checkbox" style="min-height:auto;width:18px;height:18px;" /> Freezer</label>
            <button id="addLocBtn" class="primary">Add Location</button>
          </div>
        </div>
        <div id="locationsList"></div>
      </div>

      <!-- Activity Tab -->
      <div id="tab-activity" class="hidden">
        <div class="card">
          <div class="between" style="margin-bottom:10px;">
            <h3 style="margin:0;">Household Activity Log</h3>
            <button id="refreshActivityBtn" class="sm">Refresh</button>
          </div>
          <p class="muted" style="margin-top:0;">Tracks every stock update, photo upload, rename, expiry edit, bulk group change, and shopping list action.</p>
          <div id="activityList"></div>
        </div>
      </div>

      <!-- Users Tab -->
      <div id="tab-users" class="hidden">
        <div class="card">
          <h3 style="margin-top:0;margin-bottom:10px;">Add Household Member</h3>
          <div class="row">
            <input id="newUserUsername" placeholder="Username (e.g. sarah)" style="flex:1;min-width:150px;" />
            <input id="newUserDisplay" placeholder="Display Name (e.g. Sarah)" style="flex:1;min-width:150px;" />
            <input id="newUserPassword" type="password" placeholder="Password" style="flex:1;min-width:140px;" />
            <select id="newUserRole">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button id="addUserBtn" class="primary">Add User</button>
          </div>
          <div id="userStatus" class="hidden"></div>
        </div>
        <div class="card">
          <h3 style="margin-top:0;margin-bottom:6px;">Household Members</h3>
          <div id="usersList"></div>
        </div>
      </div>

      <!-- Import & Backups Tab -->
      <div id="tab-import" class="hidden">
        <div class="card">
          <div class="between" style="margin-bottom:8px;">
            <div>
              <h3 style="margin:0;">Automatic Daily Database Backups</h3>
              <div class="muted">Runs automatically every day via atomic SQLite snapshots and keeps the last 7 backups in <code>/data/backups/</code>.</div>
            </div>
            <button id="backupNowBtn" class="primary sm">Back Up Now</button>
          </div>
          <div id="backupStatus" class="hidden"></div>
          <div id="backupsList" style="margin-top:10px;"></div>
        </div>

        <div class="card">
          <h3 style="margin-top:0;margin-bottom:6px;">Import from Running Grocy Server</h3>
          <div class="field">
            <label for="oldGrocyUrl">Original Grocy URL</label>
            <input id="oldGrocyUrl" placeholder="https://grocy.yourdomain.com or http://192.168.1.50:9283" />
          </div>
          <div class="field">
            <label for="oldGrocyKey">Original Grocy API Key</label>
            <input id="oldGrocyKey" type="password" placeholder="API key from original Grocy" />
          </div>
          <div class="row" style="margin-bottom:14px;">
            <label class="row" style="font-size:14px;"><input id="importPhotosChk" type="checkbox" checked style="min-height:auto;width:18px;height:18px;" /> Import product photos</label>
            <label class="row" style="font-size:14px;"><input id="clearApiChk" type="checkbox" style="min-height:auto;width:18px;height:18px;" /> Replace existing data</label>
          </div>
          <button id="runApiImportBtn" class="primary">Import from Grocy API</button>
          <div id="apiImportStatus" class="hidden"></div>
        </div>

        <div class="card">
          <h3 style="margin-top:0;margin-bottom:6px;">Import Original grocy.db SQLite File</h3>
          <div class="row" style="margin-bottom:12px;">
            <input id="grocyDbFile" type="file" accept=".db,.sqlite,.sqlite3,application/octet-stream" />
          </div>
          <div class="row" style="margin-bottom:14px;">
            <label class="row" style="font-size:14px;"><input id="clearDbChk" type="checkbox" style="min-height:auto;width:18px;height:18px;" /> Replace existing data</label>
          </div>
          <button id="runDbImportBtn" class="primary">Upload &amp; Import grocy.db</button>
          <div id="dbImportStatus" class="hidden"></div>
        </div>
      </div>

      <!-- API & MCP Tab -->
      <div id="tab-keys" class="hidden">
        <div class="card">
          <div class="between" style="margin-bottom:10px;">
            <h3 style="margin:0;">API Keys &amp; Mobile QR Setup</h3>
            <button id="createKeyBtn" class="primary sm">New API Key</button>
          </div>
          <div id="keysList"></div>
        </div>

        <div class="card">
          <h3 style="margin-top:0;margin-bottom:8px;">Change My Password</h3>
          <div class="row">
            <input id="curPwInput" type="password" placeholder="Current password" style="flex:1;" />
            <input id="newPwInput" type="password" placeholder="New password" style="flex:1;" />
            <button id="changePwBtn" class="primary">Update Password</button>
          </div>
          <div id="changePwStatus" class="hidden"></div>
        </div>

        <div class="card">
          <div class="between" style="margin-bottom:8px;">
            <h3 style="margin:0;">Daily Alerts &amp; Automation</h3>
            <span id="alertsLastRunBadge" class="tag"></span>
          </div>
          <p class="muted" style="margin-top:0;margin-bottom:14px;">Configure automatic daily expiring-soon notifications sent to all connected mobile apps and optional low-stock automation.</p>
          <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:14px;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:var(--bg);">
            <label class="row" style="align-items:flex-start;cursor:pointer;">
              <input id="alertExpiringToggle" type="checkbox" style="min-height:auto;width:20px;height:20px;margin-top:2px;" />
              <div>
                <strong>Daily Expiring-Soon Alert</strong>
                <div class="muted" style="font-size:13px;">Once a day, find items expiring soon and notify all household mobile apps to use them or lose them.</div>
              </div>
            </label>
            <div class="row" style="gap:12px;padding-left:28px;">
              <div class="field" style="margin-bottom:0;min-width:140px;">
                <label for="alertDaysInput">Days Ahead</label>
                <input id="alertDaysInput" type="number" min="1" max="30" value="5" style="width:110px;" />
              </div>
              <div class="field" style="margin-bottom:0;min-width:160px;">
                <label for="alertHourInput">Send Hour (0–23)</label>
                <input id="alertHourInput" type="number" min="0" max="23" value="9" style="width:110px;" />
              </div>
            </div>
            <label class="row" style="align-items:flex-start;cursor:pointer;padding-top:10px;border-top:1px solid var(--border);">
              <input id="alertAutoShopToggle" type="checkbox" style="min-height:auto;width:20px;height:20px;margin-top:2px;" />
              <div>
                <strong>Auto-Add Below Minimum Stock</strong>
                <div class="muted" style="font-size:13px;">Automatically add missing quantity to the shared shopping list whenever consuming an item drops it below its Min Stock level.</div>
              </div>
            </label>
          </div>
          <div class="row" style="gap:8px;">
            <button id="saveAlertsBtn" class="primary sm">Save Alert Settings</button>
            <button id="testExpiringAlertBtn" class="sm">Send Expiring Alert Now</button>
          </div>
          <div id="alertsAdminNote" class="muted hidden" style="font-size:13px;margin-top:8px;">Only Admin users can change server alert settings.</div>
          <div id="alertsStatus" class="hidden"></div>
        </div>

        <div class="card">
          <div class="between" style="margin-bottom:8px;">
            <h3 style="margin:0;">MCP Server &amp; Permissions</h3>
            <div id="mcpBadges" class="row" style="gap:6px;"></div>
          </div>
          <p class="muted" style="margin-top:0;margin-bottom:14px;">Control what connected AI assistants can read or edit via <code>/mcp</code>. Changes apply immediately.</p>
          <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:14px;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:var(--bg);">
            <label class="row" style="align-items:flex-start;cursor:pointer;">
              <input id="mcpReadToggle" type="checkbox" style="min-height:auto;width:20px;height:20px;margin-top:2px;" />
              <div>
                <strong>Allow Read Access</strong>
                <div class="muted" style="font-size:13px;">AI can view inventory, groups, locations, shopping list, and household activity.</div>
              </div>
            </label>
            <label class="row" style="align-items:flex-start;cursor:pointer;padding-top:10px;border-top:1px solid var(--border);">
              <input id="mcpWriteToggle" type="checkbox" style="min-height:auto;width:20px;height:20px;margin-top:2px;" />
              <div>
                <strong>Allow Write Access</strong>
                <div class="muted" style="font-size:13px;">AI can create groups, assign items to groups, edit item details, and add items to the shopping list.</div>
              </div>
            </label>
            <label class="row" style="align-items:flex-start;cursor:pointer;padding-top:10px;border-top:1px solid var(--border);">
              <input id="mcpDeleteToggle" type="checkbox" style="min-height:auto;width:20px;height:20px;margin-top:2px;" />
              <div>
                <strong>Allow Delete Access</strong>
                <div class="muted" style="font-size:13px;">AI can delete product groups, shopping list entries, or products. Kept separate from Write for safety.</div>
              </div>
            </label>
          </div>
          <div id="mcpAdminNote" class="muted hidden" style="font-size:13px;margin-bottom:10px;">Only Admin users can change MCP permissions.</div>
          <div id="mcpStatus" class="hidden"></div>
          <div id="mcpActiveTools" class="muted" style="font-size:13px;margin-bottom:10px;"></div>
          <pre id="mcpSnippet"></pre>
        </div>
      </div>
    </section>
  </main>

  <!-- Edit Item Modal -->
  <div id="editModal" class="modal-backdrop" onclick="if(event.target===this)closeEditModal()">
    <div class="modal-box">
      <div class="between" style="margin-bottom:14px;">
        <h3 style="margin:0;">Edit Item</h3>
        <button class="sm" onclick="closeEditModal()">Close</button>
      </div>
      <div class="field">
        <label for="editName">Name</label>
        <input id="editName" />
      </div>
      <div class="row" style="gap:10px;">
        <div class="field" style="flex:1;">
          <label for="editGroup">Group</label>
          <select id="editGroup"></select>
        </div>
        <div class="field" style="flex:1;">
          <label for="editLocation">Location</label>
          <select id="editLocation"></select>
        </div>
      </div>
      <div class="row" style="gap:10px;">
        <div class="field" style="flex:1;">
          <label for="editAmount">Quantity in Stock</label>
          <input id="editAmount" type="number" step="0.25" min="0" />
        </div>
        <div class="field" style="flex:1;">
          <label for="editMinStock">Min Stock</label>
          <input id="editMinStock" type="number" step="1" min="0" />
        </div>
      </div>
      <div class="field">
        <label for="editExpiry">Expiration / Best-Before Date</label>
        <div class="row">
          <input id="editExpiry" type="date" style="flex:1;" />
          <button class="sm" onclick="document.getElementById('editExpiry').value=''">No Expiry</button>
        </div>
      </div>
      <div class="field">
        <label for="editDesc">Description / Notes</label>
        <input id="editDesc" placeholder="Optional notes" />
      </div>
      <div class="field">
        <label>Photos</label>
        <div id="editPhotosRow" class="row" style="gap:10px;align-items:stretch;"></div>
      </div>
      <div class="field">
        <label>Active Batches</label>
        <div id="editBatchesList" class="muted" style="font-size:13px;">Loading batches...</div>
      </div>
      <div class="field">
        <label>Linked Barcodes</label>
        <div id="editBarcodesList" style="margin-bottom:6px;"></div>
        <div class="row" style="gap:6px;">
          <input id="editNewBarcodeInput" placeholder="Add barcode (does not change stock)..." style="flex:1;min-height:36px;" />
          <button id="editAddBarcodeBtn" class="sm" type="button">Add</button>
        </div>
        <div id="editBarcodeMsg" class="hidden"></div>
      </div>
      <div id="editErr" class="hidden"></div>
      <div class="row" style="gap:8px;margin-top:6px;">
        <button id="deleteEditBtn" class="danger" type="button">Delete</button>
        <button id="editPrintLabelBtn" type="button" style="flex:1;">Create Label</button>
        <button id="saveEditBtn" class="primary" style="flex:1.5;">Save Changes</button>
      </div>
    </div>
  </div>

  <!-- Edit / Create Receipt Modal -->
  <div id="receiptModal" class="modal-backdrop" onclick="if(event.target===this)closeReceiptModal()">
    <div class="modal-box" style="max-width:660px;">
      <div class="between" style="margin-bottom:12px;">
        <h3 style="margin:0;" id="receiptModalTitle">Edit Receipt</h3>
        <button class="sm" type="button" onclick="closeReceiptModal()">Close</button>
      </div>
      <div class="row" style="gap:10px;">
        <div class="field" style="flex:1.4;">
          <label for="recStoreInput">Store Name</label>
          <input id="recStoreInput" list="storeNameSuggestions" placeholder="e.g. Costco, Trader Joe's" />
          <datalist id="storeNameSuggestions"></datalist>
        </div>
        <div class="field" style="flex:1;">
          <label for="recDateInput">Purchase Date</label>
          <input id="recDateInput" type="date" />
        </div>
        <div class="field" style="flex:0.8;">
          <label for="recTotalInput">Total ($)</label>
          <input id="recTotalInput" type="number" step="0.01" min="0" placeholder="0.00" />
        </div>
      </div>
      <div id="recPhotoPreviewWrap" class="hidden" style="margin-bottom:12px;"></div>
      <div class="between" style="margin-bottom:6px;">
        <strong style="font-size:13px;">Line Items (editing price/store updates linked item history)</strong>
        <div class="row" style="gap:6px;">
          <button id="recSumTotalBtn" class="sm" type="button">Sum Total</button>
          <button id="recAddLineBtn" class="sm" type="button">+ Add Line</button>
        </div>
      </div>
      <div id="recItemsEditor" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;"></div>
      <div id="recModalErr" class="hidden"></div>
      <div class="row" style="gap:8px;margin-top:8px;">
        <button id="recDeleteBtn" class="danger hidden" type="button">Delete Receipt</button>
        <button id="recSaveBtn" class="primary" type="button" style="flex:1;">Save Receipt Changes</button>
      </div>
    </div>
  </div>

  <!-- Photo Lightbox -->
  <div id="lightbox" class="modal-backdrop lightbox" onclick="if(event.target===this)this.classList.remove('open')">
    <div style="text-align:center;" onclick="event.stopPropagation()">
      <img id="lightboxImg" alt="Item photo" />
      <div id="lightboxCap" class="lightbox-cap"></div>
      <div class="row" style="justify-content:center;margin-top:12px;">
        <label class="sm" style="display:inline-flex;align-items:center;cursor:pointer;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:10px;padding:6px 14px;min-height:36px;font-weight:500;">
          Replace Photo
          <input id="lightboxReplaceInput" type="file" accept="image/*" style="display:none;" />
        </label>
        <button id="lightboxRemoveBtn" class="danger sm" type="button">Remove Photo</button>
        <button class="sm" type="button" onclick="document.getElementById('lightbox').classList.remove('open')">Close</button>
      </div>
    </div>
  </div>

  <!-- API Key QR Modal -->
  <div id="qrModal" class="modal-backdrop" onclick="if(event.target===this)this.classList.remove('open')">
    <div class="modal-box" style="text-align:center;">
      <div class="between" style="margin-bottom:8px;">
        <h3 style="margin:0;" id="qrModalTitle">Scan with GrocyGo App</h3>
        <button class="sm" onclick="document.getElementById('qrModal').classList.remove('open')">Close</button>
      </div>
      <div class="field" style="margin-top:10px;">
        <label for="qrServerUrl">Server URL encoded in QR</label>
        <input id="qrServerUrl" placeholder="https://grocygo.yourdomain.com" />
      </div>
      <div class="qr-frame">
        <img id="qrImg" alt="API Key QR code" />
      </div>
      <div class="muted" id="qrPayloadPreview" style="word-break:break-all;font-size:12px;"></div>
    </div>
  </div>

  <script>
    let apiKey = localStorage.getItem('grocygo_key') || '';
    let currentUser = null;
    let state = { stock: [], products: [], barcodes: [], groups: [], locations: [], units: [], shopping: [], keys: [], activity: [], users: [], backups: [], receipts: [], mcpSettings: { read_enabled: true, write_enabled: false }, alertSettings: { expiring_soon_enabled: true, expiring_soon_days: 5, expiring_soon_hour: 9, auto_add_below_min_stock: false, last_expiring_soon_notif_date: null }, stats: null };
    let statsDays = 30;
    let editingReceiptId = null;
    let editingReceiptPhoto = null;
    let editingReceiptOcr = '';
    let editingReceiptItems = [];
    let expandedReceiptIds = new Set();
    let invViewMode = 'stock';
    let selectedIds = new Set();
    let editingProductId = null;
    let activeQrKey = '';
    let activeLightbox = null;

    async function api(path, opts = {}) {
      const res = await fetch(path, {
        ...opts,
        headers: {
          ...(apiKey ? { 'GROCY-API-KEY': apiKey } : {}),
          ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
          ...(opts.headers || {}),
        },
      });
      if (res.status === 204) return null;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error_message || 'Request failed (' + res.status + ')');
      return data;
    }

    function photoUrl(file, thumb = false) {
      return '/api/photos/' + encodeURIComponent(file) + '?api_key=' + encodeURIComponent(apiKey) + (thumb ? '&thumb=1' : '');
    }

    async function compressImageFile(file) {
      if (!file || !file.type || !file.type.startsWith('image/')) return { blob: file, type: file?.type || 'image/jpeg' };
      try {
        const bitmap = await createImageBitmap(file);
        const maxDim = 1280;
        let w = bitmap.width;
        let h = bitmap.height;
        if (w > maxDim || h > maxDim) {
          const scale = maxDim / Math.max(w, h);
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx2d = canvas.getContext('2d');
        ctx2d.drawImage(bitmap, 0, 0, w, h);
        bitmap.close();
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
        if (blob && blob.size > 0 && blob.size < file.size) {
          return { blob, type: 'image/jpeg' };
        }
      } catch {}
      return { blob: file, type: file.type || 'image/jpeg' };
    }

    function refreshQrImage() {
      const rawUrl = (document.getElementById('qrServerUrl').value || window.location.origin).trim().replace(/\\/+$/, '');
      const base = rawUrl.toLowerCase().endsWith('/api') ? rawUrl : rawUrl + '/api';
      const payload = base + '|' + activeQrKey;
      document.getElementById('qrImg').src = '/api/qr?text=' + encodeURIComponent(payload) + '&api_key=' + encodeURIComponent(apiKey);
      document.getElementById('qrPayloadPreview').textContent = base + ' | ' + activeQrKey.slice(0, 8) + '...';
    }

    window.openQrModal = (key, label) => {
      activeQrKey = key;
      document.getElementById('qrModalTitle').textContent = label ? 'QR for ' + label : 'Scan with GrocyGo App';
      document.getElementById('qrServerUrl').value = localStorage.getItem('grocygo_qr_url') || window.location.origin;
      refreshQrImage();
      document.getElementById('qrModal').classList.add('open');
    };
    document.getElementById('qrServerUrl').oninput = () => {
      localStorage.setItem('grocygo_qr_url', document.getElementById('qrServerUrl').value.trim());
      refreshQrImage();
    };

    async function loadAll() {
      const [me, stock, products, barcodes, groups, locations, units, shopping, keys, activity, users, backups, receipts, mcpSettings, alertSettings, stats] = await Promise.all([
        api('/api/auth/me'),
        api('/api/stock'),
        api('/api/objects/products'),
        api('/api/objects/product_barcodes').catch(() => []),
        api('/api/objects/product_groups'),
        api('/api/objects/locations'),
        api('/api/objects/quantity_units'),
        api('/api/objects/shopping_list'),
        api('/api/objects/api_keys'),
        api('/api/activity?limit=80'),
        api('/api/users').catch(() => []),
        api('/api/backups').catch(() => []),
        api('/api/receipts?limit=100').catch(() => []),
        api('/api/mcp/settings').catch(() => ({ read_enabled: true, write_enabled: false })),
        api('/api/settings/alerts').catch(() => ({ expiring_soon_enabled: true, expiring_soon_days: 5, expiring_soon_hour: 9, auto_add_below_min_stock: false, last_expiring_soon_notif_date: null })),
        api('/api/stats?days=' + statsDays).catch(() => null),
      ]);
      currentUser = me;
      state = { stock, products, barcodes, groups, locations, units, shopping, keys, activity, users, backups, receipts, mcpSettings, alertSettings, stats };
      const validIds = new Set(products.map((p) => p.id));
      for (const id of [...selectedIds]) {
        if (!validIds.has(id)) selectedIds.delete(id);
      }
      populateDropdowns();
      renderAll();
    }

    function populateDropdowns() {
      const gf = document.getElementById('groupFilter');
      const prevG = gf.value;
      gf.innerHTML = '<option value="all">All Groups</option><option value="none">Ungrouped</option>' +
        state.groups.map((g) => '<option value="' + g.id + '">' + escapeHtml(g.name) + '</option>').join('');
      if ([...gf.options].some((o) => o.value === prevG)) gf.value = prevG;

      const lf = document.getElementById('locationFilter');
      const prevL = lf.value;
      lf.innerHTML = '<option value="all">All Locations</option>' +
        state.locations.map((l) => '<option value="' + l.id + '">' + escapeHtml(l.name) + '</option>').join('');
      if ([...lf.options].some((o) => o.value === prevL)) lf.value = prevL;

      const bg = document.getElementById('bulkGroupSelect');
      bg.innerHTML = '<option value="">(Ungrouped)</option>' +
        state.groups.map((g) => '<option value="' + g.id + '">' + escapeHtml(g.name) + '</option>').join('');

      // Label creator dropdowns
      const lep = document.getElementById('labelExistingProd');
      if (lep) {
        const prevP = lep.value;
        lep.innerHTML = '<option value="">New / Unbarcoded Item</option>' +
          [...state.products].sort((a, b) => a.name.localeCompare(b.name))
            .map((p) => '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>').join('');
        if ([...lep.options].some((o) => o.value === prevP)) lep.value = prevP;
      }
      const ll = document.getElementById('lblItemLocation');
      if (ll) {
        const prev = ll.value;
        ll.innerHTML = state.locations.map((l) => '<option value="' + l.id + '">' + escapeHtml(l.name) + '</option>').join('');
        if ([...ll.options].some((o) => o.value === prev)) ll.value = prev;
      }
      const lg = document.getElementById('lblItemGroup');
      if (lg) {
        const prev = lg.value;
        lg.innerHTML = '<option value="">(Ungrouped)</option>' +
          state.groups.map((g) => '<option value="' + g.id + '">' + escapeHtml(g.name) + '</option>').join('');
        if ([...lg.options].some((o) => o.value === prev)) lg.value = prev;
      }
      const lu = document.getElementById('lblItemUnit');
      if (lu) {
        const prev = lu.value;
        lu.innerHTML = state.units.map((u) => '<option value="' + u.id + '">' + escapeHtml(u.name) + '</option>').join('');
        if ([...lu.options].some((o) => o.value === prev)) lu.value = prev;
      }
    }

    const ACTION_VERBS = {
      purchase: 'added',
      consume: 'used',
      spoiled: 'marked spoiled',
      open: 'opened',
      open_extend: 'extended opened timer for',
      transfer: 'moved',
      shopping_add: 'added to shopping list:',
      shopping_done: 'checked off:',
      photo_product: 'updated product photo for',
      photo_shelf: 'updated shelf photo for',
      photo_product_remove: 'removed product photo for',
      photo_shelf_remove: 'removed shelf photo for',
      product_create: 'created item',
      product_edit: 'edited',
      product_delete: 'deleted',
      bulk_group: 'grouped',
      bulk_delete: 'deleted',
      location_create: 'created location',
      location_edit: 'updated location',
      group_create: 'created group',
      group_edit: 'updated group',
      receipt_create: 'saved receipt',
      receipt_edit: 'edited receipt',
    };

    function getVisibleRows() {
      const q = (document.getElementById('searchInput').value || '').toLowerCase();
      const gFilter = document.getElementById('groupFilter').value;
      const lFilter = document.getElementById('locationFilter').value;
      const sort = document.getElementById('sortBy').value;

      const stockByProd = Object.fromEntries(state.stock.map((s) => [s.product_id, s]));
      let rows = invViewMode === 'stock'
        ? state.stock.map((s) => ({ product: s.product, stock: s }))
        : state.products.map((p) => ({ product: p, stock: stockByProd[p.id] || null }));

      rows = rows.filter(({ product }) => {
        if (q && !product.name.toLowerCase().includes(q)) return false;
        if (gFilter === 'none' && product.product_group_id) return false;
        if (gFilter !== 'all' && gFilter !== 'none' && String(product.product_group_id) !== gFilter) return false;
        if (lFilter !== 'all' && String(product.location_id) !== lFilter) return false;
        return true;
      });

      const dueVal = (r) => (r.stock && r.stock.best_before_date ? r.stock.best_before_date : '2999-12-31');
      const qtyVal = (r) => (r.stock ? Number(r.stock.amount) : 0);
      const addedVal = (r) => (r.stock && r.stock.last_added_at ? r.stock.last_added_at : r.product.row_created_timestamp || '');

      rows.sort((a, b) => {
        if (sort === 'name_asc') return a.product.name.localeCompare(b.product.name);
        if (sort === 'name_desc') return b.product.name.localeCompare(a.product.name);
        if (sort === 'due_asc') return dueVal(a).localeCompare(dueVal(b));
        if (sort === 'due_desc') return dueVal(b).localeCompare(dueVal(a));
        if (sort === 'qty_asc') return qtyVal(a) - qtyVal(b);
        if (sort === 'qty_desc') return qtyVal(b) - qtyVal(a);
        if (sort === 'recent') return addedVal(b).localeCompare(addedVal(a));
        return 0;
      });

      return rows;
    }

    function updateBulkBar() {
      const bar = document.getElementById('bulkBar');
      if (selectedIds.size > 0) {
        bar.classList.remove('hidden');
        document.getElementById('bulkCountLabel').textContent = selectedIds.size + ' selected';
      } else {
        bar.classList.add('hidden');
      }
    }

    function renderAll() {
      if (currentUser) {
        const pill = document.getElementById('userPill');
        pill.textContent = currentUser.display_name + (currentUser.role === 'admin' ? ' · Admin' : '');
        pill.classList.remove('hidden');
        const isAdmin = currentUser.role === 'admin';
        document.getElementById('usersTabBtn').classList.toggle('hidden', !isAdmin);
        document.getElementById('importTabBtn').classList.toggle('hidden', !isAdmin);
      }

      const locMap = Object.fromEntries(state.locations.map((l) => [l.id, l]));
      const groupMap = Object.fromEntries(state.groups.map((g) => [g.id, g]));
      const unitMap = Object.fromEntries(state.units.map((u) => [u.id, u]));

      // Group chips
      document.getElementById('groupsChips').innerHTML = state.groups.length
        ? state.groups
            .map((g) => \`
              <span class="tag" style="display:inline-flex;align-items:center;gap:6px;padding:5px 10px;">
                \${escapeHtml(g.name)}
                <button class="link-btn" style="color:var(--danger);text-decoration:none;font-weight:700;" onclick="deleteGroup(\${g.id}, '\${escapeAttr(g.name)}')" title="Delete group">&times;</button>
              </span>\`)
            .join('')
        : '<span class="muted">No groups yet. Create ones like Perishables, Dry, Wet, Frozen.</span>';

      // Inventory table
      const rows = getVisibleRows();
      document.getElementById('invCountLabel').textContent = rows.length + ' items';
      const allVisibleSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.product.id));

      const today = new Date().toISOString().slice(0, 10);
      const wrap = document.getElementById('inventoryTableWrap');
      if (rows.length === 0) {
        wrap.innerHTML = '<div class="card muted">No matching items.</div>';
      } else {
        wrap.innerHTML = \`
          <table class="inv-table">
            <thead>
              <tr>
                <th style="width:36px;"><input type="checkbox" class="chk-big" \${allVisibleSelected ? 'checked' : ''} onchange="toggleSelectAll(this.checked)" aria-label="Select all visible" /></th>
                <th style="width:94px;">Photos</th>
                <th>Item</th>
                <th>Group</th>
                <th>Location</th>
                <th>Qty</th>
                <th>Expiry</th>
                <th style="text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              \${rows
                .map(({ product: p, stock: s }) => {
                  const amount = s ? Number(s.amount) : 0;
                  const loc = locMap[p.location_id];
                  const grp = p.product_group_id ? groupMap[p.product_group_id] : null;
                  const u = unitMap[p.qu_id_stock];
                  const unitText = u ? (amount === 1 ? u.name : u.name_plural || u.name) : '';
                  const prodPhoto = (s && s.product_photo_file_name) || p.picture_file_name;
                  const shelfPhoto = (s && s.storage_photo_file_name) || p.storage_photo_file_name;
                  const bbd = s && s.best_before_date && s.best_before_date !== '2999-12-31' ? s.best_before_date : '';
                  const dueCls = bbd && bbd < today ? 'bad' : '';
                  return \`
                    <tr>
                      <td><input type="checkbox" class="chk-big" \${selectedIds.has(p.id) ? 'checked' : ''} onchange="toggleSelectOne(\${p.id}, this.checked)" /></td>
                      <td>
                        <div class="row" style="gap:4px;flex-wrap:nowrap;">
                          \${prodPhoto
                            ? \`<img class="thumb-sm" loading="lazy" decoding="async" src="\${photoUrl(prodPhoto, true)}" title="Product photo (click to view, replace, or remove)" onclick="openPhoto('\${prodPhoto}', '\${escapeAttr(p.name)} — Product', 'product', \${p.id})" />\`
                            : \`<label class="thumb-btn" title="Upload product photo">Item<input type="file" accept="image/*" style="display:none;" onchange="uploadPhoto('product', \${p.id}, this.files[0])" /></label>\`}
                          \${shelfPhoto
                            ? \`<img class="thumb-sm" loading="lazy" decoding="async" src="\${photoUrl(shelfPhoto, true)}" title="Shelf photo (click to view, replace, or remove)" onclick="openPhoto('\${shelfPhoto}', '\${escapeAttr(p.name)} — Shelf', 'product-storage', \${p.id})" />\`
                            : \`<label class="thumb-btn" title="Upload shelf photo">Shelf<input type="file" accept="image/*" style="display:none;" onchange="uploadPhoto('product-storage', \${p.id}, this.files[0])" /></label>\`}
                        </div>
                      </td>
                      <td>
                        <a href="/item/\${p.id}" onclick="event.preventDefault();openEditModal(\${p.id})" style="color:var(--text);text-decoration:none;"><strong>\${escapeHtml(p.name)}</strong></a>
                        \${p.description ? \`<div class="muted" style="font-size:12px;">\${escapeHtml(p.description)}</div>\` : ''}
                      </td>
                      <td>\${grp ? \`<span class="tag">\${escapeHtml(grp.name)}</span>\` : '<span class="muted">—</span>'}</td>
                      <td>\${loc ? escapeHtml(loc.name) : '—'}</td>
                      <td style="white-space:nowrap;"><strong>\${amount}</strong> \${escapeHtml(unitText)}</td>
                      <td style="white-space:nowrap;">\${bbd ? \`<span class="tag \${dueCls}">\${escapeHtml(bbd)}</span>\` : '<span class="muted">—</span>'}</td>
                      <td style="text-align:right;white-space:nowrap;">
                        <button class="sm" onclick="quickConsume(\${p.id})" title="Use 1">-1</button>
                        <button class="sm" onclick="quickAdd(\${p.id})" title="Add 1">+1</button>
                        <button class="sm" onclick="openEditModal(\${p.id})">Edit</button>
                      </td>
                    </tr>\`;
                })
                .join('')}
            </tbody>
          </table>\`;
      }
      updateBulkBar();

      // Global Shopping List: Delete on LEFT, Checkbox on RIGHT
      document.getElementById('shoppingList').innerHTML = state.shopping.length
        ? state.shopping
            .map((item) => {
              const who = [];
              if (item.added_by_name) who.push('Added by ' + item.added_by_name);
              if (item.done && item.completed_by_name) who.push('Checked by ' + item.completed_by_name);
              return \`
                <div class="shop-row">
                  <button class="danger sm" onclick="deleteShop(\${item.id})" aria-label="Delete item">Delete</button>
                  <div style="flex:1;\${item.done ? 'text-decoration:line-through;opacity:0.55;' : ''}">
                    <strong>\${escapeHtml(item.product_name || item.note || 'Item')}</strong> &times; \${item.amount}
                    \${who.length ? \`<div class="muted" style="font-size:12px;">\${escapeHtml(who.join(' · '))}</div>\` : ''}
                  </div>
                  <input type="checkbox" class="chk-big" \${item.done ? 'checked' : ''} onchange="toggleShop(\${item.id}, this.checked)" aria-label="Mark checked" />
                </div>\`;
            })
            .join('')
        : '<div class="card muted">Global shopping list is empty.</div>';

      // Locations
      document.getElementById('locationsList').innerHTML = state.locations
        .map((l) => \`
          <div class="card between">
            <div>
              <strong>\${escapeHtml(l.name)}</strong>
              \${l.is_freezer ? '<span class="tag" style="margin-left:8px;">Freezer</span>' : ''}
              \${l.description ? \`<div class="muted">\${escapeHtml(l.description)}</div>\` : ''}
            </div>
            <button class="danger sm" onclick="deleteLoc(\${l.id})">Delete</button>
          </div>\`)
        .join('');

      // Activity feed
      document.getElementById('activityList').innerHTML = state.activity.length
        ? state.activity
            .map((e) => {
              const verb = ACTION_VERBS[e.transaction_type] || e.transaction_type;
              const qty = Math.abs(Number(e.amount || 0));
              const unit = qty === 1 ? e.qu_name : (e.qu_name_plural || e.qu_name);
              const showQty = qty > 0 && !['bulk_group', 'bulk_delete', 'product_delete', 'photo_product', 'photo_shelf', 'photo_product_remove', 'photo_shelf_remove', 'product_edit', 'product_create'].includes(e.transaction_type);
              const qtyPart = showQty ? qty + (unit ? ' ' + unit : '') + ' ' : '';
              return \`
                <div class="activity-row">
                  <div>
                    <strong>\${escapeHtml(e.user_display_name)}</strong> \${escapeHtml(verb)}
                    <strong>\${escapeHtml(qtyPart + e.product_name)}</strong>
                    \${e.location_name ? \`<span class="muted"> · \${escapeHtml(e.location_name)}</span>\` : ''}
                    \${e.note ? \`<span class="muted"> (\${escapeHtml(e.note)})</span>\` : ''}
                  </div>
                  <div class="muted" style="font-size:12px;">\${escapeHtml(formatTime(e.timestamp))}</div>
                </div>\`;
            })
            .join('')
        : '<div class="muted">No activity recorded yet.</div>';

      // Users
      document.getElementById('usersList').innerHTML = state.users
        .map((u) => \`
          <div class="between" style="padding:12px 0;border-top:1px solid var(--border);">
            <div>
              <strong>\${escapeHtml(u.display_name)}</strong>
              <span class="muted">(@\${escapeHtml(u.username)})</span>
              <span class="tag" style="margin-left:6px;">\${escapeHtml(u.role)}</span>
            </div>
            <div class="row">
              \${u.primary_api_key ? \`<button class="primary sm" onclick="openQrModal('\${escapeAttr(u.primary_api_key)}', '\${escapeAttr(u.display_name)}')">QR Code</button>\` : ''}
              <button class="sm" onclick="resetUserPassword(\${u.id}, '\${escapeAttr(u.display_name)}')">Reset Password</button>
              \${currentUser && u.id !== currentUser.id ? \`<button class="danger sm" onclick="deleteUser(\${u.id}, '\${escapeAttr(u.display_name)}')">Delete</button>\` : ''}
            </div>
          </div>\`)
        .join('');

      // Backups list
      document.getElementById('backupsList').innerHTML = state.backups.length
        ? state.backups
            .map((b) => \`
              <div class="between" style="padding:10px 0;border-top:1px solid var(--border);">
                <div>
                  <code style="font-size:13px;">\${escapeHtml(b.file_name)}</code>
                  <div class="muted">\${Math.max(1, Math.round(b.size_bytes / 1024))} KB · \${escapeHtml(formatTime(b.created_at))}</div>
                </div>
                <a href="/api/backups/\${encodeURIComponent(b.file_name)}?api_key=\${encodeURIComponent(apiKey)}" style="text-decoration:none;">
                  <button class="sm" type="button">Download</button>
                </a>
              </div>\`)
            .join('')
        : '<div class="muted">No backups yet. Click Back Up Now to create one.</div>';

      // MCP & Keys + Alert Settings
      const alertCfg = state.alertSettings || { expiring_soon_enabled: true, expiring_soon_days: 5, expiring_soon_hour: 9, auto_add_below_min_stock: false, last_expiring_soon_notif_date: null };
      const isAdmin = currentUser && currentUser.role === 'admin';
      const aExp = document.getElementById('alertExpiringToggle');
      const aDays = document.getElementById('alertDaysInput');
      const aHour = document.getElementById('alertHourInput');
      const aAuto = document.getElementById('alertAutoShopToggle');
      const aSave = document.getElementById('saveAlertsBtn');
      if (aExp) {
        aExp.checked = Boolean(alertCfg.expiring_soon_enabled);
        aDays.value = String(alertCfg.expiring_soon_days || 5);
        aHour.value = String(alertCfg.expiring_soon_hour ?? 9);
        aAuto.checked = Boolean(alertCfg.auto_add_below_min_stock);
        aExp.disabled = !isAdmin;
        aDays.disabled = !isAdmin;
        aHour.disabled = !isAdmin;
        aAuto.disabled = !isAdmin;
        aSave.disabled = !isAdmin;
        document.getElementById('alertsAdminNote').classList.toggle('hidden', Boolean(isAdmin));
        document.getElementById('alertsLastRunBadge').textContent = alertCfg.last_expiring_soon_notif_date
          ? 'Last sent: ' + alertCfg.last_expiring_soon_notif_date
          : 'Not sent yet';
      }

      renderStats();
      renderReceipts();

      const mcp = state.mcpSettings || { read_enabled: true, write_enabled: false, delete_enabled: false };
      const readChk = document.getElementById('mcpReadToggle');
      const writeChk = document.getElementById('mcpWriteToggle');
      const deleteChk = document.getElementById('mcpDeleteToggle');
      readChk.checked = Boolean(mcp.read_enabled);
      writeChk.checked = Boolean(mcp.write_enabled);
      deleteChk.checked = Boolean(mcp.delete_enabled);
      readChk.disabled = !isAdmin;
      writeChk.disabled = !isAdmin;
      deleteChk.disabled = !isAdmin;
      document.getElementById('mcpAdminNote').classList.toggle('hidden', Boolean(isAdmin));
      document.getElementById('mcpBadges').innerHTML =
        '<span class="tag">' + (mcp.read_enabled ? 'Read: ON' : 'Read: OFF') + '</span>' +
        '<span class="tag" style="' + (mcp.write_enabled ? 'background:var(--primary-soft);color:var(--primary);font-weight:700;' : '') + '">' +
        (mcp.write_enabled ? 'Write: ON' : 'Write: OFF') + '</span>' +
        '<span class="tag ' + (mcp.delete_enabled ? 'bad' : '') + '">' +
        (mcp.delete_enabled ? 'Delete: ON' : 'Delete: OFF') + '</span>';

      const enabledTools = [];
      if (mcp.read_enabled) enabledTools.push('inventory_summary', 'search_inventory', 'get_item', 'list_locations', 'list_groups', 'get_shopping_list', 'recent_activity');
      if (mcp.write_enabled) enabledTools.push('create_group', 'assign_items_to_group', 'update_item', 'add_to_shopping_list');
      if (mcp.delete_enabled) enabledTools.push('delete_group', 'delete_shopping_item', 'delete_item');
      document.getElementById('mcpActiveTools').innerHTML = enabledTools.length
        ? '<strong>Active MCP tools (' + enabledTools.length + '):</strong> ' + enabledTools.map((t) => '<code>' + t + '</code>').join(', ')
        : '<strong>All MCP tools are currently disabled.</strong>';

      const origin = window.location.origin;
      document.getElementById('mcpSnippet').textContent = JSON.stringify(
        { mcpServers: { grocygo: { url: origin + '/mcp', headers: { 'GROCY-API-KEY': apiKey } } } },
        null,
        2
      );

      document.getElementById('keysList').innerHTML = state.keys
        .map((k) => \`
          <div class="between" style="padding:12px 0;border-top:1px solid var(--border);">
            <div>
              <code style="font-size:13px;">\${escapeHtml(k.api_key)}</code>
              <div class="muted">\${escapeHtml((k.user_display_name ? k.user_display_name + ' · ' : '') + (k.description || 'API Key'))}</div>
            </div>
            <div class="row">
              <button class="primary sm" onclick="openQrModal('\${escapeAttr(k.api_key)}', '\${escapeAttr(k.user_display_name || 'GrocyGo')}')">QR Code</button>
              <button class="sm" onclick="navigator.clipboard.writeText('\${escapeAttr(k.api_key)}')">Copy Key</button>
            </div>
          </div>\`)
        .join('');
    }

    function escapeHtml(s) {
      return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function escapeAttr(s) { return escapeHtml(s).replace(/'/g, "\\'"); }
    function formatTime(ts) {
      if (!ts) return '';
      const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
      return isNaN(d.getTime()) ? ts : d.toLocaleString();
    }
    function formatImportSummary(r) {
      return 'Imported ' + r.locations + ' locations, ' + r.quantity_units + ' units, ' + r.products + ' products, ' +
        r.barcodes + ' barcodes, ' + r.stock_entries + ' stock batches, ' + r.photos + ' photos, ' + r.shopping_list + ' shopping items.';
    }

    // Selection & Bulk Actions
    window.toggleSelectOne = (id, checked) => {
      if (checked) selectedIds.add(id); else selectedIds.delete(id);
      updateBulkBar();
    };
    window.toggleSelectAll = (checked) => {
      const rows = getVisibleRows();
      rows.forEach((r) => { if (checked) selectedIds.add(r.product.id); else selectedIds.delete(r.product.id); });
      renderAll();
    };
    document.getElementById('clearSelectionBtn').onclick = () => { selectedIds.clear(); renderAll(); };
    document.getElementById('applyBulkGroupBtn').onclick = async () => {
      const raw = document.getElementById('bulkGroupSelect').value;
      const product_group_id = raw ? Number(raw) : null;
      await api('/api/products/bulk-group', {
        method: 'POST',
        body: JSON.stringify({ product_ids: [...selectedIds], product_group_id }),
      });
      selectedIds.clear();
      await loadAll();
    };
    document.getElementById('bulkDeleteBtn').onclick = async () => {
      const ids = [...selectedIds];
      if (!ids.length) return;
      const prodMap = Object.fromEntries(state.products.map((p) => [p.id, p.name]));
      const names = ids.map((id) => prodMap[id]).filter(Boolean);
      const preview = names.slice(0, 5).join(', ') + (names.length > 5 ? ', and ' + (names.length - 5) + ' more' : '');
      const msg = ids.length === 1
        ? 'Permanently delete "' + (names[0] || 'this item') + '"? This will also remove its stock batches, barcodes, and photos.'
        : 'Permanently delete ' + ids.length + ' selected items (' + preview + ')? This will also remove their stock batches, barcodes, and photos.';
      if (!confirm(msg)) return;
      const btn = document.getElementById('bulkDeleteBtn');
      btn.disabled = true;
      try {
        await api('/api/products/bulk-delete', {
          method: 'POST',
          body: JSON.stringify({ product_ids: ids }),
        });
        selectedIds.clear();
        await loadAll();
      } catch (e) {
        alert(e.message || 'Failed to delete selected items');
      } finally {
        btn.disabled = false;
      }
    };
    document.getElementById('deleteEditBtn').onclick = async () => {
      if (!editingProductId) return;
      const p = state.products.find((x) => x.id === editingProductId);
      const label = p ? p.name : 'this item';
      if (!confirm('Permanently delete "' + label + '"? This will also remove its stock batches, barcodes, and photos.')) return;
      const errEl = document.getElementById('editErr');
      errEl.className = 'hidden';
      try {
        await api('/api/products/bulk-delete', {
          method: 'POST',
          body: JSON.stringify({ product_ids: [editingProductId] }),
        });
        selectedIds.delete(editingProductId);
        document.getElementById('editModal').classList.remove('open');
        await loadAll();
      } catch (e) {
        errEl.className = 'notice err';
        errEl.textContent = e.message || 'Failed to delete item';
      }
    };

    // Groups
    document.getElementById('toggleGroupsBtn').onclick = () => {
      document.getElementById('groupsPanel').classList.toggle('hidden');
    };
    document.getElementById('addGroupBtn').onclick = async () => {
      const name = document.getElementById('newGroupInput').value.trim();
      if (!name) return;
      try {
        await api('/api/objects/product_groups', { method: 'POST', body: JSON.stringify({ name }) });
        document.getElementById('newGroupInput').value = '';
        await loadAll();
      } catch (e) { alert(e.message); }
    };
    window.deleteGroup = async (id, name) => {
      if (!confirm('Delete group "' + name + '"? Items in it will become ungrouped.')) return;
      await api('/api/objects/product_groups/' + id, { method: 'DELETE' });
      await loadAll();
    };

    function renderEditModalPhotos(productId) {
      const p = state.products.find((x) => x.id === productId);
      const s = state.stock.find((x) => x.product_id === productId);
      const row = document.getElementById('editPhotosRow');
      if (!p || !row) return;
      const prodPhoto = (s && s.product_photo_file_name) || p.picture_file_name;
      const shelfPhoto = (s && s.storage_photo_file_name) || p.storage_photo_file_name;
      const slot = (title, kind, file) => \`
        <div style="flex:1;border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--bg);display:flex;flex-direction:column;gap:8px;align-items:center;">
          <div style="font-size:12px;font-weight:700;color:var(--muted);">\${title}</div>
          \${file
            ? \`<img loading="lazy" decoding="async" src="\${photoUrl(file, true)}" style="width:68px;height:68px;object-fit:cover;border-radius:8px;border:1px solid var(--border);cursor:pointer;" onclick="openPhoto('\${file}', '\${escapeAttr(p.name)} — \${title}', '\${kind}', \${productId})" />\`
            : '<div class="muted" style="height:68px;display:flex;align-items:center;font-size:12px;">No photo</div>'}
          <div class="row" style="gap:6px;justify-content:center;">
            <label class="sm" style="display:inline-flex;align-items:center;cursor:pointer;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:4px 10px;font-size:12px;">
              \${file ? 'Replace' : 'Upload'}
              <input type="file" accept="image/*" style="display:none;" onchange="uploadPhoto('\${kind}', \${productId}, this.files[0])" />
            </label>
            \${file ? \`<button class="danger sm" type="button" style="min-height:28px;padding:4px 10px;font-size:12px;" onclick="removePhoto('\${kind}', \${productId})">Remove</button>\` : ''}
          </div>
        </div>\`;
      row.innerHTML = slot('Item Photo', 'product', prodPhoto) + slot('Shelf Photo', 'product-storage', shelfPhoto);
    }

    // Edit Item Modal
    window.closeEditModal = (updateUrl = true) => {
      document.getElementById('editModal').classList.remove('open');
      if (updateUrl && /^\\/(item|inventory)\\/\\d+/.test(window.location.pathname)) {
        history.replaceState(null, '', '/inventory');
      }
    };
    window.openEditModal = (productId, pushUrl = true) => {
      const p = state.products.find((x) => x.id === productId);
      if (!p) return;
      const s = state.stock.find((x) => x.product_id === productId);
      editingProductId = productId;
      if (pushUrl && window.location.pathname !== '/item/' + productId) {
        history.pushState(null, '', '/item/' + productId);
      }
      document.getElementById('editName').value = p.name || '';
      document.getElementById('editDesc').value = p.description || '';
      document.getElementById('editAmount').value = s ? String(s.amount) : '0';
      document.getElementById('editMinStock').value = String(p.min_stock_amount || 0);
      const bbd = s && s.best_before_date && s.best_before_date !== '2999-12-31' ? s.best_before_date.slice(0, 10) : '';
      document.getElementById('editExpiry').value = bbd;

      const eg = document.getElementById('editGroup');
      eg.innerHTML = '<option value="">(Ungrouped)</option>' +
        state.groups.map((g) => '<option value="' + g.id + '">' + escapeHtml(g.name) + '</option>').join('');
      eg.value = p.product_group_id ? String(p.product_group_id) : '';

      const el = document.getElementById('editLocation');
      el.innerHTML = state.locations.map((l) => '<option value="' + l.id + '">' + escapeHtml(l.name) + '</option>').join('');
      el.value = String(p.location_id);

      renderEditModalPhotos(productId);
      renderEditModalBarcodes(productId);
      loadEditModalBatches(productId);
      document.getElementById('editBarcodeMsg').className = 'hidden';
      document.getElementById('editNewBarcodeInput').value = '';
      document.getElementById('editErr').className = 'hidden';
      document.getElementById('editModal').classList.add('open');
    };

    function renderEditModalBarcodes(productId) {
      const wrap = document.getElementById('editBarcodesList');
      if (!wrap) return;
      const list = state.barcodes.filter((b) => Number(b.product_id) === Number(productId));
      if (list.length === 0) {
        wrap.innerHTML = '<div class="muted" style="font-size:12px;">No barcodes linked yet.</div>';
        return;
      }
      wrap.innerHTML = list
        .map((b) => \`
          <div class="mini-list-row">
            <code style="font-size:13px;">\${escapeHtml(b.barcode)}</code>
            <button class="danger sm" type="button" style="min-height:28px;padding:2px 8px;font-size:12px;" onclick="removeEditBarcode(\${b.id})">Remove</button>
          </div>\`)
        .join('');
    }

    async function loadEditModalBatches(productId) {
      const wrap = document.getElementById('editBatchesList');
      if (!wrap) return;
      wrap.innerHTML = '<div class="muted" style="font-size:12px;">Loading batches...</div>';
      try {
        const entries = await api('/api/stock/products/' + productId + '/entries');
        if (!entries || entries.length === 0) {
          wrap.innerHTML = '<div class="muted" style="font-size:12px;">No active batches in stock.</div>';
          return;
        }
        const today = new Date().toISOString().slice(0, 10);
        wrap.innerHTML = entries
          .map((e) => {
            const loc = e.location_name || 'Location #' + e.location_id;
            const bbd = e.best_before_date && e.best_before_date !== '2999-12-31' ? e.best_before_date : 'No expiry';
            const isOpen = Boolean(e.open);
            const openTag = isOpen
              ? '<span class="tag ' + (e.opened_use_by_date && e.opened_use_by_date <= today ? 'bad' : 'warn') + '" style="margin-left:4px;">Opened' + (e.opened_use_by_date ? ' · due ' + escapeHtml(e.opened_use_by_date) : '') + '</span>'
              : '';
            return \`
              <div class="mini-list-row">
                <div>
                  <strong>\${e.amount}</strong> · \${escapeHtml(loc)} · <span class="muted">\${escapeHtml(bbd)}</span>\${openTag}
                </div>
                <div class="row" style="gap:4px;">
                  \${isOpen
                    ? \`<button class="sm" type="button" style="min-height:28px;padding:2px 8px;font-size:12px;" onclick="batchExtendOpened(\${productId}, \${e.id})">+7d</button>\`
                    : \`<button class="sm" type="button" style="min-height:28px;padding:2px 8px;font-size:12px;" onclick="batchMarkOpened(\${productId})">Open</button>\`}
                  <button class="danger sm" type="button" style="min-height:28px;padding:2px 8px;font-size:12px;" onclick="batchConsumeOne(\${productId}, \${e.id})">-1</button>
                </div>
              </div>\`;
          })
          .join('');
      } catch {
        wrap.innerHTML = '<div class="muted" style="font-size:12px;">Could not load batches.</div>';
      }
    }

    window.batchMarkOpened = async (productId) => {
      await api('/api/stock/products/' + productId + '/open', { method: 'POST', body: JSON.stringify({ amount: 1, days: 14 }) });
      await loadAll();
      await loadEditModalBatches(productId);
    };
    window.batchExtendOpened = async (productId, entryId) => {
      await api('/api/stock/products/' + productId + '/open-extend', { method: 'POST', body: JSON.stringify({ days: 7, stock_entry_id: entryId }) });
      await loadAll();
      await loadEditModalBatches(productId);
    };
    window.batchConsumeOne = async (productId, entryId) => {
      await api('/api/stock/products/' + productId + '/consume', { method: 'POST', body: JSON.stringify({ amount: 1, stock_entry_id: entryId }) });
      await loadAll();
      const s = state.stock.find((x) => x.product_id === productId);
      document.getElementById('editAmount').value = s ? String(s.amount) : '0';
      await loadEditModalBatches(productId);
    };
    window.removeEditBarcode = async (barcodeId) => {
      if (!confirm('Remove this barcode from the item?')) return;
      await api('/api/objects/product_barcodes/' + barcodeId, { method: 'DELETE' });
      await loadAll();
      if (editingProductId) renderEditModalBarcodes(editingProductId);
    };
    document.getElementById('editAddBarcodeBtn').onclick = async () => {
      if (!editingProductId) return;
      const input = document.getElementById('editNewBarcodeInput');
      const msgEl = document.getElementById('editBarcodeMsg');
      const code = input.value.trim();
      msgEl.className = 'hidden';
      if (!code) return;
      const existing = state.barcodes.find((b) => String(b.barcode || '').trim().toLowerCase() === code.toLowerCase());
      if (existing) {
        const owner = state.products.find((p) => p.id === existing.product_id);
        msgEl.className = 'notice err';
        msgEl.textContent = existing.product_id === editingProductId
          ? 'That barcode is already linked to this item.'
          : 'That barcode is already linked to "' + (owner ? owner.name : 'another item') + '".';
        return;
      }
      try {
        await api('/api/objects/product_barcodes', {
          method: 'POST',
          body: JSON.stringify({ product_id: editingProductId, barcode: code }),
        });
        input.value = '';
        await loadAll();
        renderEditModalBarcodes(editingProductId);
      } catch (e) {
        msgEl.className = 'notice err';
        msgEl.textContent = e.message || 'Could not add barcode';
      }
    };

    function renderStats() {
      const kpisEl = document.getElementById('statsKpis');
      const panelsEl = document.getElementById('statsPanels');
      if (!kpisEl || !panelsEl) return;
      const st = state.stats;
      if (!st) {
        kpisEl.innerHTML = '';
        panelsEl.innerHTML = '<div class="card muted">No stats available yet.</div>';
        return;
      }
      const s = st.summary;
      const w = st.waste;
      const kpi = (label, val, sub, color) => \`
        <div class="kpi-card">
          <div class="kpi-lbl">\${label}</div>
          <div class="kpi-val" style="\${color ? 'color:' + color : ''}">\${val}</div>
          <div class="muted" style="font-size:12px;margin-top:4px;">\${sub}</div>
        </div>\`;
      kpisEl.innerHTML =
        kpi('In Stock', s.in_stock_products, s.total_units + ' units · ' + s.total_batches + ' batches', '') +
        kpi('Expiring Soon', s.due_soon_count, s.overdue_count + ' overdue', s.due_soon_count > 0 ? 'var(--warning)' : '') +
        kpi('Opened', s.opened_count, s.opened_expired_count + ' timer expired', s.opened_expired_count > 0 ? 'var(--danger)' : 'var(--primary)') +
        kpi('Below Min Stock', s.below_min_stock_count, s.total_products + ' catalog items', s.below_min_stock_count > 0 ? 'var(--warning)' : '') +
        kpi('Waste Rate (' + st.window_days + 'd)', w.waste_rate_pct + '%', w.spoiled_qty + ' spoiled / ' + w.consumed_qty + ' used', w.waste_rate_pct > 15 ? 'var(--danger)' : 'var(--primary)') +
        (s.estimated_stock_value > 0 ? kpi('Stock Value', '$' + s.estimated_stock_value.toFixed(2), 'Recorded prices', '') : '');

      const makeBars = (rows, maxVal, toneFn) => {
        if (!rows.length) return '<div class="muted">No data yet.</div>';
        const max = Math.max(1, maxVal || Math.max(...rows.map((r) => r.val)));
        return rows.map((r) => {
          const pct = Math.min(100, Math.round((r.val / max) * 100));
          const tone = toneFn ? toneFn(r) : '';
          return \`
            <div class="bar-row">
              <div class="bar-label" title="\${escapeAttr(r.label)}">\${escapeHtml(r.label)}</div>
              <div class="bar-track"><div class="bar-fill \${tone}" style="width:\${pct}%;"></div></div>
              <div class="bar-val">\${escapeHtml(r.text)}</div>
            </div>\`;
        }).join('');
      };

      const eb = st.expiry_buckets;
      const expiryRows = [
        { label: 'Overdue', val: eb.overdue, text: String(eb.overdue), tone: 'bad' },
        { label: 'Next 0–3 days', val: eb.days_0_3, text: String(eb.days_0_3), tone: 'warn' },
        { label: '4–7 days', val: eb.days_4_7, text: String(eb.days_4_7), tone: 'warn' },
        { label: '8–14 days', val: eb.days_8_14, text: String(eb.days_8_14), tone: '' },
        { label: '15–30 days', val: eb.days_15_30, text: String(eb.days_15_30), tone: '' },
        { label: '30+ days', val: eb.days_30_plus, text: String(eb.days_30_plus), tone: '' },
        { label: 'No expiry', val: eb.no_expiry, text: String(eb.no_expiry), tone: '' },
      ];

      const locRows = (st.by_location || []).map((l) => ({
        label: l.name + (l.is_freezer ? ' ❄' : ''),
        val: Number(l.item_count || 0),
        text: l.item_count + ' (' + l.total_units + ')',
      }));
      const grpRows = (st.by_group || []).map((g) => ({
        label: g.name,
        val: Number(g.item_count || 0),
        text: g.item_count + ' (' + g.total_units + ')',
      }));
      const storeRows = (st.by_store || []).map((s) => ({
        label: s.store_name,
        val: Number(s.total_spent || 0),
        text: '$' + Number(s.total_spent || 0).toFixed(2) + ' (' + s.receipt_count + ')',
      }));
      const topConsumedRows = (st.top_consumed || []).map((c) => ({
        label: c.name,
        val: Number(c.total_used || 0),
        text: c.total_used + ' used',
      }));
      const topSpoiledHtml = (w.top_spoiled || []).length
        ? w.top_spoiled.map((x) => '<div class="mini-list-row"><strong>' + escapeHtml(x.name) + '</strong><span class="tag bad">' + x.total_spoiled + ' spoiled</span></div>').join('')
        : '<div class="muted">Zero spoiled items in the last ' + st.window_days + ' days!</div>';
      const userHtml = (st.by_user || []).length
        ? st.by_user.map((u) => '<div class="mini-list-row"><strong>' + escapeHtml(u.display_name) + '</strong><span class="muted">+' + u.added_count + ' added · ' + u.consumed_count + ' used · ' + u.shopping_checked_count + ' shopped</span></div>').join('')
        : '<div class="muted">No household activity recorded in this period.</div>';
      const dh = st.data_health || {};
      const staleHtml = (st.stale_items || []).length
        ? st.stale_items.map((x) => '<div class="mini-list-row"><span><strong>' + escapeHtml(x.name) + '</strong> <span class="muted">(' + escapeHtml(x.location_name || '') + ')</span></span><button class="sm" type="button" onclick="openEditModal(' + x.id + ')">Inspect</button></div>').join('')
        : '<div class="muted">No stale items untouched for 90+ days.</div>';

      panelsEl.innerHTML = \`
        <div class="card"><h3 style="margin-top:0;">Upcoming Expirations</h3>\${makeBars(expiryRows, null, (r) => r.tone)}</div>
        <div class="card"><h3 style="margin-top:0;">Most Consumed (\${st.window_days}d)</h3>\${makeBars(topConsumedRows)}</div>
        <div class="card"><h3 style="margin-top:0;">By Storage Location</h3>\${makeBars(locRows)}</div>
        <div class="card"><h3 style="margin-top:0;">By Product Group</h3>\${makeBars(grpRows)}</div>
        <div class="card"><h3 style="margin-top:0;">Spend by Store (\${st.window_days}d)</h3>\${makeBars(storeRows)}</div>
        <div class="card"><h3 style="margin-top:0;">Top Spoiled / Wasted (\${st.window_days}d)</h3>\${topSpoiledHtml}</div>
        <div class="card"><h3 style="margin-top:0;">Household Activity (\${st.window_days}d)</h3>\${userHtml}</div>
        <div class="card">
          <h3 style="margin-top:0;">Catalog Data Health</h3>
          <div class="mini-list-row"><span>In-stock items missing photo</span><span class="tag">\${dh.missing_photo || 0}</span></div>
          <div class="mini-list-row"><span>In-stock items missing group</span><span class="tag">\${dh.missing_group || 0}</span></div>
          <div class="mini-list-row"><span>In-stock items missing barcode</span><span class="tag">\${dh.missing_barcode || 0}</span></div>
          <div class="mini-list-row"><span>In-stock items with no expiry date</span><span class="tag">\${dh.missing_expiry || 0}</span></div>
        </div>
        <div class="card"><h3 style="margin-top:0;">Stale Items (90+ days untouched)</h3>\${staleHtml}</div>
      \`;
    }

    document.getElementById('statsWindowSelect').onchange = async (e) => {
      statsDays = Number(e.target.value) || 30;
      state.stats = await api('/api/stats?days=' + statsDays).catch(() => null);
      renderStats();
    };
    document.getElementById('refreshStatsBtn').onclick = async () => {
      state.stats = await api('/api/stats?days=' + statsDays).catch(() => null);
      renderStats();
    };

    // ─── Receipts Tab & Editor ──────────────────────────────────
    function receiptEffectiveTotal(r) {
      if (r.total_amount !== null && r.total_amount !== undefined && r.total_amount !== '') {
        return Number(r.total_amount) || 0;
      }
      return (r.items || []).reduce((sum, it) => {
        const line = it.total_price !== null && it.total_price !== undefined
          ? Number(it.total_price)
          : (Number(it.quantity || 1) * Number(it.unit_price || 0));
        return sum + (Number.isFinite(line) ? line : 0);
      }, 0);
    }

    function renderReceipts() {
      const listEl = document.getElementById('receiptsList');
      const filterEl = document.getElementById('receiptStoreFilter');
      const chipsEl = document.getElementById('receiptStoreChips');
      const sumEl = document.getElementById('receiptsTotalSummary');
      const dlEl = document.getElementById('storeNameSuggestions');
      if (!listEl || !filterEl) return;

      const allReceipts = state.receipts || [];
      const storeTotals = new Map();
      for (const r of allReceipts) {
        const sName = (r.store_name || '').trim() || 'Unknown Store';
        const cur = storeTotals.get(sName) || { count: 0, total: 0 };
        cur.count += 1;
        cur.total += receiptEffectiveTotal(r);
        storeTotals.set(sName, cur);
      }

      const storeNames = [...storeTotals.keys()].sort((a, b) => a.localeCompare(b));
      const prevStore = filterEl.value || 'all';
      filterEl.innerHTML = '<option value="all">All Stores (' + allReceipts.length + ')</option>' +
        storeNames.map((s) => '<option value="' + escapeAttr(s) + '">' + escapeHtml(s) + ' (' + storeTotals.get(s).count + ')</option>').join('');
      if ([...filterEl.options].some((o) => o.value === prevStore)) filterEl.value = prevStore;

      if (dlEl) {
        dlEl.innerHTML = storeNames.filter((s) => s !== 'Unknown Store').map((s) => '<option value="' + escapeAttr(s) + '"></option>').join('');
      }

      if (chipsEl) {
        chipsEl.innerHTML = storeNames.length
          ? [...storeTotals.entries()]
              .sort((a, b) => b[1].total - a[1].total)
              .map(([name, info]) => {
                const active = filterEl.value === name;
                return \`<button class="sm \${active ? 'active' : ''}" type="button" onclick="selectReceiptStore('\${escapeAttr(name)}')">\${escapeHtml(name)}: $\${info.total.toFixed(2)} (\${info.count})</button>\`;
              })
              .join('')
          : '';
      }

      const activeStore = filterEl.value || 'all';
      const sortBy = (document.getElementById('receiptSortBy')?.value) || 'date_desc';
      let rows = allReceipts.filter((r) => {
        if (activeStore === 'all') return true;
        return ((r.store_name || '').trim() || 'Unknown Store') === activeStore;
      });

      rows.sort((a, b) => {
        if (sortBy === 'date_asc') return String(a.purchase_date || '').localeCompare(String(b.purchase_date || ''));
        if (sortBy === 'total_desc') return receiptEffectiveTotal(b) - receiptEffectiveTotal(a);
        if (sortBy === 'total_asc') return receiptEffectiveTotal(a) - receiptEffectiveTotal(b);
        if (sortBy === 'store_asc') return String(a.store_name || '').localeCompare(String(b.store_name || ''));
        return String(b.purchase_date || '').localeCompare(String(a.purchase_date || '')) || (b.id - a.id);
      });

      const grandTotal = rows.reduce((sum, r) => sum + receiptEffectiveTotal(r), 0);
      if (sumEl) {
        sumEl.textContent = rows.length + ' receipt' + (rows.length === 1 ? '' : 's') + ' · Total spent: $' + grandTotal.toFixed(2);
      }

      if (rows.length === 0) {
        listEl.innerHTML = '<div class="card muted">No receipts saved yet. Scan a receipt on mobile or upload one above.</div>';
        return;
      }

      const toggleAllBtn = document.getElementById('toggleAllReceiptsBtn');
      if (toggleAllBtn) {
        const allOpen = rows.length > 0 && rows.every((r) => expandedReceiptIds.has(r.id));
        toggleAllBtn.textContent = allOpen ? 'Collapse All' : 'Expand All';
      }

      listEl.innerHTML = rows.map((r) => {
        const tot = receiptEffectiveTotal(r);
        const items = r.items || [];
        const linkedCount = items.filter((i) => i.matched_product_id).length;
        const isExpanded = expandedReceiptIds.has(r.id);
        const itemsHtml = isExpanded
          ? items.map((it) => \`
          <div class="mini-list-row" style="margin-bottom:4px;">
            <div>
              <strong>\${escapeHtml(it.raw_name)}</strong>
              <span class="muted"> · Qty \${it.quantity}\${it.unit_price !== null && it.unit_price !== undefined ? ' · $' + Number(it.unit_price).toFixed(2) + ' ea' : ''}</span>
              \${it.matched_product_name ? '<span class="tag" style="margin-left:6px;background:var(--primary-soft);color:var(--primary);">→ ' + escapeHtml(it.matched_product_name) + '</span>' : '<span class="tag warn" style="margin-left:6px;">Unlinked</span>'}
            </div>
            <strong>\${it.total_price !== null && it.total_price !== undefined ? '$' + Number(it.total_price).toFixed(2) : (it.unit_price !== null && it.unit_price !== undefined ? '$' + (Number(it.unit_price) * Number(it.quantity || 1)).toFixed(2) : '—')}</strong>
          </div>\`).join('')
          : '';
        return \`
          <div class="card">
            <div class="between" style="cursor:pointer;\${isExpanded ? 'margin-bottom:10px;' : ''}" onclick="toggleReceiptExpand(\${r.id})">
              <div class="row" style="gap:10px;">
                <span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;background:var(--muted);color:var(--text-secondary);font-size:13px;font-weight:700;" aria-label="\${isExpanded ? 'Collapse' : 'Expand'}">\${isExpanded ? '▾' : '▸'}</span>
                \${r.photo_file_name ? \`<img class="thumb-sm" src="\${photoUrl(r.photo_file_name, true)}" title="View receipt photo" onclick="event.stopPropagation();openPhoto('\${escapeAttr(r.photo_file_name)}', '\${escapeAttr((r.store_name || 'Receipt') + ' · ' + r.purchase_date)}', 'receipt', \${r.id})" />\` : ''}
                <div>
                  <a href="/receipts/\${r.id}" onclick="event.preventDefault();event.stopPropagation();openReceiptModal(\${r.id})" style="color:var(--text);text-decoration:none;"><strong style="font-size:16px;">\${escapeHtml(r.store_name || 'Unknown Store')}</strong></a>
                  <div class="muted">\${escapeHtml(r.purchase_date || '')} · \${items.length} item\${items.length === 1 ? '' : 's'} (\${linkedCount} linked)</div>
                </div>
              </div>
              <div class="row" style="gap:8px;" onclick="event.stopPropagation()">
                <strong style="font-size:17px;">$\${tot.toFixed(2)}</strong>
                <button class="sm" type="button" onclick="openReceiptModal(\${r.id})">Edit</button>
                <button class="danger sm" type="button" onclick="deleteReceiptById(\${r.id})">Delete</button>
              </div>
            </div>
            \${isExpanded ? \`<div style="padding-top:8px;border-top:1px solid var(--border);">\${itemsHtml || '<div class="muted">No line items.</div>'}</div>\` : ''}
          </div>\`;
      }).join('');
    }

    window.toggleReceiptExpand = (id) => {
      if (expandedReceiptIds.has(id)) expandedReceiptIds.delete(id);
      else expandedReceiptIds.add(id);
      renderReceipts();
    };
    document.getElementById('toggleAllReceiptsBtn').onclick = () => {
      const allReceipts = state.receipts || [];
      const allOpen = allReceipts.length > 0 && allReceipts.every((r) => expandedReceiptIds.has(r.id));
      if (allOpen) {
        expandedReceiptIds.clear();
      } else {
        allReceipts.forEach((r) => expandedReceiptIds.add(r.id));
      }
      renderReceipts();
    };

    window.selectReceiptStore = (storeName) => {
      const sel = document.getElementById('receiptStoreFilter');
      if (!sel) return;
      sel.value = sel.value === storeName ? 'all' : storeName;
      renderReceipts();
    };
    document.getElementById('receiptStoreFilter').onchange = renderReceipts;
    document.getElementById('receiptSortBy').onchange = renderReceipts;
    document.getElementById('refreshReceiptsBtn').onclick = () => loadAll();

    function renderReceiptItemsEditor() {
      const wrap = document.getElementById('recItemsEditor');
      if (!wrap) return;
      const prodOpts = '<option value="">(Unlinked)</option>' +
        [...state.products].sort((a, b) => a.name.localeCompare(b.name))
          .map((p) => '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>').join('');
      if (editingReceiptItems.length === 0) {
        wrap.innerHTML = '<div class="muted" style="font-size:12px;">No line items yet. Click + Add Line above.</div>';
        return;
      }
      wrap.innerHTML = editingReceiptItems.map((it, idx) => \`
        <div class="row" style="gap:6px;padding:8px;border:1px solid var(--border);border-radius:9px;background:var(--bg);">
          <input value="\${escapeAttr(it.raw_name)}" placeholder="Item name" style="flex:1.8;min-width:140px;min-height:34px;" oninput="updateRecLine(\${idx}, 'raw_name', this.value)" />
          <input type="number" step="0.25" min="0.01" value="\${escapeAttr(it.quantity)}" placeholder="Qty" style="width:68px;min-height:34px;" oninput="updateRecLine(\${idx}, 'quantity', this.value)" />
          <input type="number" step="0.01" min="0" value="\${escapeAttr(it.unit_price)}" placeholder="$ ea" style="width:84px;min-height:34px;" oninput="updateRecLine(\${idx}, 'unit_price', this.value)" />
          <select style="flex:1.2;min-width:130px;min-height:34px;" onchange="updateRecLine(\${idx}, 'matched_product_id', this.value)">\${prodOpts}</select>
          <button class="danger sm" type="button" style="min-height:34px;padding:4px 9px;" onclick="removeRecLine(\${idx})">&times;</button>
        </div>\`).join('');
      wrap.querySelectorAll('select').forEach((sel, idx) => {
        const val = editingReceiptItems[idx]?.matched_product_id;
        sel.value = val ? String(val) : '';
      });
    }

    window.updateRecLine = (idx, field, val) => {
      if (!editingReceiptItems[idx]) return;
      editingReceiptItems[idx][field] = val;
    };
    window.removeRecLine = (idx) => {
      editingReceiptItems.splice(idx, 1);
      renderReceiptItemsEditor();
    };
    document.getElementById('recAddLineBtn').onclick = () => {
      editingReceiptItems.push({ id: null, raw_name: '', quantity: '1', unit_price: '', matched_product_id: '' });
      renderReceiptItemsEditor();
    };
    document.getElementById('recSumTotalBtn').onclick = () => {
      const sum = editingReceiptItems.reduce((acc, it) => acc + (Number(it.quantity || 1) * Number(it.unit_price || 0)), 0);
      document.getElementById('recTotalInput').value = sum.toFixed(2);
    };

    window.closeReceiptModal = (updateUrl = true) => {
      document.getElementById('receiptModal').classList.remove('open');
      if (updateUrl && /^\\/receipts\\/\\d+/.test(window.location.pathname)) {
        history.replaceState(null, '', '/receipts');
      }
    };
    window.openReceiptModal = (receiptId, pushUrl = true) => {
      const r = (state.receipts || []).find((x) => x.id === receiptId);
      if (!r) return;
      editingReceiptId = r.id;
      editingReceiptPhoto = r.photo_file_name || null;
      editingReceiptOcr = r.raw_ocr_text || '';
      if (pushUrl && window.location.pathname !== '/receipts/' + r.id) {
        history.pushState(null, '', '/receipts/' + r.id);
      }
      document.getElementById('receiptModalTitle').textContent = 'Edit Receipt #' + r.id;
      document.getElementById('recStoreInput').value = r.store_name || '';
      document.getElementById('recDateInput').value = (r.purchase_date || '').slice(0, 10);
      document.getElementById('recTotalInput').value = r.total_amount !== null && r.total_amount !== undefined ? String(r.total_amount) : '';
      editingReceiptItems = (r.items || []).map((it) => ({
        id: it.id,
        raw_name: it.raw_name || '',
        quantity: String(it.quantity ?? 1),
        unit_price: it.unit_price !== null && it.unit_price !== undefined ? String(it.unit_price) : '',
        matched_product_id: it.matched_product_id ? String(it.matched_product_id) : '',
      }));
      const pWrap = document.getElementById('recPhotoPreviewWrap');
      if (r.photo_file_name) {
        pWrap.className = '';
        pWrap.innerHTML = \`<button class="sm" type="button" onclick="openPhoto('\${escapeAttr(r.photo_file_name)}', 'Receipt Photo', 'receipt', \${r.id})">View Receipt Photo</button>\`;
      } else {
        pWrap.className = 'hidden';
      }
      document.getElementById('recDeleteBtn').classList.remove('hidden');
      document.getElementById('recModalErr').className = 'hidden';
      renderReceiptItemsEditor();
      document.getElementById('receiptModal').classList.add('open');
    };

    document.getElementById('newManualReceiptBtn').onclick = () => {
      editingReceiptId = null;
      editingReceiptPhoto = null;
      editingReceiptOcr = '';
      document.getElementById('receiptModalTitle').textContent = 'New Receipt';
      document.getElementById('recStoreInput').value = '';
      document.getElementById('recDateInput').value = new Date().toISOString().slice(0, 10);
      document.getElementById('recTotalInput').value = '';
      editingReceiptItems = [{ id: null, raw_name: '', quantity: '1', unit_price: '', matched_product_id: '' }];
      document.getElementById('recPhotoPreviewWrap').className = 'hidden';
      document.getElementById('recDeleteBtn').classList.add('hidden');
      document.getElementById('recModalErr').className = 'hidden';
      renderReceiptItemsEditor();
      document.getElementById('receiptModal').classList.add('open');
    };

    document.getElementById('uploadReceiptFile').onchange = async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const stEl = document.getElementById('receiptOcrStatus');
      stEl.className = 'notice';
      stEl.textContent = 'Scanning receipt image with OCR... please wait.';
      try {
        const { blob, type } = await compressImageFile(file);
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        const res = await api('/api/receipts/ocr', {
          method: 'POST',
          body: JSON.stringify({ data_base64: base64, mime_type: type }),
        });
        stEl.className = 'hidden';
        editingReceiptId = null;
        editingReceiptPhoto = res.photo_file_name || null;
        editingReceiptOcr = res.raw_ocr_text || '';
        document.getElementById('receiptModalTitle').textContent = 'Review OCR Receipt';
        document.getElementById('recStoreInput').value = res.store_name || '';
        document.getElementById('recDateInput').value = (res.purchase_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
        document.getElementById('recTotalInput').value = res.total_amount !== null && res.total_amount !== undefined ? String(res.total_amount) : '';
        editingReceiptItems = (res.items || []).map((it) => ({
          id: null,
          raw_name: it.raw_name || '',
          quantity: String(it.quantity ?? 1),
          unit_price: it.unit_price !== null && it.unit_price !== undefined ? String(it.unit_price) : '',
          matched_product_id: '',
        }));
        if (editingReceiptItems.length === 0) {
          editingReceiptItems.push({ id: null, raw_name: '', quantity: '1', unit_price: '', matched_product_id: '' });
        }
        document.getElementById('recPhotoPreviewWrap').className = 'hidden';
        document.getElementById('recDeleteBtn').classList.add('hidden');
        document.getElementById('recModalErr').className = 'hidden';
        renderReceiptItemsEditor();
        document.getElementById('receiptModal').classList.add('open');
      } catch (err) {
        stEl.className = 'notice err';
        stEl.textContent = err.message || 'OCR failed';
      }
    };

    document.getElementById('recSaveBtn').onclick = async () => {
      const errEl = document.getElementById('recModalErr');
      errEl.className = 'hidden';
      const cleanItems = editingReceiptItems
        .filter((it) => String(it.raw_name || '').trim().length > 0)
        .map((it) => {
          const qty = Math.max(0.01, Number(it.quantity) || 1);
          const up = it.unit_price !== '' && it.unit_price !== null ? Number(it.unit_price) : null;
          const cleanUp = up !== null && Number.isFinite(up) && up >= 0 ? Math.round(up * 100) / 100 : null;
          return {
            ...(it.id ? { id: it.id } : {}),
            raw_name: String(it.raw_name).trim(),
            quantity: qty,
            unit_price: cleanUp,
            total_price: cleanUp !== null ? Math.round(cleanUp * qty * 100) / 100 : null,
            matched_product_id: it.matched_product_id ? Number(it.matched_product_id) : null,
          };
        });
      const totalVal = document.getElementById('recTotalInput').value.trim();
      const payload = {
        store_name: document.getElementById('recStoreInput').value.trim(),
        purchase_date: document.getElementById('recDateInput').value || new Date().toISOString().slice(0, 10),
        total_amount: totalVal ? Number(totalVal) : null,
        photo_file_name: editingReceiptPhoto,
        raw_ocr_text: editingReceiptOcr,
        items: cleanItems,
      };
      try {
        if (editingReceiptId) {
          await api('/api/receipts/' + editingReceiptId, { method: 'PUT', body: JSON.stringify(payload) });
        } else {
          await api('/api/receipts', { method: 'POST', body: JSON.stringify(payload) });
        }
        closeReceiptModal();
        await loadAll();
      } catch (err) {
        errEl.className = 'notice err';
        errEl.textContent = err.message || 'Could not save receipt';
      }
    };

    window.deleteReceiptById = async (id) => {
      if (!confirm('Delete this receipt and its recorded receipt price history entries?')) return;
      await api('/api/receipts/' + id, { method: 'DELETE' });
      closeReceiptModal();
      await loadAll();
    };
    document.getElementById('recDeleteBtn').onclick = () => {
      if (editingReceiptId) window.deleteReceiptById(editingReceiptId);
    };
    document.getElementById('saveAlertsBtn').onclick = async () => {
      const stEl = document.getElementById('alertsStatus');
      stEl.className = 'hidden';
      try {
        const updated = await api('/api/settings/alerts', {
          method: 'PUT',
          body: JSON.stringify({
            expiring_soon_enabled: document.getElementById('alertExpiringToggle').checked,
            expiring_soon_days: Number(document.getElementById('alertDaysInput').value || 5),
            expiring_soon_hour: Number(document.getElementById('alertHourInput').value || 9),
            auto_add_below_min_stock: document.getElementById('alertAutoShopToggle').checked,
          }),
        });
        state.alertSettings = updated;
        stEl.className = 'notice';
        stEl.textContent = 'Alert settings saved and active immediately.';
      } catch (e) {
        stEl.className = 'notice err';
        stEl.textContent = e.message || 'Could not save alert settings';
      }
    };
    document.getElementById('testExpiringAlertBtn').onclick = async () => {
      const stEl = document.getElementById('alertsStatus');
      stEl.className = 'hidden';
      try {
        const days = Number(document.getElementById('alertDaysInput').value || 5);
        const res = await api('/api/notifications/check-expiring', {
          method: 'POST',
          body: JSON.stringify({ due_soon_days: days, force: true }),
        });
        stEl.className = 'notice';
        stEl.textContent = res.notified
          ? 'Sent mobile notification: "' + res.body + '"'
          : 'No items are currently expiring within ' + days + ' days.';
        await loadAll();
      } catch (e) {
        stEl.className = 'notice err';
        stEl.textContent = e.message || 'Could not run expiring check';
      }
    };

    document.getElementById('saveEditBtn').onclick = async () => {
      const errEl = document.getElementById('editErr');
      errEl.className = 'hidden';
      try {
        const gVal = document.getElementById('editGroup').value;
        await api('/api/inventory/item/' + editingProductId, {
          method: 'PUT',
          body: JSON.stringify({
            name: document.getElementById('editName').value.trim(),
            description: document.getElementById('editDesc').value.trim(),
            product_group_id: gVal ? Number(gVal) : null,
            location_id: Number(document.getElementById('editLocation').value),
            amount: Number(document.getElementById('editAmount').value || 0),
            min_stock_amount: Number(document.getElementById('editMinStock').value || 0),
            best_before_date: document.getElementById('editExpiry').value || null,
          }),
        });
        document.getElementById('editModal').classList.remove('open');
        await loadAll();
      } catch (e) {
        errEl.className = 'notice err';
        errEl.textContent = e.message;
      }
    };

    // Toolbar filters
    ['searchInput', 'groupFilter', 'locationFilter', 'sortBy'].forEach((id) => {
      const el = document.getElementById(id);
      el.oninput = renderAll;
      el.onchange = renderAll;
    });
    document.getElementById('modeStockBtn').onclick = () => {
      invViewMode = 'stock';
      document.getElementById('modeStockBtn').classList.add('active');
      document.getElementById('modeAllBtn').classList.remove('active');
      renderAll();
    };
    document.getElementById('modeAllBtn').onclick = () => {
      invViewMode = 'all';
      document.getElementById('modeAllBtn').classList.add('active');
      document.getElementById('modeStockBtn').classList.remove('active');
      renderAll();
    };

    window.openPhoto = (file, caption, kind, productId) => {
      activeLightbox = kind && productId ? { file, caption, kind, productId } : null;
      document.getElementById('lightboxImg').src = photoUrl(file);
      document.getElementById('lightboxCap').textContent = caption || '';
      document.getElementById('lightboxRemoveBtn').classList.toggle('hidden', !activeLightbox);
      document.getElementById('lightboxReplaceInput').value = '';
      document.getElementById('lightbox').classList.add('open');
    };
    window.quickConsume = async (id) => { await api('/api/stock/products/' + id + '/consume', { method: 'POST', body: JSON.stringify({ amount: 1 }) }); await loadAll(); };
    window.quickAdd = async (id) => { await api('/api/stock/products/' + id + '/add', { method: 'POST', body: JSON.stringify({ amount: 1 }) }); await loadAll(); };
    window.uploadPhoto = async (kind, id, file) => {
      if (!file) return;
      const prepared = await compressImageFile(file);
      const buf = await prepared.blob.arrayBuffer();
      const res = await fetch('/api/photos/' + kind + '/' + id, {
        method: 'POST',
        headers: { 'GROCY-API-KEY': apiKey, 'Content-Type': prepared.type || 'image/jpeg' },
        body: buf,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { alert(data.error_message || 'Photo upload failed'); return; }
      await loadAll();
      if (editingProductId === id && document.getElementById('editModal').classList.contains('open')) {
        renderEditModalPhotos(id);
      }
      if (activeLightbox && activeLightbox.productId === id && activeLightbox.kind === kind && data.file_name) {
        activeLightbox.file = data.file_name;
        document.getElementById('lightboxImg').src = photoUrl(data.file_name);
      }
    };
    window.removePhoto = async (kind, id) => {
      const label = kind === 'product' ? 'item photo' : 'shelf photo';
      if (!confirm('Remove this ' + label + '?')) return;
      try {
        await api('/api/photos/' + kind + '/' + id, { method: 'DELETE' });
        if (activeLightbox && activeLightbox.productId === id && activeLightbox.kind === kind) {
          document.getElementById('lightbox').classList.remove('open');
          activeLightbox = null;
        }
        await loadAll();
        if (editingProductId === id && document.getElementById('editModal').classList.contains('open')) {
          renderEditModalPhotos(id);
        }
      } catch (e) { alert(e.message); }
    };
    document.getElementById('lightboxRemoveBtn').onclick = () => {
      if (activeLightbox) window.removePhoto(activeLightbox.kind, activeLightbox.productId);
    };
    document.getElementById('lightboxReplaceInput').onchange = (e) => {
      if (activeLightbox && e.target.files[0]) {
        window.uploadPhoto(activeLightbox.kind, activeLightbox.productId, e.target.files[0]);
      }
    };
    window.toggleShop = async (id, done) => { await api('/api/objects/shopping_list/' + id, { method: 'PUT', body: JSON.stringify({ done: done ? 1 : 0 }) }); await loadAll(); };
    window.deleteShop = async (id) => { await api('/api/objects/shopping_list/' + id, { method: 'DELETE' }); await loadAll(); };
    window.deleteLoc = async (id) => { try { await api('/api/objects/locations/' + id, { method: 'DELETE' }); await loadAll(); } catch (e) { alert(e.message); } };

    window.resetUserPassword = async (id, name) => {
      const pw = prompt('Enter a new password for ' + name + ' (min 4 characters):');
      if (!pw) return;
      try {
        await api('/api/users/' + id, { method: 'PUT', body: JSON.stringify({ password: pw }) });
        alert('Password updated for ' + name);
      } catch (e) { alert(e.message); }
    };
    window.deleteUser = async (id, name) => {
      if (!confirm('Delete user ' + name + '?')) return;
      try { await api('/api/users/' + id, { method: 'DELETE' }); await loadAll(); } catch (e) { alert(e.message); }
    };

    document.getElementById('addUserBtn').onclick = async () => {
      const st = document.getElementById('userStatus');
      const username = document.getElementById('newUserUsername').value.trim();
      const display_name = document.getElementById('newUserDisplay').value.trim() || username;
      const password = document.getElementById('newUserPassword').value;
      const role = document.getElementById('newUserRole').value;
      try {
        await api('/api/users', { method: 'POST', body: JSON.stringify({ username, display_name, password, role }) });
        document.getElementById('newUserUsername').value = '';
        document.getElementById('newUserDisplay').value = '';
        document.getElementById('newUserPassword').value = '';
        st.className = 'notice';
        st.textContent = 'Added ' + display_name + ' (@' + username + ').';
        await loadAll();
      } catch (e) { st.className = 'notice err'; st.textContent = e.message; }
    };

    document.getElementById('changePwBtn').onclick = async () => {
      const st = document.getElementById('changePwStatus');
      try {
        await api('/api/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({
            current_password: document.getElementById('curPwInput').value,
            new_password: document.getElementById('newPwInput').value,
          }),
        });
        document.getElementById('curPwInput').value = '';
        document.getElementById('newPwInput').value = '';
        st.className = 'notice';
        st.textContent = 'Password updated.';
      } catch (e) { st.className = 'notice err'; st.textContent = e.message; }
    };

    document.getElementById('backupNowBtn').onclick = async () => {
      const btn = document.getElementById('backupNowBtn');
      const st = document.getElementById('backupStatus');
      btn.disabled = true;
      try {
        const res = await api('/api/backups', { method: 'POST', body: '{}' });
        st.className = 'notice';
        st.textContent = 'Created backup ' + res.file_name;
        await loadAll();
      } catch (e) {
        st.className = 'notice err';
        st.textContent = e.message;
      } finally { btn.disabled = false; }
    };

    document.getElementById('runApiImportBtn').onclick = async () => {
      const btn = document.getElementById('runApiImportBtn');
      const st = document.getElementById('apiImportStatus');
      const server_url = document.getElementById('oldGrocyUrl').value.trim();
      const api_key = document.getElementById('oldGrocyKey').value.trim();
      if (!server_url || !api_key) { st.className = 'notice err'; st.textContent = 'Enter both URL and API key.'; return; }
      btn.disabled = true; st.className = 'notice'; st.textContent = 'Importing from original Grocy...';
      try {
        const report = await api('/api/import/grocy-api', {
          method: 'POST',
          body: JSON.stringify({ server_url, api_key, import_photos: document.getElementById('importPhotosChk').checked, clear_existing: document.getElementById('clearApiChk').checked }),
        });
        st.className = 'notice'; st.textContent = formatImportSummary(report); await loadAll();
      } catch (e) { st.className = 'notice err'; st.textContent = e.message; }
      finally { btn.disabled = false; }
    };

    document.getElementById('runDbImportBtn').onclick = async () => {
      const btn = document.getElementById('runDbImportBtn');
      const st = document.getElementById('dbImportStatus');
      const file = document.getElementById('grocyDbFile').files[0];
      if (!file) { st.className = 'notice err'; st.textContent = 'Select a grocy.db file first.'; return; }
      btn.disabled = true; st.className = 'notice'; st.textContent = 'Uploading and importing grocy.db...';
      try {
        const buf = await file.arrayBuffer();
        const clearFlag = document.getElementById('clearDbChk').checked ? '?clear_existing=1' : '';
        const res = await fetch('/api/import/grocy-db' + clearFlag, {
          method: 'POST', headers: { 'GROCY-API-KEY': apiKey, 'Content-Type': 'application/octet-stream' }, body: buf,
        });
        const report = await res.json();
        if (!res.ok) throw new Error(report.error_message || 'Import failed');
        st.className = 'notice'; st.textContent = formatImportSummary(report); await loadAll();
      } catch (e) { st.className = 'notice err'; st.textContent = e.message; }
      finally { btn.disabled = false; }
    };

    document.getElementById('switchToKeyBtn').onclick = () => {
      document.getElementById('pwLoginBox').classList.add('hidden');
      document.getElementById('keyLoginBox').classList.remove('hidden');
      document.getElementById('loginErr').textContent = '';
    };
    document.getElementById('switchToPwBtn').onclick = () => {
      document.getElementById('keyLoginBox').classList.add('hidden');
      document.getElementById('pwLoginBox').classList.remove('hidden');
      document.getElementById('loginErr').textContent = '';
    };
    document.getElementById('pwLoginBtn').onclick = async () => {
      document.getElementById('loginErr').textContent = '';
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: document.getElementById('loginUsername').value.trim(), password: document.getElementById('loginPassword').value, device_name: 'Web UI' }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error_message || 'Login failed');
        apiKey = data.api_key; localStorage.setItem('grocygo_key', apiKey); await showApp();
      } catch (e) { document.getElementById('loginErr').textContent = e.message; }
    };
    document.getElementById('keyLoginBtn').onclick = async () => {
      apiKey = document.getElementById('apiKeyInput').value.trim();
      document.getElementById('loginErr').textContent = '';
      try { await api('/api/auth/me'); localStorage.setItem('grocygo_key', apiKey); await showApp(); }
      catch (e) { document.getElementById('loginErr').textContent = e.message; }
    };
    document.getElementById('logoutBtn').onclick = () => {
      localStorage.removeItem('grocygo_key'); apiKey = ''; currentUser = null;
      document.getElementById('userPill').classList.add('hidden');
      document.getElementById('appView').classList.add('hidden');
      document.getElementById('navTabs').classList.add('hidden');
      document.getElementById('loginView').classList.remove('hidden');
    };

    function switchTab(tabName, pushUrl = true) {
      document.querySelectorAll('#navTabs button[data-tab]').forEach((b) => {
        b.classList.toggle('active', b.dataset.tab === tabName);
      });
      ['inventory', 'stats', 'receipts', 'shopping', 'labels', 'locations', 'activity', 'users', 'import', 'keys'].forEach((t) => {
        document.getElementById('tab-' + t).classList.toggle('hidden', t !== tabName);
      });
      if (pushUrl) {
        const targetPath = '/' + tabName;
        if (window.location.pathname !== targetPath) {
          history.pushState(null, '', targetPath);
        }
      }
      if (tabName === 'stats') {
        api('/api/stats?days=' + statsDays).then((s) => { state.stats = s; renderStats(); }).catch(() => {});
      }
      if (tabName === 'receipts') {
        api('/api/receipts?limit=100').then((r) => { state.receipts = r; renderReceipts(); }).catch(() => {});
      }
      if (tabName === 'labels') {
        if (!document.getElementById('labelCodeInput').value.trim()) {
          document.getElementById('labelCodeInput').value = generateLabelCode();
        }
        renderLabelPreview();
      }
    }

    document.querySelectorAll('#navTabs button[data-tab]').forEach((btn) => {
      btn.onclick = () => switchTab(btn.dataset.tab);
    });

    // ─── 1" x 2" Label Creator (Batch Unique Codes + Copies per Code) ───
    let labelBatchCodes = [];

    function generateLabelCode() {
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const bytes = new Uint8Array(6);
      crypto.getRandomValues(bytes);
      let out = 'GG-';
      for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
      return out;
    }

    function syncBatchCodes(forceRegenerate = false) {
      const batchQty = Math.min(50, Math.max(1, Number(document.getElementById('labelBatchInput').value) || 1));
      const existingSet = new Set((state.barcodes || []).map((b) => String(b.barcode || '').toUpperCase()));
      const primary = document.getElementById('labelCodeInput').value.trim();

      if (forceRegenerate || labelBatchCodes.length === 0) {
        labelBatchCodes = [];
        if (!forceRegenerate && primary) labelBatchCodes.push(primary);
      } else if (primary) {
        labelBatchCodes[0] = primary;
      }

      const used = new Set(labelBatchCodes.map((c) => c.toUpperCase()));
      while (labelBatchCodes.length < batchQty) {
        let candidate = generateLabelCode();
        let guard = 0;
        while ((used.has(candidate) || existingSet.has(candidate)) && guard < 20) {
          candidate = generateLabelCode();
          guard++;
        }
        used.add(candidate);
        labelBatchCodes.push(candidate);
      }
      labelBatchCodes = labelBatchCodes.slice(0, batchQty);
      if (labelBatchCodes[0] && document.getElementById('labelCodeInput').value.trim() !== labelBatchCodes[0]) {
        document.getElementById('labelCodeInput').value = labelBatchCodes[0];
      }
      return labelBatchCodes;
    }

    function getLabelSvgUrl(code, format) {
      if (format === 'barcode') {
        return '/api/barcode?text=' + encodeURIComponent(code) + '&api_key=' + encodeURIComponent(apiKey);
      }
      return '/api/qr?text=' + encodeURIComponent(code) + '&label=1&api_key=' + encodeURIComponent(apiKey);
    }

    function renderLabelPreview() {
      const codes = syncBatchCodes(false);
      const code = codes[0] || 'GG-SAMPLE';
      const format = document.getElementById('labelFormatSelect').value;
      const title = document.getElementById('labelTitleInput').value.trim();
      const sub = document.getElementById('labelSubInput').value.trim();
      const orient = document.getElementById('labelOrientSelect').value;
      const copies = Math.min(20, Math.max(1, Number(document.getElementById('labelCopiesInput').value) || 1));
      const totalLabels = codes.length * copies;

      const card = document.getElementById('labelPreviewCard');
      const linkedCodeEl = document.getElementById('lblItemCode');
      if (linkedCodeEl) linkedCodeEl.value = code;

      const summaryEl = document.getElementById('labelBatchSummary');
      if (summaryEl) {
        summaryEl.textContent = codes.length > 1
          ? 'Previewing #1 of ' + codes.length + ' unique codes · ' + copies + ' ' + (copies === 1 ? 'copy' : 'copies') + ' each = ' + totalLabels + ' labels total'
          : 'Live preview · ' + copies + ' ' + (copies === 1 ? 'label' : 'copies') + ' (' + (orient === '1x2' ? '1"×2"' : '2"×1"') + ' vector SVG)';
      }

      const printBtn = document.getElementById('printLabelBtn');
      if (printBtn) {
        printBtn.textContent = totalLabels > 1
          ? 'Print ' + totalLabels + ' Labels (' + codes.length + ' unique × ' + copies + ' each)'
          : 'Print 1" × 2" Label';
      }

      const listEl = document.getElementById('labelBatchList');
      if (listEl) {
        if (codes.length > 1) {
          listEl.classList.remove('hidden');
          listEl.innerHTML = codes.map((c) => '<span class="tag" style="font-family:monospace;">' + escapeHtml(c) + '</span>').join('');
        } else {
          listEl.classList.add('hidden');
          listEl.innerHTML = '';
        }
      }

      card.className = orient === '1x2' ? 'label-card-1x2' : 'label-card-2x1';
      const imgUrl = getLabelSvgUrl(code, format);

      if (format === 'qr') {
        if (orient === '1x2') {
          card.innerHTML = \`
            <img src="\${imgUrl}" alt="QR" style="width:124px;height:124px;display:block;flex-shrink:0;" />
            <div style="text-align:center;margin-top:6px;width:100%;overflow:hidden;">
              \${title ? \`<div style="font-size:13px;font-weight:700;line-height:1.2;word-break:break-word;">\${escapeHtml(title)}</div>\` : ''}
              \${sub ? \`<div style="font-size:10px;color:#333;margin-top:2px;">\${escapeHtml(sub)}</div>\` : ''}
              <div style="font-family:monospace;font-size:11px;font-weight:700;margin-top:4px;">\${escapeHtml(code)}</div>
            </div>\`;
        } else {
          card.innerHTML = \`
            <div style="display:flex;align-items:center;gap:10px;width:100%;height:100%;">
              <img src="\${imgUrl}" alt="QR" style="width:126px;height:126px;display:block;flex-shrink:0;" />
              <div style="flex:1;min-width:0;text-align:left;">
                <div style="font-size:14px;font-weight:700;line-height:1.2;word-break:break-word;">\${escapeHtml(title || 'GrocyGo Item')}</div>
                \${sub ? \`<div style="font-size:11px;color:#333;margin-top:3px;word-break:break-word;">\${escapeHtml(sub)}</div>\` : ''}
                <div style="font-family:monospace;font-size:11px;font-weight:700;margin-top:6px;">\${escapeHtml(code)}</div>
              </div>
            </div>\`;
        }
      } else {
        card.innerHTML = \`
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;gap:2px;">
            \${title ? \`<div style="font-size:13px;font-weight:700;line-height:1.15;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">\${escapeHtml(title)}</div>\` : ''}
            <img src="\${imgUrl}" alt="Barcode" style="width:100%;max-height:\${orient === '1x2' ? '120px' : '96px'};object-fit:contain;display:block;" />
            \${sub ? \`<div style="font-size:10px;color:#333;">\${escapeHtml(sub)}</div>\` : ''}
          </div>\`;
      }
    }

    document.getElementById('genLabelCodeBtn').onclick = () => {
      document.getElementById('labelExistingProd').value = '';
      document.getElementById('labelItemStatus').className = 'hidden';
      syncBatchCodes(true);
      renderLabelPreview();
    };
    ['labelCodeInput', 'labelFormatSelect', 'labelTitleInput', 'labelSubInput', 'labelOrientSelect', 'labelBatchInput', 'labelCopiesInput'].forEach((id) => {
      const el = document.getElementById(id);
      el.oninput = () => {
        if (id === 'labelTitleInput') {
          document.getElementById('lblItemName').value = el.value;
        }
        renderLabelPreview();
      };
      el.onchange = renderLabelPreview;
    });

    document.getElementById('labelExistingProd').onchange = () => {
      const pid = Number(document.getElementById('labelExistingProd').value);
      if (!pid) {
        document.getElementById('labelTitleInput').value = '';
        document.getElementById('lblItemName').value = '';
        syncBatchCodes(true);
        renderLabelPreview();
        return;
      }
      const prod = state.products.find((p) => p.id === pid);
      const existingBc = state.barcodes.find((b) => b.product_id === pid);
      document.getElementById('labelBatchInput').value = '1';
      if (prod) {
        document.getElementById('labelTitleInput').value = prod.name;
        document.getElementById('lblItemName').value = prod.name;
        const c = existingBc ? existingBc.barcode : generateLabelCode();
        labelBatchCodes = [c];
        document.getElementById('labelCodeInput').value = c;
      }
      renderLabelPreview();
    };

    document.getElementById('editPrintLabelBtn').onclick = () => {
      const pid = editingProductId;
      document.getElementById('editModal').classList.remove('open');
      switchTab('labels');
      if (pid) {
        document.getElementById('labelExistingProd').value = String(pid);
        document.getElementById('labelExistingProd').onchange();
      }
    };

    document.getElementById('printLabelBtn').onclick = async () => {
      const codes = syncBatchCodes(false);
      if (!codes.length) { alert('Enter or generate a label code first.'); return; }
      const format = document.getElementById('labelFormatSelect').value;
      const title = document.getElementById('labelTitleInput').value.trim();
      const sub = document.getElementById('labelSubInput').value.trim();
      const orient = document.getElementById('labelOrientSelect').value;
      const copies = Math.min(20, Math.max(1, Number(document.getElementById('labelCopiesInput').value) || 1));

      const btn = document.getElementById('printLabelBtn');
      btn.disabled = true;
      let svgs = [];
      try {
        svgs = await Promise.all(
          codes.map(async (c) => {
            const r = await fetch(getLabelSvgUrl(c, format));
            if (!r.ok) throw new Error('Could not render label for ' + c);
            return { code: c, svg: await r.text() };
          })
        );
      } catch (e) {
        alert(e.message);
        btn.disabled = false;
        return;
      } finally {
        btn.disabled = false;
      }

      // Label design size. The print sheet is always a 1in x 2in portrait page:
      // browsers mark a wider-than-tall page as "landscape" and CUPS then rotates
      // it, so a 2x1 label printed only its middle, upside down. A 2x1 label is
      // drawn turned 90deg clockwise on the portrait sheet, and the printer's
      // auto-rotate puts it back upright on the 2in-wide label stock.
      const pageW = orient === '1x2' ? '1in' : '2in';
      const pageH = orient === '1x2' ? '2in' : '1in';
      const rotate = orient !== '1x2';

      const pagesArr = [];
      for (const entry of svgs) {
        const oneHtml = format === 'qr'
          ? (orient === '1x2'
            ? \`<div class="lbl portrait"><div class="qr-box">\${entry.svg}</div><div class="meta">\${title ? '<div class="t">' + escapeHtml(title) + '</div>' : ''}\${sub ? '<div class="s">' + escapeHtml(sub) + '</div>' : ''}<div class="c">\${escapeHtml(entry.code)}</div></div></div>\`
            : \`<div class="lbl landscape"><div class="qr-box">\${entry.svg}</div><div class="meta"><div class="t">\${escapeHtml(title || 'GrocyGo')}</div>\${sub ? '<div class="s">' + escapeHtml(sub) + '</div>' : ''}<div class="c">\${escapeHtml(entry.code)}</div></div></div>\`)
          : \`<div class="lbl bar">\${title ? '<div class="t">' + escapeHtml(title) + '</div>' : ''}<div class="bar-box">\${entry.svg}</div>\${sub ? '<div class="s">' + escapeHtml(sub) + '</div>' : ''}</div>\`;
        for (let k = 0; k < copies; k++) pagesArr.push('<div class="pg">' + oneHtml + '</div>');
      }

      const win = window.open('', '_blank', 'width=440,height=340');
      if (!win) { alert('Allow popups for this site to open the 1"x2" label print sheet.'); return; }
      win.document.write(\`<!DOCTYPE html><html><head><meta charset="utf-8"><title>GrocyGo Labels (\${pagesArr.length})</title><style>
        @page { size: 1in 2in; margin: 0; }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        .pg { width: 1in; height: 2in; overflow: hidden; position: relative; page-break-after: always; break-after: page; }
        .pg:last-child { page-break-after: auto; break-after: auto; }
        .lbl { width: \${pageW}; height: \${pageH}; padding: 0.06in 0.08in; overflow: hidden; display: flex; align-items: center; justify-content: center; }
        \${rotate ? '.lbl { position: absolute; top: 0; left: 0; transform-origin: 0 0; transform: translate(1in, 0) rotate(90deg); }' : ''}
        .lbl.landscape { flex-direction: row; gap: 0.08in; }
        .lbl.landscape .qr-box { width: 0.84in; height: 0.84in; flex-shrink: 0; }
        .lbl.landscape .meta { flex: 1; min-width: 0; text-align: left; }
        .lbl.portrait { flex-direction: column; gap: 0.05in; text-align: center; }
        .lbl.portrait .qr-box { width: 0.84in; height: 0.84in; flex-shrink: 0; }
        .lbl.bar { flex-direction: column; gap: 0.02in; text-align: center; }
        .lbl.bar .bar-box { width: 100%; height: 0.62in; }
        .qr-box svg, .bar-box svg { width: 100%; height: 100%; display: block; }
        .t { font-size: 9pt; font-weight: 700; line-height: 1.15; word-break: break-word; }
        .s { font-size: 7pt; color: #222; margin-top: 2px; }
        .c { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 7.5pt; font-weight: 700; margin-top: 3px; }
      </style></head><body>\${pagesArr.join('')}<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 180); };<\\/script></body></html>\`);
      win.document.close();
    };

    document.getElementById('createLabeledItemBtn').onclick = async () => {
      const st = document.getElementById('labelItemStatus');
      st.className = 'hidden';
      const name = document.getElementById('lblItemName').value.trim();
      const code = document.getElementById('labelCodeInput').value.trim();
      const location_id = Number(document.getElementById('lblItemLocation').value);
      const groupVal = document.getElementById('lblItemGroup').value;
      const qu_id = Number(document.getElementById('lblItemUnit').value);
      const qty = Number(document.getElementById('lblItemQty').value || 0);
      const expiry = document.getElementById('lblItemExpiry').value.trim();

      if (!name) { st.className = 'notice err'; st.textContent = 'Enter an item name.'; return; }
      if (!code) { st.className = 'notice err'; st.textContent = 'Generate or enter a label code first.'; return; }

      try {
        const created = await api('/api/objects/products', {
          method: 'POST',
          body: JSON.stringify({
            name,
            location_id,
            product_group_id: groupVal ? Number(groupVal) : null,
            qu_id_purchase: qu_id,
            qu_id_stock: qu_id,
          }),
        });
        const newProdId = created.created_object_id;
        await api('/api/objects/product_barcodes', {
          method: 'POST',
          body: JSON.stringify({ product_id: newProdId, barcode: code }),
        });
        if (qty > 0) {
          await api('/api/stock/products/' + newProdId + '/add', {
            method: 'POST',
            body: JSON.stringify({
              amount: qty,
              location_id,
              ...(expiry ? { best_before_date: expiry } : {}),
            }),
          });
        }
        st.className = 'notice';
        st.textContent = 'Created "' + name + '" linked to ' + code + ' — ready to scan!';
        await loadAll();
      } catch (e) {
        st.className = 'notice err';
        st.textContent = e.message;
      }
    };

    document.getElementById('refreshBtn').onclick = loadAll;
    document.getElementById('refreshActivityBtn').onclick = loadAll;
    document.getElementById('addShopBtn').onclick = async () => {
      const note = document.getElementById('shopItemInput').value.trim();
      const amount = Number(document.getElementById('shopQtyInput').value || 1);
      if (!note) return;
      await api('/api/objects/shopping_list', { method: 'POST', body: JSON.stringify({ note, amount, shopping_list_id: 1, done: 0 }) });
      document.getElementById('shopItemInput').value = '';
      await loadAll();
    };
    document.getElementById('addMissingBtn').onclick = async () => { await api('/api/stock/shoppinglist/refill-consumed', { method: 'POST', body: JSON.stringify({ days: 7 }) }); await loadAll(); };
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
    async function saveMcpSettings() {
      const st = document.getElementById('mcpStatus');
      try {
        state.mcpSettings = await api('/api/mcp/settings', {
          method: 'PUT',
          body: JSON.stringify({
            read_enabled: document.getElementById('mcpReadToggle').checked,
            write_enabled: document.getElementById('mcpWriteToggle').checked,
            delete_enabled: document.getElementById('mcpDeleteToggle').checked,
          }),
        });
        st.className = 'notice';
        st.textContent = 'MCP permissions updated (Read: ' + (state.mcpSettings.read_enabled ? 'ON' : 'OFF') + ', Write: ' + (state.mcpSettings.write_enabled ? 'ON' : 'OFF') + ', Delete: ' + (state.mcpSettings.delete_enabled ? 'ON' : 'OFF') + ').';
        renderAll();
      } catch (e) {
        st.className = 'notice err';
        st.textContent = e.message;
        await loadAll();
      }
    }
    document.getElementById('mcpReadToggle').onchange = saveMcpSettings;
    document.getElementById('mcpWriteToggle').onchange = saveMcpSettings;
    document.getElementById('mcpDeleteToggle').onchange = saveMcpSettings;

    document.getElementById('createKeyBtn').onclick = async () => {
      await api('/api/objects/api_keys', { method: 'POST', body: JSON.stringify({ description: 'Generated from Web UI' }) });
      await loadAll();
    };

    function applyRouteFromUrl() {
      const p = window.location.pathname.replace(/\\/+$/, '') || '/';
      const itemMatch = p.match(/^\\/(?:item|inventory)\\/(\\d+)$/);
      if (itemMatch) {
        switchTab('inventory', false);
        openEditModal(Number(itemMatch[1]), false);
        return;
      }
      const receiptMatch = p.match(/^\\/receipts\\/(\\d+)$/);
      if (receiptMatch) {
        switchTab('receipts', false);
        openReceiptModal(Number(receiptMatch[1]), false);
        return;
      }
      closeEditModal(false);
      closeReceiptModal(false);
      const tabMatch = p.match(/^\\/(inventory|stats|receipts|shopping|labels|locations|activity|users|import|keys)$/);
      if (tabMatch) {
        switchTab(tabMatch[1], false);
      } else {
        switchTab('inventory', false);
      }
    }

    window.addEventListener('popstate', () => {
      if (currentUser) applyRouteFromUrl();
    });

    async function showApp() {
      document.getElementById('loginView').classList.add('hidden');
      document.getElementById('appView').classList.remove('hidden');
      document.getElementById('navTabs').classList.remove('hidden');
      await loadAll();
      applyRouteFromUrl();
    }

    if (apiKey) { api('/api/auth/me').then(showApp).catch(() => {}); }
  </script>
</body>
</html>`;
}
