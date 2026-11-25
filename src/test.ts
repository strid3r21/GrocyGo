import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { initDatabase } from './db';
import { createRequestHandler } from './grocyApi';
import { InventoryService } from './inventoryService';

async function runTests() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grocygo-server-test-'));
  process.env.INITIAL_API_KEY = 'test_secret_key_123';

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
    assert.equal(toolsList.result.tools.length, 5);

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

    console.log('ALL SERVER + PHOTO + SHOPPING LIST + MCP TESTS PASSED!');
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
