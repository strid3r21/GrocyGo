import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { ensureDailyBackup, listDatabaseBackups, pruneOldBackups } from './backups';
import { initDatabase } from './db';
import { createRequestHandler } from './grocyApi';
import { InventoryService } from './inventoryService';

async function runTests() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grocygo-server-test-'));
  process.env.INITIAL_API_KEY = 'test_secret_key_123';
  process.env.INITIAL_ADMIN_PASSWORD = 'admin_pass_123';

  const ctx = initDatabase(tmpDir);
  const service = new InventoryService(ctx);
  const server = http.createServer(createRequestHandler(ctx, service));

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  const headers = { 'GROCY-API-KEY': 'test_secret_key_123', 'Content-Type': 'application/json' };

  try {
    // 1. Health & Auth
    const health = await fetch(`${base}/api/health`).then((r) => r.json());
    assert.equal(health.ok, true);

    const unauth = await fetch(`${base}/api/stock`);
    assert.equal(unauth.status, 401);

    const info = await fetch(`${base}/api/system/info`, { headers }).then((r) => r.json());
    assert.equal(info.features.storage_photos, true);
    assert.equal(info.features.mcp_endpoint, '/mcp');

    // 2. Locations CRUD
    const locCreate = await fetch(`${base}/api/objects/locations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Garage Freezer', description: 'Chest freezer', is_freezer: 1 }),
    }).then((r) => r.json());
    assert.ok(locCreate.created_object_id > 0);

    // 3. Create Product + Link Barcode
    const prodCreate = await fetch(`${base}/api/objects/products`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Organic Whole Milk',
        location_id: 2,
        qu_id_purchase: 3,
        qu_id_stock: 3,
        min_stock_amount: 2,
        default_best_before_days: 7,
      }),
    }).then((r) => r.json());
    const prodId = prodCreate.created_object_id;
    assert.ok(prodId > 0);

    await fetch(`${base}/api/objects/product_barcodes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ product_id: prodId, barcode: '0123456789012' }),
    });

    const byBarcode = await fetch(`${base}/api/stock/products/by-barcode/0123456789012`, {
      headers,
    }).then((r) => r.json());
    assert.equal(byBarcode.product.name, 'Organic Whole Milk');

    // 4. Upload Storage Photo + Purchase with Photo
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
    const uploadRes = await fetch(`${base}/api/photos/upload`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ data_base64: fakeJpeg.toString('base64'), mime_type: 'image/jpeg' }),
    }).then((r) => r.json());
    assert.ok(uploadRes.file_name.endsWith('.jpg'));

    const purchaseRes = await fetch(`${base}/api/stock/products/${prodId}/add`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        amount: 2,
        location_id: 2,
        best_before_date: '2026-12-01',
        photo_file_name: uploadRes.file_name,
        note: 'Top fridge shelf left',
      }),
    }).then((r) => r.json());
    assert.equal(purchaseRes.photo_file_name, uploadRes.file_name);

    // Fetch photo back via query api_key (how mobile <Image> fetches)
    const imgRes = await fetch(
      `${base}/api/photos/${uploadRes.file_name}?api_key=test_secret_key_123`
    );
    assert.equal(imgRes.status, 200);
    assert.equal(imgRes.headers.get('content-type'), 'image/jpeg');

    // Update photo on stock entry (shelf photo) AND upload separate product photo
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const replaceRes = await fetch(`${base}/api/photos/stock-entry/${purchaseRes.id}`, {
      method: 'POST',
      headers: { 'GROCY-API-KEY': 'test_secret_key_123', 'Content-Type': 'image/png' },
      body: fakePng,
    }).then((r) => r.json());
    assert.ok(replaceRes.file_name.endsWith('.png'));

    const prodPhotoRes = await fetch(`${base}/api/photos/product/${prodId}`, {
      method: 'POST',
      headers: { 'GROCY-API-KEY': 'test_secret_key_123', 'Content-Type': 'image/jpeg' },
      body: fakeJpeg,
    }).then((r) => r.json());
    assert.ok(prodPhotoRes.file_name.endsWith('.jpg'));

    const detailsCheck = await fetch(`${base}/api/stock/products/${prodId}`, { headers }).then((r) =>
      r.json()
    );
    assert.equal(detailsCheck.product_photo_file_name, prodPhotoRes.file_name);
    assert.equal(detailsCheck.storage_photo_file_name, replaceRes.file_name);

    // 5. Transfer 1 bottle to Garage Freezer
    await fetch(`${base}/api/stock/products/${prodId}/transfer`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ amount: 1, location_id_from: 2, location_id_to: locCreate.created_object_id }),
    });
    const prodLocs = await fetch(`${base}/api/stock/products/${prodId}/locations`, {
      headers,
    }).then((r) => r.json());
    assert.equal(prodLocs.length, 2);

    // 6. Consume 1 bottle -> now 1 left (below min_stock_amount 2!)
    await fetch(`${base}/api/stock/products/${prodId}/consume`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ amount: 1 }),
    });

    // 7. Shopping list: add missing products automatically
    const addedMissing = await fetch(`${base}/api/stock/shoppinglist/add-missing-products`, {
      method: 'POST',
      headers,
      body: '{}',
    }).then((r) => r.json());
    assert.equal(addedMissing.added, 1);

    // 8. MCP Server: initialize, tools/list, and all 5 compact tools
    const mcpCall = (id: number, method: string, params?: any) =>
      fetch(`${base}/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      }).then((r) => r.json());

    const init = await mcpCall(1, 'initialize', { protocolVersion: '2025-03-26' });
    assert.equal(init.result.serverInfo.name, 'grocygo-mcp');

    const toolsList = await mcpCall(2, 'tools/list');
    assert.equal(toolsList.result.tools.length, 7);

    const summary = await mcpCall(3, 'tools/call', { name: 'inventory_summary', arguments: {} });
    const summaryText: string = summary.result.content[0].text;
    assert.ok(summaryText.includes('Stock: 1 items'));
    assert.ok(summaryText.includes('Shopping(open): 1'));
    assert.ok(summaryText.length < 500, `Expected compact MCP summary, got ${summaryText.length} chars`);

    const search = await mcpCall(4, 'tools/call', {
      name: 'search_inventory',
      arguments: { query: 'milk' },
    });
    const searchText: string = search.result.content[0].text;
    assert.ok(searchText.includes('Organic Whole Milk'));
    assert.ok(searchText.includes('photo:yes'));

    const item = await mcpCall(5, 'tools/call', {
      name: 'get_item',
      arguments: { name: 'Milk' },
    });
    assert.ok(item.result.content[0].text.includes('Batches:'));

    const shopMcp = await mcpCall(6, 'tools/call', {
      name: 'get_shopping_list',
      arguments: {},
    });
    assert.ok(shopMcp.result.content[0].text.includes('[ ] Organic Whole Milk'));

    // 9. QR Code SVG endpoint
    const qrRes = await fetch(
      `${base}/api/qr?text=${encodeURIComponent('https://grocygo.example.com/api|test_secret_key_123')}`,
      { headers }
    );
    assert.equal(qrRes.status, 200);
    assert.ok((qrRes.headers.get('content-type') || '').includes('image/svg+xml'));
    const qrSvg = await qrRes.text();
    assert.ok(qrSvg.includes('<svg'));

    // 10. Import from original Grocy via Live API (mock server with photo)
    const mockGrocy = http.createServer((req, res) => {
      if (req.headers['grocy-api-key'] !== 'old_key') {
        res.writeHead(401);
        res.end('{}');
        return;
      }
      if (req.url?.startsWith('/api/files/productpictures/')) {
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        res.end(fakeJpeg);
        return;
      }
      const routes: Record<string, any[]> = {
        '/api/objects/locations': [{ id: 10, name: 'Basement Shelf', description: 'Bulk', is_freezer: 0 }],
        '/api/objects/quantity_units': [{ id: 20, name: 'Tub', name_plural: 'Tubs' }],
        '/api/objects/product_groups': [{ id: 30, name: 'Breakfast' }],
        '/api/objects/shopping_locations': [{ id: 40, name: 'Costco' }],
        '/api/objects/products': [
          {
            id: 100,
            name: 'Rolled Oats',
            location_id: 10,
            qu_id_purchase: 20,
            qu_id_stock: 20,
            product_group_id: 30,
            shopping_location_id: 40,
            picture_file_name: 'oats.jpg',
          },
        ],
        '/api/objects/product_barcodes': [{ id: 1, product_id: 100, barcode: '999888777666' }],
        '/api/objects/stock': [
          {
            id: 1,
            product_id: 100,
            amount: 3,
            best_before_date: '2027-06-01',
            stock_id: 'legacy-oats-1',
            location_id: 10,
          },
        ],
        '/api/objects/shopping_list': [{ id: 1, product_id: 100, amount: 2, done: 0 }],
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(routes[req.url || ''] || []));
    });
    await new Promise<void>((r) => mockGrocy.listen(0, '127.0.0.1', r));
    const mockPort = (mockGrocy.address() as any).port;
    try {
      const apiImportReport = await fetch(`${base}/api/import/grocy-api`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          server_url: `http://127.0.0.1:${mockPort}`,
          api_key: 'old_key',
          import_photos: true,
        }),
      }).then((r) => r.json());
      assert.equal(apiImportReport.locations, 1);
      assert.equal(apiImportReport.products, 1);
      assert.equal(apiImportReport.barcodes, 1);
      assert.equal(apiImportReport.stock_entries, 1);
      assert.equal(apiImportReport.photos, 1);
      assert.equal(apiImportReport.shopping_list, 1);
    } finally {
      mockGrocy.close();
    }

    // 11. Import from original Grocy SQLite grocy.db upload
    const fakeGrocyDbPath = path.join(tmpDir, 'legacy-grocy.db');
    const legacyDb = new DatabaseSync(fakeGrocyDbPath);
    legacyDb.exec(`
      CREATE TABLE locations (id INTEGER PRIMARY KEY, name TEXT, description TEXT, is_freezer INTEGER);
      CREATE TABLE quantity_units (id INTEGER PRIMARY KEY, name TEXT, name_plural TEXT, description TEXT);
      CREATE TABLE product_groups (id INTEGER PRIMARY KEY, name TEXT, description TEXT);
      CREATE TABLE shopping_locations (id INTEGER PRIMARY KEY, name TEXT, description TEXT);
      CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, description TEXT, location_id INTEGER, qu_id_purchase INTEGER, qu_id_stock INTEGER, min_stock_amount REAL, default_best_before_days INTEGER);
      CREATE TABLE product_barcodes (id INTEGER PRIMARY KEY, product_id INTEGER, barcode TEXT);
      CREATE TABLE stock (id INTEGER PRIMARY KEY, product_id INTEGER, amount REAL, best_before_date TEXT, stock_id TEXT, location_id INTEGER);
      CREATE TABLE shopping_list (id INTEGER PRIMARY KEY, product_id INTEGER, note TEXT, amount REAL, done INTEGER);
      INSERT INTO locations VALUES (5, 'Spice Cabinet', 'Above stove', 0);
      INSERT INTO quantity_units VALUES (7, 'Shaker', 'Shakers', '');
      INSERT INTO products VALUES (55, 'Smoked Paprika', 'Spanish', 5, 7, 7, 1, 365);
      INSERT INTO product_barcodes VALUES (1, 55, '444555666777');
      INSERT INTO stock VALUES (1, 55, 2, '2028-01-01', 'paprika-batch-1', 5);
      INSERT INTO shopping_list VALUES (1, NULL, 'Fresh Basil', 1, 0);
    `);
    legacyDb.close();

    const dbBytes = fs.readFileSync(fakeGrocyDbPath);
    const dbImportReport = await fetch(`${base}/api/import/grocy-db`, {
      method: 'POST',
      headers: { 'GROCY-API-KEY': 'test_secret_key_123', 'Content-Type': 'application/octet-stream' },
      body: dbBytes,
    }).then((r) => r.json());
    assert.equal(dbImportReport.locations, 1);
    assert.equal(dbImportReport.products, 1);
    assert.equal(dbImportReport.barcodes, 1);
    assert.equal(dbImportReport.stock_entries, 1);
    assert.equal(dbImportReport.shopping_list, 1);

    // 12. Multi-user auth, role enforcement, and activity attribution
    const adminLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin_pass_123' }),
    }).then((r) => r.json());
    assert.equal(adminLogin.user.role, 'admin');
    assert.ok(adminLogin.api_key);

    const sarahCreated = await fetch(`${base}/api/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        username: 'sarah',
        display_name: 'Sarah',
        password: 'sarah_password',
        role: 'member',
      }),
    }).then((r) => r.json());
    assert.equal(sarahCreated.username, 'sarah');

    const sarahLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'sarah', password: 'sarah_password' }),
    }).then((r) => r.json());
    const sarahHeaders = { 'GROCY-API-KEY': sarahLogin.api_key, 'Content-Type': 'application/json' };

    // Member cannot create another user
    const forbiddenUser = await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: sarahHeaders,
      body: JSON.stringify({ username: 'bob', password: 'pw1234' }),
    });
    assert.equal(forbiddenUser.status, 403);

    // Sarah adds a shopping item and checks it off
    const sarahShop = await fetch(`${base}/api/objects/shopping_list`, {
      method: 'POST',
      headers: sarahHeaders,
      body: JSON.stringify({ note: 'Sourdough Bread', amount: 1, shopping_list_id: 1, done: 0 }),
    }).then((r) => r.json());
    await fetch(`${base}/api/objects/shopping_list/${sarahShop.created_object_id}`, {
      method: 'PUT',
      headers: sarahHeaders,
      body: JSON.stringify({ done: 1 }),
    });

    const shopItems = await fetch(`${base}/api/objects/shopping_list`, { headers }).then((r) => r.json());
    const breadItem = shopItems.find((i: any) => i.note === 'Sourdough Bread');
    assert.equal(breadItem.added_by_name, 'Sarah');
    assert.equal(breadItem.completed_by_name, 'Sarah');

    const activity = await fetch(`${base}/api/activity?limit=10`, { headers }).then((r) => r.json());
    assert.ok(activity.some((e: any) => e.user_display_name === 'Sarah' && e.product_name === 'Sourdough Bread'));

    const mcpActivity = await mcpCall(7, 'tools/call', {
      name: 'recent_activity',
      arguments: { limit: 5 },
    });
    assert.ok(mcpActivity.result.content[0].text.includes('Sarah'));

    // 13. Bulk group assign, full item edit (rename + expiry + qty), and photo activity log
    const grpCreate = await fetch(`${base}/api/objects/product_groups`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Perishables' }),
    }).then((r) => r.json());
    const bulkRes = await fetch(`${base}/api/products/bulk-group`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ product_ids: [prodId], product_group_id: grpCreate.created_object_id }),
    }).then((r) => r.json());
    assert.equal(bulkRes.updated, 1);

    const edited = await fetch(`${base}/api/inventory/item/${prodId}`, {
      method: 'PUT',
      headers: sarahHeaders,
      body: JSON.stringify({
        name: 'Organic Whole Milk (A2)',
        best_before_date: '2027-02-14',
        amount: 3,
      }),
    }).then((r) => r.json());
    assert.equal(edited.product.name, 'Organic Whole Milk (A2)');
    assert.equal(edited.stock_amount, 3);
    assert.equal(edited.next_due_date, '2027-02-14');

    const fullActivity = await fetch(`${base}/api/activity?limit=25`, { headers }).then((r) => r.json());
    assert.ok(fullActivity.some((e: any) => e.transaction_type === 'photo_product'));
    assert.ok(fullActivity.some((e: any) => e.transaction_type === 'photo_shelf'));
    assert.ok(fullActivity.some((e: any) => e.transaction_type === 'bulk_group'));
    assert.ok(
      fullActivity.some(
        (e: any) => e.transaction_type === 'product_edit' && e.user_display_name === 'Sarah'
      )
    );

    const stockOverview = await fetch(`${base}/api/stock`, { headers }).then((r) => r.json());
    assert.ok(stockOverview[0].last_added_at);

    // 14. Regression test: legacy v1.1.0 stock_log (product_id NOT NULL) migrates cleanly
    const legacyMigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grocygo-mig-test-'));
    try {
      const legacyMigDb = new DatabaseSync(path.join(legacyMigDir, 'grocygo.db'));
      legacyMigDb.exec(`
        CREATE TABLE stock_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL,
          amount REAL NOT NULL,
          transaction_type TEXT NOT NULL,
          location_id INTEGER,
          spoiled INTEGER NOT NULL DEFAULT 0,
          note TEXT DEFAULT '',
          row_created_timestamp TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO stock_log (product_id, amount, transaction_type) VALUES (1, 2, 'purchase');
      `);
      legacyMigDb.close();

      const migratedCtx = initDatabase(legacyMigDir);
      const migService = new InventoryService(migratedCtx);
      // Bulk group log with null product_id must succeed after migration
      migService.logActivity({
        productId: null,
        itemLabel: '3 items',
        amount: 3,
        transactionType: 'bulk_group',
        note: 'Group: Dry',
      });
      const migratedRows = migratedCtx.db.prepare('SELECT COUNT(*) AS c FROM stock_log').get() as {
        c: number;
      };
      assert.equal(migratedRows.c, 2);
      migratedCtx.db.close();
    } finally {
      fs.rmSync(legacyMigDir, { recursive: true, force: true });
    }

    // 15. Daily SQLite backup creation, download, and 7-day retention pruning
    const createdDaily = ensureDailyBackup(ctx, 7);
    assert.equal(createdDaily, true);
    assert.equal(ensureDailyBackup(ctx, 7), false); // idempotent same day

    const manualBackup = await fetch(`${base}/api/backups`, { method: 'POST', headers }).then((r) =>
      r.json()
    );
    assert.ok(manualBackup.file_name.endsWith('.db'));

    const dlBackup = await fetch(`${base}/api/backups/${manualBackup.file_name}`, { headers });
    assert.equal(dlBackup.status, 200);
    const dlBuf = Buffer.from(await dlBackup.arrayBuffer());
    assert.ok(dlBuf.subarray(0, 15).toString('utf8').startsWith('SQLite format 3'));

    // Verify retention prunes older backups beyond keepCount
    const backupsDir = path.join(tmpDir, 'backups');
    for (let i = 1; i <= 10; i++) {
      const day = String(i).padStart(2, '0');
      fs.writeFileSync(path.join(backupsDir, `grocygo-2025-01-${day}.db`), dlBuf);
    }
    pruneOldBackups(tmpDir, 7);
    assert.equal(listDatabaseBackups(tmpDir).length, 7);

    // 16. Shopping-list-only notifications (other users notified; actor & stock actions NOT notified)
    const beforeNotifs = await fetch(`${base}/api/notifications?after_id=0`, { headers }).then((r) =>
      r.json()
    );
    const startId = beforeNotifs.latest_id;

    // Stock add & consume must NOT generate notifications
    await fetch(`${base}/api/stock/products/${prodId}/add`, {
      method: 'POST',
      headers: sarahHeaders,
      body: JSON.stringify({ amount: 1 }),
    });
    await fetch(`${base}/api/stock/products/${prodId}/consume`, {
      method: 'POST',
      headers: sarahHeaders,
      body: JSON.stringify({ amount: 1 }),
    });
    const afterStockNotifs = await fetch(`${base}/api/notifications?after_id=${startId}`, {
      headers,
    }).then((r) => r.json());
    assert.equal(afterStockNotifs.notifications.length, 0);

    // Sarah adds custom item to shopping list -> Admin receives notification, Sarah does NOT
    await fetch(`${base}/api/objects/shopping_list`, {
      method: 'POST',
      headers: sarahHeaders,
      body: JSON.stringify({ note: 'Paper Towels', amount: 2, shopping_list_id: 1, done: 0 }),
    });
    const adminNotifs = await fetch(`${base}/api/notifications?after_id=${startId}`, {
      headers,
    }).then((r) => r.json());
    assert.equal(adminNotifs.notifications.length, 1);
    assert.equal(adminNotifs.notifications[0].body, 'Sarah added Paper Towels to shopping list');

    const sarahNotifs = await fetch(`${base}/api/notifications?after_id=${startId}`, {
      headers: sarahHeaders,
    }).then((r) => r.json());
    assert.equal(sarahNotifs.notifications.length, 0);

    // 17. Dynamic MCP Read/Write Permissions & Group Write Tools
    const defaultMcpPerms = await fetch(`${base}/api/mcp/settings`, { headers }).then((r) => r.json());
    assert.equal(defaultMcpPerms.read_enabled, true);
    assert.equal(defaultMcpPerms.write_enabled, false);

    // Write tool must be blocked when write_enabled is false
    const blockedWrite = await mcpCall(20, 'tools/call', {
      name: 'create_group',
      arguments: { name: 'Dry Goods' },
    });
    assert.equal(blockedWrite.result.isError, true);
    assert.ok(blockedWrite.result.content[0].text.includes('disabled'));

    // Non-admin cannot change MCP settings
    const forbiddenMcp = await fetch(`${base}/api/mcp/settings`, {
      method: 'PUT',
      headers: sarahHeaders,
      body: JSON.stringify({ write_enabled: true }),
    });
    assert.equal(forbiddenMcp.status, 403);

    // Admin turns Write ON
    const enabledWrite = await fetch(`${base}/api/mcp/settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ read_enabled: true, write_enabled: true }),
    }).then((r) => r.json());
    assert.equal(enabledWrite.read_enabled, true);
    assert.equal(enabledWrite.write_enabled, true);

    const rwTools = await mcpCall(21, 'tools/list');
    assert.equal(rwTools.result.tools.length, 11);

    // AI creates group and assigns item to group
    const createdGrp = await mcpCall(22, 'tools/call', {
      name: 'create_group',
      arguments: { name: 'Dry Goods', description: 'Shelf-stable grains and spices' },
    });
    assert.ok(!createdGrp.result.isError);
    assert.ok(createdGrp.result.content[0].text.includes('Dry Goods'));

    const assigned = await mcpCall(23, 'tools/call', {
      name: 'assign_items_to_group',
      arguments: { product_names: ['Smoked Paprika'], group_name: 'Dry Goods' },
    });
    assert.ok(!assigned.result.isError);
    assert.ok(assigned.result.content[0].text.includes('Assigned 1 item to Dry Goods'));

    const drySearch = await mcpCall(24, 'tools/call', {
      name: 'search_inventory',
      arguments: { group: 'Dry Goods' },
    });
    assert.ok(drySearch.result.content[0].text.includes('Smoked Paprika'));
    assert.ok(drySearch.result.content[0].text.includes('[Dry Goods]'));

    const groupsList = await mcpCall(25, 'tools/call', { name: 'list_groups', arguments: {} });
    assert.ok(groupsList.result.content[0].text.includes('Dry Goods | items:1'));

    // Admin turns BOTH Read and Write OFF -> 0 tools exposed and both blocked
    await fetch(`${base}/api/mcp/settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ read_enabled: false, write_enabled: false }),
    });
    const noTools = await mcpCall(26, 'tools/list');
    assert.equal(noTools.result.tools.length, 0);

    const blockedRead = await mcpCall(27, 'tools/call', {
      name: 'inventory_summary',
      arguments: {},
    });
    assert.equal(blockedRead.result.isError, true);

    // Turn Read back ON, keep Write OFF
    await fetch(`${base}/api/mcp/settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ read_enabled: true, write_enabled: false }),
    });
    const readOnlyAgain = await mcpCall(28, 'tools/list');
    assert.equal(readOnlyAgain.result.tools.length, 7);

    // 18. Remove product & shelf photos via UI endpoints (clears DB, deletes files, logs activity)
    const delProdPhoto = await fetch(`${base}/api/photos/product/${prodId}`, {
      method: 'DELETE',
      headers,
    }).then((r) => r.json());
    assert.equal(delProdPhoto.removed, prodPhotoRes.file_name);

    const delShelfPhoto = await fetch(`${base}/api/photos/product-storage/${prodId}`, {
      method: 'DELETE',
      headers,
    }).then((r) => r.json());
    assert.ok(delShelfPhoto.removed.includes(replaceRes.file_name));

    const detailsAfterRemove = await fetch(`${base}/api/stock/products/${prodId}`, {
      headers,
    }).then((r) => r.json());
    assert.equal(detailsAfterRemove.product_photo_file_name, null);
    assert.equal(detailsAfterRemove.storage_photo_file_name, null);
    assert.equal(fs.existsSync(path.join(ctx.photosDir, prodPhotoRes.file_name)), false);
    assert.equal(fs.existsSync(path.join(ctx.photosDir, replaceRes.file_name)), false);

    const photoRemoveActivity = await fetch(`${base}/api/activity?limit=15`, { headers }).then((r) =>
      r.json()
    );
    assert.ok(photoRemoveActivity.some((e: any) => e.transaction_type === 'photo_product_remove'));
    assert.ok(photoRemoveActivity.some((e: any) => e.transaction_type === 'photo_shelf_remove'));

    // 19. Code 128B Barcode SVG + Real Image Downsizing (WebP) + Lazy Thumbnails & ETag 304
    const bcRes = await fetch(`${base}/api/barcode?text=GG-A7K3M9`, { headers });
    assert.equal(bcRes.status, 200);
    assert.ok((bcRes.headers.get('content-type') || '').includes('image/svg+xml'));
    const bcSvg = await bcRes.text();
    assert.ok(bcSvg.includes('<svg') && bcSvg.includes('<rect') && bcSvg.includes('GG-A7K3M9'));

    // Upload an oversized 2000x1500 PNG -> should downsize to <=1280px WebP + create <=240px thumb
    const bigPng = await sharp({
      create: { width: 2000, height: 1500, channels: 3, background: { r: 61, g: 100, b: 74 } },
    })
      .png()
      .toBuffer();

    const optUpload = await fetch(`${base}/api/photos/product/${prodId}`, {
      method: 'POST',
      headers: { 'GROCY-API-KEY': 'test_secret_key_123', 'Content-Type': 'image/png' },
      body: bigPng,
    }).then((r) => r.json());
    assert.ok(optUpload.file_name.endsWith('.webp'));

    const fullImgRes = await fetch(`${base}/api/photos/${optUpload.file_name}`, { headers });
    assert.equal(fullImgRes.status, 200);
    const fullMeta = await sharp(Buffer.from(await fullImgRes.arrayBuffer())).metadata();
    assert.ok((fullMeta.width || 0) <= 1280 && (fullMeta.height || 0) <= 1280);

    const thumbRes = await fetch(`${base}/api/photos/${optUpload.file_name}?thumb=1`, { headers });
    assert.equal(thumbRes.status, 200);
    const thumbEtag = thumbRes.headers.get('etag');
    assert.ok(thumbEtag);
    const thumbMeta = await sharp(Buffer.from(await thumbRes.arrayBuffer())).metadata();
    assert.equal(thumbMeta.width, 240);
    assert.equal(thumbMeta.height, 240);

    const notModRes = await fetch(`${base}/api/photos/${optUpload.file_name}?thumb=1`, {
      headers: { ...headers, 'If-None-Match': thumbEtag! },
    });
    assert.equal(notModRes.status, 304);

    // Deleting photo cleans up both full file and cached thumbnail
    await fetch(`${base}/api/photos/product/${prodId}`, { method: 'DELETE', headers });
    assert.equal(fs.existsSync(path.join(ctx.photosDir, optUpload.file_name)), false);
    assert.equal(
      fs.existsSync(path.join(ctx.photosDir, 'thumbs', `${optUpload.file_name}.webp`)),
      false
    );

    // 20. Separate MCP Delete Permission (OFF by default even when Write is ON)
    await fetch(`${base}/api/mcp/settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ read_enabled: true, write_enabled: true, delete_enabled: false }),
    });
    const writeNoDelTools = await mcpCall(30, 'tools/list');
    assert.equal(writeNoDelTools.result.tools.length, 11);
    const blockedDelete = await mcpCall(31, 'tools/call', {
      name: 'delete_group',
      arguments: { group_name: 'Dry Goods' },
    });
    assert.equal(blockedDelete.result.isError, true);
    assert.ok(blockedDelete.result.content[0].text.includes('Delete'));

    // Enable Delete separately -> 14 tools exposed & delete_group succeeds
    await fetch(`${base}/api/mcp/settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ delete_enabled: true }),
    });
    const allMcpTools = await mcpCall(32, 'tools/list');
    assert.equal(allMcpTools.result.tools.length, 14);
    const deletedGrp = await mcpCall(33, 'tools/call', {
      name: 'delete_group',
      arguments: { group_name: 'Dry Goods' },
    });
    assert.ok(!deletedGrp.result.isError);
    assert.ok(deletedGrp.result.content[0].text.includes('Deleted group'));

    // Turn Delete back OFF
    await fetch(`${base}/api/mcp/settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ write_enabled: false, delete_enabled: false }),
    });

    // 19. Shopping list Refill (consumed in last 7 days) + Set-All-Done + Edit Qty
    // Clear existing shopping list first
    await fetch(`${base}/api/stock/shoppinglist/clear`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ done_only: false }),
    });
    // Refill should pick up the Milk we consumed earlier (qty 1)
    const refillRes = await fetch(`${base}/api/stock/shoppinglist/refill-consumed`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ days: 7 }),
    }).then((r) => r.json());
    assert.ok(refillRes.added >= 1, `Expected at least 1 refilled item, got ${JSON.stringify(refillRes)}`);
    const shopAfterRefill = await fetch(`${base}/api/objects/shopping_list`, { headers }).then((r) =>
      r.json()
    );
    const refilledMilk = shopAfterRefill.find((i: any) => i.product_id === prodId);
    assert.ok(refilledMilk, 'Refilled product should be on shopping list');
    assert.equal(Number(refilledMilk.amount), 2);

    // Edit shopping item qty
    await fetch(`${base}/api/objects/shopping_list/${refilledMilk.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ amount: 4 }),
    });
    const shopAfterEdit = await fetch(`${base}/api/objects/shopping_list`, { headers }).then((r) =>
      r.json()
    );
    assert.equal(Number(shopAfterEdit.find((i: any) => i.id === refilledMilk.id).amount), 4);

    // Select all done & unselect all
    const setAllRes = await fetch(`${base}/api/stock/shoppinglist/set-all-done`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ done: true }),
    }).then((r) => r.json());
    assert.ok(setAllRes.updated >= 1);
    const shopAllDone = await fetch(`${base}/api/objects/shopping_list`, { headers }).then((r) =>
      r.json()
    );
    assert.ok(shopAllDone.every((i: any) => Number(i.done) === 1));

    await fetch(`${base}/api/stock/shoppinglist/set-all-done`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ done: false }),
    });
    const shopNoneDone = await fetch(`${base}/api/objects/shopping_list`, { headers }).then((r) =>
      r.json()
    );
    assert.ok(shopNoneDone.every((i: any) => Number(i.done) === 0));

    // 20. Transfer specific stock batch by stock_entry_id (preserves exact expiry date)
    const batchA = await fetch(`${base}/api/stock/products/${prodId}/add`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ amount: 2, location_id: 1, best_before_date: '2026-10-10' }),
    }).then((r) => r.json());
    const batchB = await fetch(`${base}/api/stock/products/${prodId}/add`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ amount: 3, location_id: 1, best_before_date: '2027-03-15' }),
    }).then((r) => r.json());
    assert.ok(batchA.id && batchB.id);

    const movedBatchB = await fetch(`${base}/api/stock/products/${prodId}/transfer`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        amount: 2,
        location_id_from: 1,
        location_id_to: 2,
        stock_entry_id: batchB.id,
      }),
    }).then((r) => r.json());
    assert.equal(movedBatchB.transferred, 2);

    const prodEntriesAfterMove = await fetch(`${base}/api/stock/products/${prodId}/entries`, {
      headers,
    }).then((r) => r.json());
    const movedEntry = prodEntriesAfterMove.find(
      (e: any) => Number(e.location_id) === 2 && e.best_before_date === '2027-03-15'
    );
    const remainingBatchB = prodEntriesAfterMove.find((e: any) => Number(e.id) === batchB.id);
    const untouchedBatchA = prodEntriesAfterMove.find((e: any) => Number(e.id) === batchA.id);
    assert.ok(movedEntry && Number(movedEntry.amount) === 2, 'Expected 2 of batchB moved to loc 2');
    assert.ok(remainingBatchB && Number(remainingBatchB.amount) === 1, 'Expected 1 of batchB remaining in loc 1');
    assert.ok(untouchedBatchA && Number(untouchedBatchA.amount) === 2, 'Expected batchA untouched in loc 1');

    // 21. Open Food Facts nutrition persistence on products
    await fetch(`${base}/api/objects/products/${prodId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        off_barcode: '0049000042566',
        calories_kcal: 150,
        calories_basis: 'serving',
        protein_g: 8,
        carbs_g: 12,
        fat_g: 8,
        sugar_g: 11,
        sodium_mg: 120,
        serving_size: '1 cup (240ml)',
        nutriscore_grade: 'b',
      }),
    });
    const prodWithNutrition = await fetch(`${base}/api/objects/products/${prodId}`, { headers }).then((r) =>
      r.json()
    );
    assert.equal(prodWithNutrition.off_barcode, '0049000042566');
    assert.equal(Number(prodWithNutrition.calories_kcal), 150);
    assert.equal(prodWithNutrition.nutriscore_grade, 'b');

    // 22. Adding into a specific existing batch increments that batch instead of creating a new one
    const entriesBeforeAddToBatch = await fetch(`${base}/api/stock/products/${prodId}/entries`, {
      headers,
    }).then((r) => r.json());
    const countBefore = entriesBeforeAddToBatch.length;
    const addToBatchRes = await fetch(`${base}/api/stock/products/${prodId}/add`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ amount: 3, stock_entry_id: batchA.id }),
    }).then((r) => r.json());
    assert.equal(Number(addToBatchRes.id), batchA.id);
    assert.equal(Number(addToBatchRes.amount), 5);
    const entriesAfterAddToBatch = await fetch(`${base}/api/stock/products/${prodId}/entries`, {
      headers,
    }).then((r) => r.json());
    assert.equal(entriesAfterAddToBatch.length, countBefore, 'Should not create a new batch');
    const mergedBatchA = entriesAfterAddToBatch.find((e: any) => Number(e.id) === batchA.id);
    assert.equal(Number(mergedBatchA.amount), 5);

    // 23. Bulk delete selected items (cascades stock & barcodes, logs activity)
    const delProd1 = await fetch(`${base}/api/objects/products`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Temp Delete Item A', location_id: 1, qu_id_purchase: 1, qu_id_stock: 1 }),
    }).then((r) => r.json());
    const delProd2 = await fetch(`${base}/api/objects/products`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Temp Delete Item B', location_id: 1, qu_id_purchase: 1, qu_id_stock: 1 }),
    }).then((r) => r.json());
    await fetch(`${base}/api/stock/products/${delProd1.created_object_id}/add`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ amount: 2 }),
    });
    const bulkDelRes = await fetch(`${base}/api/products/bulk-delete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ product_ids: [delProd1.created_object_id, delProd2.created_object_id] }),
    }).then((r) => r.json());
    assert.equal(bulkDelRes.deleted, 2);
    assert.deepEqual(bulkDelRes.deleted_names, ['Temp Delete Item A', 'Temp Delete Item B']);

    const remainingProds = await fetch(`${base}/api/objects/products`, { headers }).then((r) => r.json());
    assert.ok(!remainingProds.some((p: any) => p.id === delProd1.created_object_id));
    assert.ok(!remainingProds.some((p: any) => p.id === delProd2.created_object_id));
    assert.ok(remainingProds.some((p: any) => p.id === prodId), 'Unselected product must remain');

    const delActivity = await fetch(`${base}/api/activity?limit=5`, { headers }).then((r) => r.json());
    assert.ok(delActivity.some((e: any) => e.transaction_type === 'bulk_delete' && e.product_name === '2 items'));

    // 24. Opened items 14-day countdown + extend +7 days (rinse & repeat)
    const openRes = await fetch(`${base}/api/stock/products/${prodId}/open`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ amount: 1 }),
    }).then((r) => r.json());
    assert.equal(openRes.opened, 1);
    assert.ok(openRes.opened_use_by_date, 'Opening an item must set a 14-day opened_use_by_date');

    const stockAfterOpen = await fetch(`${base}/api/stock`, { headers }).then((r) => r.json());
    const openedItem = stockAfterOpen.find((s: any) => s.product_id === prodId);
    assert.ok(openedItem.amount_opened >= 1);
    assert.equal(openedItem.opened_use_by_date, openRes.opened_use_by_date);

    const ext1 = await fetch(`${base}/api/stock/products/${prodId}/open-extend`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ days: 7 }),
    }).then((r) => r.json());
    assert.ok(ext1.opened_use_by_date > openRes.opened_use_by_date, 'First +7d extend advances deadline');

    const ext2 = await fetch(`${base}/api/stock/products/${prodId}/open-extend`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ days: 7 }),
    }).then((r) => r.json());
    assert.ok(ext2.opened_use_by_date > ext1.opened_use_by_date, 'Second +7d extend advances deadline again');

    // 25. Daily expiring-soon notification job (broadcasts once per day to all household apps)
    const soonDate = new Date();
    soonDate.setDate(soonDate.getDate() + 2);
    const soonIso = `${soonDate.getFullYear()}-${String(soonDate.getMonth() + 1).padStart(2, '0')}-${String(soonDate.getDate()).padStart(2, '0')}`;
    const expProd = await fetch(`${base}/api/objects/products`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Fresh Strawberries', location_id: 1, qu_id_purchase: 1, qu_id_stock: 1 }),
    }).then((r) => r.json());
    await fetch(`${base}/api/stock/products/${expProd.created_object_id}/add`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ amount: 1, best_before_date: soonIso }),
    });

    const firstCheck = await fetch(`${base}/api/notifications/check-expiring`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ due_soon_days: 5 }),
    }).then((r) => r.json());
    assert.equal(firstCheck.ran, true);
    assert.equal(firstCheck.notified, true);
    assert.ok(firstCheck.items.includes('Fresh Strawberries'));
    assert.ok(firstCheck.body.includes('expiring soon'));
    assert.ok(firstCheck.body.includes('lose it') || firstCheck.body.includes('lose them'));

    // Second run on the same day without force must not send a duplicate
    const secondCheck = await fetch(`${base}/api/notifications/check-expiring`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ due_soon_days: 5 }),
    }).then((r) => r.json());
    assert.equal(secondCheck.ran, false);
    assert.equal(secondCheck.notified, false);

    // Both Admin and Sarah receive the broadcast notification
    const adminExpNotifs = await fetch(`${base}/api/notifications?after_id=0`, { headers }).then((r) => r.json());
    const sarahExpNotifs = await fetch(`${base}/api/notifications?after_id=0`, { headers: sarahHeaders }).then((r) =>
      r.json()
    );
    assert.ok(
      adminExpNotifs.notifications.some((n: any) => n.type === 'expiring_soon' && n.body.includes('Fresh Strawberries'))
    );
    assert.ok(
      sarahExpNotifs.notifications.some((n: any) => n.type === 'expiring_soon' && n.body.includes('Fresh Strawberries'))
    );

    console.log('ALL SERVER v1.9.4 TESTS PASSED!');
    console.log('\nSample compact MCP inventory_summary output:\n' + summaryText);
    console.log('\nSample compact MCP search_inventory output:\n' + searchText);
  } finally {
    server.close();
    ctx.db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
