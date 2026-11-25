import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { DbContext } from './db';
import { InventoryService } from './inventoryService';
import { handleMcpJsonRpc } from './mcp';
import {
  getMimeForFile,
  MAX_PHOTO_BYTES,
  sanitizeFileName,
  savePhotoBase64,
  savePhotoBuffer,
} from './photos';
import { renderWebUiHtml } from './webUi';

const ALLOWED_TABLES = new Set([
  'locations',
  'products',
  'product_barcodes',
  'quantity_units',
  'product_groups',
  'shopping_locations',
  'shopping_list',
  'shopping_lists',
  'api_keys',
]);

const TABLE_COLUMNS: Record<string, string[]> = {
  locations: ['name', 'description', 'is_freezer', 'active'],
  quantity_units: ['name', 'name_plural', 'description', 'active'],
  product_groups: ['name', 'description', 'active'],
  shopping_locations: ['name', 'description', 'active'],
  products: [
    'name',
    'description',
    'product_group_id',
    'active',
    'location_id',
    'shopping_location_id',
    'qu_id_purchase',
    'qu_id_stock',
    'qu_factor_purchase_to_stock',
    'min_stock_amount',
    'default_best_before_days',
    'default_best_before_days_after_open',
    'picture_file_name',
    'storage_photo_file_name',
    'due_type',
  ],
  product_barcodes: ['product_id', 'barcode', 'qu_id', 'amount', 'shopping_location_id', 'note'],
  shopping_lists: ['name', 'description'],
  shopping_list: ['product_id', 'note', 'amount', 'shopping_list_id', 'done', 'qu_id'],
  api_keys: ['api_key', 'description'],
};

function sendJson(res: http.ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, GROCY-API-KEY, Authorization, Mcp-Session-Id',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  });
  res.end(body);
}

function sendError(res: http.ServerResponse, status: number, message: string) {
  sendJson(res, status, { error_message: message });
}

function readBodyBuffer(req: http.IncomingMessage, maxBytes = MAX_PHOTO_BYTES + 256 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Request payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  const buf = await readBodyBuffer(req);
  if (buf.length === 0) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new Error('Invalid JSON request body');
  }
}

function extractApiKey(req: http.IncomingMessage, url: URL): string | null {
  const headerKey = req.headers['grocy-api-key'];
  if (typeof headerKey === 'string' && headerKey.trim()) return headerKey.trim();

  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }

  const queryKey = url.searchParams.get('api_key') || url.searchParams.get('GROCY-API-KEY');
  if (queryKey && queryKey.trim()) return queryKey.trim();

  return null;
}

async function extractUploadedPhoto(
  req: http.IncomingMessage,
  photosDir: string
): Promise<{ fileName: string; size: number }> {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();

  if (contentType.includes('application/json')) {
    const json = await readJsonBody(req);
    if (!json.data_base64 || typeof json.data_base64 !== 'string') {
      throw new Error('Missing data_base64 field');
    }
    return savePhotoBase64(photosDir, json.data_base64, json.mime_type);
  }

  const buf = await readBodyBuffer(req);
  return savePhotoBuffer(photosDir, buf, contentType || 'image/jpeg');
}

export function createRequestHandler(ctx: DbContext, service: InventoryService) {
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const method = (req.method || 'GET').toUpperCase();
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, GROCY-API-KEY, Authorization, Mcp-Session-Id',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      });
      res.end();
      return;
    }

    try {
      // Public routes: Web UI & Health check
      if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        const html = renderWebUiHtml();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      if (method === 'GET' && pathname === '/api/health') {
        sendJson(res, 200, { ok: true, service: 'grocygo-server', version: '1.1.0' });
        return;
      }

      // Authenticate all /api/* and /mcp* routes
      const apiKey = extractApiKey(req, url);
      if (!service.validateApiKey(apiKey)) {
        sendError(res, 401, 'Unauthorized: missing or invalid GROCY-API-KEY');
        return;
      }

      // ─── MCP Streamable HTTP Endpoint ─────────────────────────
      if (pathname === '/mcp') {
        if (method === 'POST') {
          const body = await readJsonBody(req);
          const { status, response } = handleMcpJsonRpc(body, service);
          if (response === null) {
            res.writeHead(status, { 'Access-Control-Allow-Origin': '*' });
            res.end();
            return;
          }
          sendJson(res, status, response);
          return;
        }
        if (method === 'GET') {
          sendJson(res, 405, {
            error_message: 'Use POST /mcp with JSON-RPC 2.0 (MCP Streamable HTTP)',
          });
          return;
        }
        if (method === 'DELETE') {
          res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
          res.end();
          return;
        }
      }

      // ─── System Info ──────────────────────────────────────────
      if (method === 'GET' && pathname === '/api/system/info') {
        sendJson(res, 200, {
          grocy_version: {
            Version: 'GrocyGo-Server 1.1.0',
            ReleaseDate: '2026-11-25',
          },
          php_version: `Node ${process.version}`,
          sqlite_version: 'SQLite3 (WAL)',
          os: process.platform,
          features: {
            food_inventory: true,
            shopping_list: true,
            storage_photos: true,
            mcp_endpoint: '/mcp',
          },
        });
        return;
      }

      // ─── Photo Storage API ────────────────────────────────────
      if (method === 'POST' && pathname === '/api/photos/upload') {
        const saved = await extractUploadedPhoto(req, ctx.photosDir);
        sendJson(res, 200, {
          file_name: saved.fileName,
          url: `/api/photos/${saved.fileName}`,
          size: saved.size,
        });
        return;
      }

      const entryPhotoMatch = pathname.match(/^\/api\/photos\/stock-entry\/(\d+)$/);
      if (method === 'POST' && entryPhotoMatch) {
        const entryId = Number(entryPhotoMatch[1]);
        const saved = await extractUploadedPhoto(req, ctx.photosDir);
        const result = service.attachPhotoToStockEntry(entryId, saved.fileName);
        sendJson(res, 200, {
          ...result,
          url: `/api/photos/${saved.fileName}`,
          size: saved.size,
        });
        return;
      }

      const productPhotoMatch = pathname.match(/^\/api\/photos\/product\/(\d+)$/);
      if (method === 'POST' && productPhotoMatch) {
        const productId = Number(productPhotoMatch[1]);
        const saved = await extractUploadedPhoto(req, ctx.photosDir);
        const result = service.attachPhotoToProduct(productId, saved.fileName);
        sendJson(res, 200, {
          ...result,
          url: `/api/photos/${saved.fileName}`,
          size: saved.size,
        });
        return;
      }

      const productStoragePhotoMatch = pathname.match(/^\/api\/photos\/product-storage\/(\d+)$/);
      if (method === 'POST' && productStoragePhotoMatch) {
        const productId = Number(productStoragePhotoMatch[1]);
        const saved = await extractUploadedPhoto(req, ctx.photosDir);
        const result = service.attachStoragePhotoToProduct(productId, saved.fileName);
        sendJson(res, 200, {
          ...result,
          url: `/api/photos/${saved.fileName}`,
          size: saved.size,
        });
        return;
      }

      const getPhotoMatch = pathname.match(/^\/api\/photos\/([^/]+)$/);
      if (getPhotoMatch) {
        const safe = sanitizeFileName(decodeURIComponent(getPhotoMatch[1]));
        if (!safe) {
          sendError(res, 400, 'Invalid photo filename');
          return;
        }
        const fullPath = path.join(ctx.photosDir, safe);
        if (method === 'GET') {
          if (!fs.existsSync(fullPath)) {
            sendError(res, 404, 'Photo not found');
            return;
          }
          const stat = fs.statSync(fullPath);
          res.writeHead(200, {
            'Content-Type': getMimeForFile(safe),
            'Content-Length': stat.size,
            'Cache-Control': 'public, max-age=86400',
            'Access-Control-Allow-Origin': '*',
          });
          fs.createReadStream(fullPath).pipe(res);
          return;
        }
        if (method === 'DELETE') {
          ctx.db
            .prepare('UPDATE stock SET photo_file_name = NULL WHERE photo_file_name = ?')
            .run(safe);
          ctx.db
            .prepare('UPDATE products SET picture_file_name = NULL WHERE picture_file_name = ?')
            .run(safe);
          ctx.db
            .prepare(
              'UPDATE products SET storage_photo_file_name = NULL WHERE storage_photo_file_name = ?'
            )
            .run(safe);
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
          sendJson(res, 200, { deleted: safe });
          return;
        }
      }

      // ─── Stock Endpoints ──────────────────────────────────────
      if (method === 'GET' && pathname === '/api/stock') {
        sendJson(res, 200, service.getStockOverview());
        return;
      }

      if (method === 'GET' && pathname === '/api/stock/volatile') {
        const dueDays = Number(url.searchParams.get('due_soon_days') ?? 5);
        sendJson(
          res,
          200,
          service.getVolatileStock(Number.isFinite(dueDays) ? dueDays : 5)
        );
        return;
      }

      // Shopping list stock helpers
      if (method === 'POST' && pathname === '/api/stock/shoppinglist/add-missing-products') {
        const body = await readJsonBody(req);
        const listId = Number(body.list_id || 1);
        sendJson(res, 200, service.addMissingProductsToShoppingList(listId));
        return;
      }

      if (method === 'POST' && pathname === '/api/stock/shoppinglist/clear') {
        const body = await readJsonBody(req);
        const listId = Number(body.list_id || 1);
        const doneOnly = Boolean(body.done_only);
        sendJson(res, 200, service.clearShoppingList(listId, doneOnly));
        return;
      }

      if (method === 'POST' && pathname === '/api/stock/shoppinglist/purchase-done') {
        const body = await readJsonBody(req);
        const listId = Number(body.list_id || 1);
        sendJson(res, 200, service.purchaseDoneShoppingItems(listId));
        return;
      }

      // Barcode lookup
      const barcodeMatch = pathname.match(/^\/api\/stock\/products\/by-barcode\/(.+)$/);
      if (method === 'GET' && barcodeMatch) {
        const barcode = decodeURIComponent(barcodeMatch[1]);
        const details = service.getProductByBarcode(barcode);
        if (!details) {
          sendError(res, 400, `No product with barcode ${barcode} found`);
          return;
        }
        sendJson(res, 200, details);
        return;
      }

      // Per-product stock endpoints
      const prodStockMatch = pathname.match(
        /^\/api\/stock\/products\/(\d+)(?:\/(entries|locations|add|consume|open|inventory|transfer))?$/
      );
      if (prodStockMatch) {
        const productId = Number(prodStockMatch[1]);
        const sub = prodStockMatch[2];

        if (!sub && method === 'GET') {
          const details = service.getProductDetails(productId);
          if (!details) {
            sendError(res, 404, `Product ${productId} not found`);
            return;
          }
          sendJson(res, 200, details);
          return;
        }

        if (sub === 'entries' && method === 'GET') {
          sendJson(res, 200, service.getProductEntries(productId));
          return;
        }

        if (sub === 'locations' && method === 'GET') {
          sendJson(res, 200, service.getProductLocations(productId));
          return;
        }

        if (sub === 'add' && method === 'POST') {
          const body = await readJsonBody(req);
          const created = service.purchaseProduct(productId, body);
          sendJson(res, 200, created);
          return;
        }

        if (sub === 'consume' && method === 'POST') {
          const body = await readJsonBody(req);
          sendJson(res, 200, service.consumeProduct(productId, body));
          return;
        }

        if (sub === 'open' && method === 'POST') {
          const body = await readJsonBody(req);
          sendJson(res, 200, service.openProduct(productId, body.amount ?? 1));
          return;
        }

        if (sub === 'inventory' && method === 'POST') {
          const body = await readJsonBody(req);
          sendJson(res, 200, service.inventoryProduct(productId, body));
          return;
        }

        if (sub === 'transfer' && method === 'POST') {
          const body = await readJsonBody(req);
          sendJson(res, 200, service.transferProduct(productId, body));
          return;
        }
      }

      // ─── Generic Objects CRUD ─────────────────────────────────
      const objMatch = pathname.match(/^\/api\/objects\/([a-z_]+)(?:\/(\d+))?$/);
      if (objMatch) {
        const table = objMatch[1];
        const idParam = objMatch[2] ? Number(objMatch[2]) : null;

        if (!ALLOWED_TABLES.has(table)) {
          sendError(res, 404, `Unknown object entity: ${table}`);
          return;
        }

        if (method === 'GET' && idParam === null) {
          if (table === 'shopping_list') {
            const listId = url.searchParams.get('list_id');
            sendJson(res, 200, service.getShoppingListItems(listId ? Number(listId) : undefined));
            return;
          }
          const rows = ctx.db.prepare(`SELECT * FROM ${table} ORDER BY id ASC`).all();
          sendJson(res, 200, rows);
          return;
        }

        if (method === 'GET' && idParam !== null) {
          const row = ctx.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(idParam);
          if (!row) {
            sendError(res, 404, `${table} #${idParam} not found`);
            return;
          }
          sendJson(res, 200, row);
          return;
        }

        if (method === 'POST' && idParam === null) {
          const body = await readJsonBody(req);
          if (table === 'api_keys' && !body.api_key) {
            body.api_key = `gg_${crypto.randomBytes(24).toString('base64url')}`;
          }

          const allowed = TABLE_COLUMNS[table] || [];
          const keys = allowed.filter((k) => body[k] !== undefined);
          if (keys.length === 0) {
            sendError(res, 400, 'No valid fields provided');
            return;
          }

          const placeholders = keys.map(() => '?').join(', ');
          const values = keys.map((k) => body[k]);
          const info = ctx.db
            .prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`)
            .run(...values);

          const response: Record<string, unknown> = {
            created_object_id: Number(info.lastInsertRowid),
          };
          if (table === 'api_keys') response.api_key = body.api_key;
          sendJson(res, 200, response);
          return;
        }

        if (method === 'PUT' && idParam !== null) {
          const body = await readJsonBody(req);
          const allowed = TABLE_COLUMNS[table] || [];
          const keys = allowed.filter((k) => body[k] !== undefined);
          if (keys.length === 0) {
            sendError(res, 400, 'No valid fields provided to update');
            return;
          }

          const assignments = keys.map((k) => `${k} = ?`).join(', ');
          const values = keys.map((k) => body[k]);
          const info = ctx.db
            .prepare(`UPDATE ${table} SET ${assignments} WHERE id = ?`)
            .run(...values, idParam);
          if (Number(info.changes) === 0) {
            sendError(res, 404, `${table} #${idParam} not found`);
            return;
          }
          res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
          res.end();
          return;
        }

        if (method === 'DELETE' && idParam !== null) {
          if (table === 'api_keys') {
            const count = (
              ctx.db.prepare('SELECT COUNT(*) AS c FROM api_keys').get() as { c: number }
            ).c;
            if (count <= 1) {
              sendError(res, 400, 'Cannot delete the last remaining API key');
              return;
            }
          }
          const info = ctx.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(idParam);
          if (Number(info.changes) === 0) {
            sendError(res, 404, `${table} #${idParam} not found`);
            return;
          }
          res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
          res.end();
          return;
        }
      }

      sendError(res, 404, `Endpoint not found: ${method} ${pathname}`);
    } catch (err: any) {
      const msg = err?.message || 'Internal server error';
      const isClientErr =
        /UNIQUE constraint|FOREIGN KEY constraint|NOT NULL constraint|not found|Invalid|Missing|must be|greater than|No stock|No unopened/i.test(
          msg
        );
      sendError(res, isClientErr ? 400 : 500, msg);
    }
  };
}
