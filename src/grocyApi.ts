import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import QRCode from 'qrcode';
import { generateApiKey } from './auth';
import {
  createDatabaseBackup,
  getBackupsDir,
  listDatabaseBackups,
  sanitizeBackupName,
} from './backups';
import { renderCode128Svg } from './barcode';
import { DbContext } from './db';
import { importFromGrocyApi, importFromGrocySqliteBuffer } from './grocyImport';
import { InventoryService } from './inventoryService';
import { handleMcpJsonRpc } from './mcp';
import {
  deleteThumbnail,
  getMimeForFile,
  getOrCreateThumbnailPath,
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
  shopping_list: [
    'product_id',
    'note',
    'amount',
    'shopping_list_id',
    'done',
    'qu_id',
    'added_by_user_id',
    'completed_by_user_id',
    'completed_at',
  ],
  api_keys: ['api_key', 'description', 'user_id'],
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

function readBodyBuffer(
  req: http.IncomingMessage,
  maxBytes = MAX_PHOTO_BYTES + 256 * 1024
): Promise<Buffer> {
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
): Promise<{ fileName: string; size: number; optimized: boolean }> {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();

  if (contentType.includes('application/json')) {
    const json = await readJsonBody(req);
    if (!json.data_base64 || typeof json.data_base64 !== 'string') {
      throw new Error('Missing data_base64 field');
    }
    return await savePhotoBase64(photosDir, json.data_base64, json.mime_type);
  }

  const buf = await readBodyBuffer(req);
  return await savePhotoBuffer(photosDir, buf, contentType || 'image/jpeg');
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
      // Public routes: Web UI, Health check, and Username/Password Login
      if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        const html = renderWebUiHtml();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      if (method === 'GET' && pathname === '/favicon.png') {
        const iconPath = path.resolve(__dirname, '..', 'unraid', 'icon.png');
        if (fs.existsSync(iconPath)) {
          const stat = fs.statSync(iconPath);
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': stat.size,
            'Cache-Control': 'public, max-age=86400',
          });
          fs.createReadStream(iconPath).pipe(res);
          return;
        }
      }

      if (method === 'GET' && pathname === '/api/health') {
        sendJson(res, 200, { ok: true, service: 'grocygo-server', version: '1.7.0' });
        return;
      }

      if (method === 'POST' && pathname === '/api/auth/login') {
        const body = await readJsonBody(req);
        try {
          const result = service.loginWithPassword(
            String(body.username || ''),
            String(body.password || ''),
            body.device_name ? String(body.device_name) : undefined
          );
          sendJson(res, 200, result);
        } catch (err: any) {
          sendError(res, 401, err?.message || 'Invalid credentials');
        }
        return;
      }

      // Authenticate all other /api/* and /mcp* routes
      const apiKey = extractApiKey(req, url);
      const currentUser = service.authenticateApiKey(apiKey);
      if (!currentUser) {
        sendError(res, 401, 'Unauthorized: missing or invalid GROCY-API-KEY');
        return;
      }

      // ─── Auth Profile & Password ──────────────────────────────
      if (method === 'GET' && pathname === '/api/auth/me') {
        sendJson(res, 200, currentUser);
        return;
      }

      if (method === 'POST' && pathname === '/api/auth/change-password') {
        const body = await readJsonBody(req);
        service.changeOwnPassword(
          currentUser.id,
          String(body.current_password || ''),
          String(body.new_password || '')
        );
        sendJson(res, 200, { ok: true });
        return;
      }

      // ─── Household Users Management ───────────────────────────
      if (method === 'GET' && pathname === '/api/users') {
        if (currentUser.role === 'admin') {
          sendJson(res, 200, service.listUsers());
        } else {
          // Non-admins get basic household member list without API keys
          const basic = service.listUsers().map((u) => ({
            id: u.id,
            username: u.username,
            display_name: u.display_name,
            role: u.role,
            active: u.active,
          }));
          sendJson(res, 200, basic);
        }
        return;
      }

      if (method === 'POST' && pathname === '/api/users') {
        if (currentUser.role !== 'admin') {
          sendError(res, 403, 'Admin permission required to add users');
          return;
        }
        const body = await readJsonBody(req);
        const created = service.createUser(body);
        sendJson(res, 200, created);
        return;
      }

      const userIdMatch = pathname.match(/^\/api\/users\/(\d+)$/);
      if (userIdMatch) {
        if (currentUser.role !== 'admin') {
          sendError(res, 403, 'Admin permission required to manage users');
          return;
        }
        const targetId = Number(userIdMatch[1]);
        if (method === 'PUT') {
          const body = await readJsonBody(req);
          service.updateUser(targetId, body);
          res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
          res.end();
          return;
        }
        if (method === 'DELETE') {
          service.deleteUser(targetId, currentUser.id);
          res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
          res.end();
          return;
        }
      }

      // ─── Activity Feed (Who did what & when) ──────────────────
      if (method === 'GET' && pathname === '/api/activity') {
        const limit = Number(url.searchParams.get('limit') || 50);
        const productId = url.searchParams.get('product_id')
          ? Number(url.searchParams.get('product_id'))
          : undefined;
        const userId = url.searchParams.get('user_id')
          ? Number(url.searchParams.get('user_id'))
          : undefined;
        sendJson(res, 200, service.getActivity({ limit, productId, userId }));
        return;
      }

      // ─── Shopping List Notifications (other household users) ──
      if (method === 'GET' && pathname === '/api/notifications') {
        const afterId = Number(url.searchParams.get('after_id') || 0);
        const limit = Number(url.searchParams.get('limit') || 30);
        sendJson(
          res,
          200,
          service.getNotificationsForUser(
            currentUser.id,
            Number.isFinite(afterId) ? afterId : 0,
            Number.isFinite(limit) ? limit : 30
          )
        );
        return;
      }

      // ─── MCP Permission Settings (Admin toggleable anytime) ───
      if (pathname === '/api/mcp/settings') {
        if (method === 'GET') {
          sendJson(res, 200, service.getMcpSettings());
          return;
        }
        if (method === 'PUT') {
          if (currentUser.role !== 'admin') {
            sendError(res, 403, 'Admin permission required to update MCP settings');
            return;
          }
          const body = await readJsonBody(req);
          const updated = service.updateMcpSettings({
            read_enabled: typeof body.read_enabled === 'boolean' ? body.read_enabled : undefined,
            write_enabled: typeof body.write_enabled === 'boolean' ? body.write_enabled : undefined,
            delete_enabled:
              typeof body.delete_enabled === 'boolean' ? body.delete_enabled : undefined,
          });
          sendJson(res, 200, updated);
          return;
        }
      }

      // ─── MCP Streamable HTTP Endpoint ─────────────────────────
      if (pathname === '/mcp') {
        if (method === 'POST') {
          const body = await readJsonBody(req);
          const { status, response } = handleMcpJsonRpc(body, service, currentUser.id);
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
        const mcpPerms = service.getMcpSettings();
        sendJson(res, 200, {
          grocy_version: {
            Version: 'GrocyGo-Server 1.7.0',
            ReleaseDate: '2026-11-25',
          },
          php_version: `Node ${process.version}`,
          sqlite_version: 'SQLite3 (WAL)',
          os: process.platform,
          current_user: currentUser,
          features: {
            food_inventory: true,
            shopping_list: true,
            storage_photos: true,
            photo_thumbnails: true,
            labels: true,
            grocy_import: true,
            qr_codes: true,
            multi_user: true,
            activity_log: true,
            mcp_endpoint: '/mcp',
            mcp_read_enabled: mcpPerms.read_enabled,
            mcp_write_enabled: mcpPerms.write_enabled,
            mcp_delete_enabled: mcpPerms.delete_enabled,
          },
        });
        return;
      }

      // ─── QR Code SVG Generator (Offline, Grocy Mobile Format) ─
      if (method === 'GET' && pathname === '/api/qr') {
        const text = url.searchParams.get('text') || '';
        if (!text.trim() || text.length > 1024) {
          sendError(res, 400, 'Missing or overly long text query parameter');
          return;
        }
        const svg = await QRCode.toString(text, {
          type: 'svg',
          margin: url.searchParams.get('label') === '1' ? 1 : 2,
          errorCorrectionLevel: 'M',
          color: {
            dark: url.searchParams.get('label') === '1' ? '#000000' : '#1E2420',
            light: url.searchParams.get('label') === '1' ? '#FFFFFF' : '#FCFBF8',
          },
        });
        res.writeHead(200, {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(svg);
        return;
      }

      // ─── Code 128B Barcode SVG Generator (for 1"x2" Labels) ───
      if (method === 'GET' && pathname === '/api/barcode') {
        const text = url.searchParams.get('text') || '';
        const showText = url.searchParams.get('show_text') !== '0';
        const svg = renderCode128Svg(text, { showText });
        res.writeHead(200, {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(svg);
        return;
      }

      // ─── Import from Original Grocy (Live API or SQLite DB) ───
      if (method === 'POST' && pathname === '/api/import/grocy-api') {
        if (currentUser.role !== 'admin') {
          sendError(res, 403, 'Admin permission required to import data');
          return;
        }
        const body = await readJsonBody(req);
        const report = await importFromGrocyApi(ctx, {
          serverUrl: String(body.server_url || body.serverUrl || ''),
          apiKey: String(body.api_key || body.apiKey || ''),
          clearExisting: Boolean(body.clear_existing),
          importPhotos: body.import_photos !== false,
        });
        sendJson(res, 200, report);
        return;
      }

      if (method === 'POST' && pathname === '/api/import/grocy-db') {
        if (currentUser.role !== 'admin') {
          sendError(res, 403, 'Admin permission required to import data');
          return;
        }
        const clearExisting = url.searchParams.get('clear_existing') === '1';
        const dbBuf = await readBodyBuffer(req, 60 * 1024 * 1024);
        const report = await importFromGrocySqliteBuffer(ctx, dbBuf, { clearExisting });
        sendJson(res, 200, report);
        return;
      }

      // ─── Automatic & On-Demand SQLite Backups (Admin) ─────────
      if (method === 'GET' && pathname === '/api/backups') {
        if (currentUser.role !== 'admin') {
          sendError(res, 403, 'Admin permission required to view backups');
          return;
        }
        sendJson(res, 200, listDatabaseBackups(ctx.dataDir));
        return;
      }

      if (method === 'POST' && pathname === '/api/backups') {
        if (currentUser.role !== 'admin') {
          sendError(res, 403, 'Admin permission required to create backups');
          return;
        }
        const created = createDatabaseBackup(ctx, { manual: true });
        sendJson(res, 200, created);
        return;
      }

      const backupDownloadMatch = pathname.match(/^\/api\/backups\/([^/]+)$/);
      if (method === 'GET' && backupDownloadMatch) {
        if (currentUser.role !== 'admin') {
          sendError(res, 403, 'Admin permission required to download backups');
          return;
        }
        const safeName = sanitizeBackupName(decodeURIComponent(backupDownloadMatch[1]));
        if (!safeName) {
          sendError(res, 400, 'Invalid backup filename');
          return;
        }
        const fullPath = path.join(getBackupsDir(ctx.dataDir), safeName);
        if (!fs.existsSync(fullPath)) {
          sendError(res, 404, 'Backup not found');
          return;
        }
        const stat = fs.statSync(fullPath);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${safeName}"`,
          'Content-Length': stat.size,
          'Access-Control-Allow-Origin': '*',
        });
        fs.createReadStream(fullPath).pipe(res);
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
        const result = service.attachPhotoToStockEntry(entryId, saved.fileName, currentUser.id);
        sendJson(res, 200, {
          ...result,
          url: `/api/photos/${saved.fileName}`,
          size: saved.size,
        });
        return;
      }

      const productPhotoMatch = pathname.match(/^\/api\/photos\/product\/(\d+)$/);
      if (productPhotoMatch) {
        const productId = Number(productPhotoMatch[1]);
        if (method === 'POST') {
          const saved = await extractUploadedPhoto(req, ctx.photosDir);
          const result = service.attachPhotoToProduct(productId, saved.fileName, currentUser.id);
          sendJson(res, 200, {
            ...result,
            url: `/api/photos/${saved.fileName}`,
            size: saved.size,
          });
          return;
        }
        if (method === 'DELETE') {
          sendJson(res, 200, service.removePhotoFromProduct(productId, currentUser.id));
          return;
        }
      }

      const productStoragePhotoMatch = pathname.match(/^\/api\/photos\/product-storage\/(\d+)$/);
      if (productStoragePhotoMatch) {
        const productId = Number(productStoragePhotoMatch[1]);
        if (method === 'POST') {
          const saved = await extractUploadedPhoto(req, ctx.photosDir);
          const result = service.attachStoragePhotoToProduct(
            productId,
            saved.fileName,
            currentUser.id
          );
          sendJson(res, 200, {
            ...result,
            url: `/api/photos/${saved.fileName}`,
            size: saved.size,
          });
          return;
        }
        if (method === 'DELETE') {
          sendJson(res, 200, service.removeStoragePhotoFromProduct(productId, currentUser.id));
          return;
        }
      }

      // ─── Bulk Group Assign & Full Inventory Item Edit ─────────
      if (method === 'POST' && pathname === '/api/products/bulk-group') {
        const body = await readJsonBody(req);
        const ids = Array.isArray(body.product_ids) ? body.product_ids : [];
        const groupId =
          body.product_group_id === null ||
          body.product_group_id === '' ||
          body.product_group_id === undefined
            ? null
            : Number(body.product_group_id);
        sendJson(res, 200, service.bulkAssignProductGroup(ids, groupId, currentUser.id));
        return;
      }

      const editItemMatch = pathname.match(/^\/api\/inventory\/item\/(\d+)$/);
      if (method === 'PUT' && editItemMatch) {
        const productId = Number(editItemMatch[1]);
        const body = await readJsonBody(req);
        sendJson(res, 200, service.editInventoryItem(productId, body, currentUser.id));
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
          const wantsThumb = url.searchParams.get('thumb') === '1';
          const servePath = wantsThumb
            ? (await getOrCreateThumbnailPath(ctx.photosDir, safe)) || fullPath
            : fullPath;
          const stat = fs.statSync(servePath);
          const etag = `"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
          if (req.headers['if-none-match'] === etag) {
            res.writeHead(304, {
              ETag: etag,
              'Cache-Control': 'public, max-age=31536000, immutable',
              'Access-Control-Allow-Origin': '*',
            });
            res.end();
            return;
          }
          res.writeHead(200, {
            'Content-Type': getMimeForFile(servePath),
            'Content-Length': stat.size,
            ETag: etag,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Access-Control-Allow-Origin': '*',
          });
          fs.createReadStream(servePath).pipe(res);
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
          deleteThumbnail(ctx.photosDir, safe);
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

      if (method === 'POST' && pathname === '/api/stock/shoppinglist/add-missing-products') {
        const body = await readJsonBody(req);
        const listId = Number(body.list_id || 1);
        sendJson(res, 200, service.addMissingProductsToShoppingList(listId, currentUser.id));
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
        sendJson(res, 200, service.purchaseDoneShoppingItems(listId, currentUser.id));
        return;
      }

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
          sendJson(res, 200, service.purchaseProduct(productId, body, currentUser.id));
          return;
        }

        if (sub === 'consume' && method === 'POST') {
          const body = await readJsonBody(req);
          sendJson(res, 200, service.consumeProduct(productId, body, currentUser.id));
          return;
        }

        if (sub === 'open' && method === 'POST') {
          const body = await readJsonBody(req);
          sendJson(res, 200, service.openProduct(productId, body.amount ?? 1, currentUser.id));
          return;
        }

        if (sub === 'inventory' && method === 'POST') {
          const body = await readJsonBody(req);
          sendJson(res, 200, service.inventoryProduct(productId, body, currentUser.id));
          return;
        }

        if (sub === 'transfer' && method === 'POST') {
          const body = await readJsonBody(req);
          sendJson(res, 200, service.transferProduct(productId, body, currentUser.id));
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
          if (table === 'api_keys') {
            const rows =
              currentUser.role === 'admin'
                ? ctx.db
                    .prepare(
                      `SELECT k.*, u.username, u.display_name AS user_display_name
                       FROM api_keys k LEFT JOIN users u ON u.id = k.user_id ORDER BY k.id ASC`
                    )
                    .all()
                : ctx.db
                    .prepare(
                      `SELECT k.*, u.username, u.display_name AS user_display_name
                       FROM api_keys k LEFT JOIN users u ON u.id = k.user_id
                       WHERE k.user_id = ? ORDER BY k.id ASC`
                    )
                    .all(currentUser.id);
            sendJson(res, 200, rows);
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
          if (table === 'api_keys') {
            if (!body.api_key) body.api_key = generateApiKey();
            body.user_id =
              currentUser.role === 'admin' && body.user_id
                ? Number(body.user_id)
                : currentUser.id;
          }
          if (table === 'shopping_list') {
            body.added_by_user_id = currentUser.id;
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

          if (table === 'shopping_list') {
            const prod = body.product_id
              ? (ctx.db
                  .prepare('SELECT name FROM products WHERE id = ?')
                  .get(Number(body.product_id)) as { name: string } | undefined)
              : undefined;
            const itemName = prod?.name || String(body.note || 'Item');
            service.logActivity({
              productId: body.product_id ? Number(body.product_id) : null,
              itemLabel: itemName,
              amount: Number(body.amount || 1),
              transactionType: 'shopping_add',
              note: prod && body.note ? String(body.note) : '',
              userId: currentUser.id,
            });
            service.recordShoppingListNotification(currentUser.id, itemName);
          } else if (table === 'products') {
            service.logActivity({
              productId: Number(info.lastInsertRowid),
              itemLabel: String(body.name || 'Item'),
              amount: 0,
              transactionType: 'product_create',
              locationId: body.location_id ? Number(body.location_id) : null,
              userId: currentUser.id,
            });
          } else if (table === 'locations') {
            service.logActivity({
              itemLabel: String(body.name || 'Location'),
              amount: 0,
              transactionType: 'location_create',
              userId: currentUser.id,
            });
          } else if (table === 'product_groups') {
            service.logActivity({
              itemLabel: String(body.name || 'Group'),
              amount: 0,
              transactionType: 'group_create',
              userId: currentUser.id,
            });
          }

          const response: Record<string, unknown> = {
            created_object_id: Number(info.lastInsertRowid),
          };
          if (table === 'api_keys') response.api_key = body.api_key;
          sendJson(res, 200, response);
          return;
        }

        if (method === 'PUT' && idParam !== null) {
          const body = await readJsonBody(req);

          if (table === 'shopping_list' && body.done !== undefined) {
            const isDone = Boolean(body.done);
            body.completed_by_user_id = isDone ? currentUser.id : null;
            body.completed_at = isDone ? new Date().toISOString() : null;
          }

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

          if (table === 'shopping_list' && body.done) {
            const item = ctx.db
              .prepare(
                `SELECT sl.product_id, sl.amount, sl.note, p.name AS product_name
                 FROM shopping_list sl LEFT JOIN products p ON p.id = sl.product_id WHERE sl.id = ?`
              )
              .get(idParam) as any;
            if (item) {
              service.logActivity({
                productId: item.product_id || null,
                itemLabel: item.product_name || item.note || 'Item',
                amount: Number(item.amount || 1),
                transactionType: 'shopping_done',
                userId: currentUser.id,
              });
            }
          } else if (table === 'products') {
            service.logActivity({
              productId: idParam,
              itemLabel: String(body.name || `Item #${idParam}`),
              amount: 0,
              transactionType: 'product_edit',
              userId: currentUser.id,
            });
          } else if (table === 'locations') {
            service.logActivity({
              itemLabel: String(body.name || `Location #${idParam}`),
              amount: 0,
              transactionType: 'location_edit',
              userId: currentUser.id,
            });
          } else if (table === 'product_groups') {
            service.logActivity({
              itemLabel: String(body.name || `Group #${idParam}`),
              amount: 0,
              transactionType: 'group_edit',
              userId: currentUser.id,
            });
          }

          res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
          res.end();
          return;
        }

        if (method === 'DELETE' && idParam !== null) {
          if (table === 'api_keys') {
            const targetKey = ctx.db
              .prepare('SELECT user_id FROM api_keys WHERE id = ?')
              .get(idParam) as { user_id: number } | undefined;
            if (!targetKey) {
              sendError(res, 404, 'API key not found');
              return;
            }
            if (currentUser.role !== 'admin' && targetKey.user_id !== currentUser.id) {
              sendError(res, 403, 'Cannot delete another user’s API key');
              return;
            }
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
        /UNIQUE constraint|FOREIGN KEY constraint|NOT NULL constraint|not found|Invalid|Missing|must be|greater than|No stock|No unopened|Cannot delete|Cannot demote|incorrect|at least/i.test(
          msg
        );
      sendError(res, isClientErr ? 400 : 500, msg);
    }
  };
}
