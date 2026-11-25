import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DbContext } from './db';
import { NEVER_EXPIRES, todayIso } from './inventoryService';
import { savePhotoBuffer } from './photos';

export interface GrocyImportReport {
  locations: number;
  quantity_units: number;
  product_groups: number;
  shopping_locations: number;
  products: number;
  barcodes: number;
  stock_entries: number;
  shopping_list: number;
  photos: number;
  warnings: string[];
}

export interface GrocyImportDataset {
  locations: any[];
  quantity_units: any[];
  product_groups: any[];
  shopping_locations: any[];
  products: any[];
  product_barcodes: any[];
  stock: any[];
  shopping_list: any[];
}

export interface GrocyImportOptions {
  clearExisting?: boolean;
  importPhotos?: boolean;
  photoFetcher?: (pictureFileName: string) => Promise<{ buffer: Buffer; mimeType: string } | null>;
}

function toNum(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function normalizeUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) {
    const isLocal = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/i.test(u);
    u = `${isLocal ? 'http' : 'https'}://${u}`;
  }
  if (u.toLowerCase().endsWith('/api')) {
    u = u.slice(0, -4);
  }
  return u;
}

async function fetchGrocyJson(baseUrl: string, apiKey: string, endpoint: string): Promise<any[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`${baseUrl}/api${endpoint}`, {
      headers: {
        'GROCY-API-KEY': apiKey,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error('Authentication failed against original Grocy server. Check API key.');
      }
      throw new Error(`Original Grocy returned HTTP ${res.status} for ${endpoint}`);
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } finally {
    clearTimeout(timer);
  }
}

export async function importFromGrocyApi(
  ctx: DbContext,
  params: {
    serverUrl: string;
    apiKey: string;
    clearExisting?: boolean;
    importPhotos?: boolean;
  }
): Promise<GrocyImportReport> {
  const baseUrl = normalizeUrl(params.serverUrl);
  const apiKey = params.apiKey.trim();
  if (!baseUrl || !apiKey) {
    throw new Error('Both serverUrl and apiKey are required');
  }

  const [
    locations,
    quantity_units,
    product_groups,
    shopping_locations,
    products,
    product_barcodes,
    stock,
    shopping_list,
  ] = await Promise.all([
    fetchGrocyJson(baseUrl, apiKey, '/objects/locations'),
    fetchGrocyJson(baseUrl, apiKey, '/objects/quantity_units'),
    fetchGrocyJson(baseUrl, apiKey, '/objects/product_groups').catch(() => []),
    fetchGrocyJson(baseUrl, apiKey, '/objects/shopping_locations').catch(() => []),
    fetchGrocyJson(baseUrl, apiKey, '/objects/products'),
    fetchGrocyJson(baseUrl, apiKey, '/objects/product_barcodes').catch(() => []),
    fetchGrocyJson(baseUrl, apiKey, '/objects/stock').catch(() => []),
    fetchGrocyJson(baseUrl, apiKey, '/objects/shopping_list').catch(() => []),
  ]);

  const photoFetcher =
    params.importPhotos === false
      ? undefined
      : async (pictureFileName: string) => {
          const b64Name = Buffer.from(pictureFileName, 'utf8').toString('base64');
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 12000);
          try {
            const res = await fetch(
              `${baseUrl}/api/files/productpictures/${encodeURIComponent(b64Name)}`,
              {
                headers: { 'GROCY-API-KEY': apiKey },
                signal: controller.signal,
              }
            );
            if (!res.ok) return null;
            const arr = await res.arrayBuffer();
            const buffer = Buffer.from(arr);
            if (buffer.length === 0) return null;
            const mimeType = res.headers.get('content-type') || 'image/jpeg';
            return { buffer, mimeType };
          } catch {
            return null;
          } finally {
            clearTimeout(timer);
          }
        };

  return importDataset(
    ctx,
    {
      locations,
      quantity_units,
      product_groups,
      shopping_locations,
      products,
      product_barcodes,
      stock,
      shopping_list,
    },
    {
      clearExisting: params.clearExisting,
      importPhotos: params.importPhotos,
      photoFetcher,
    }
  );
}

export async function importFromGrocySqliteBuffer(
  ctx: DbContext,
  sqliteBuffer: Buffer,
  options: { clearExisting?: boolean } = {}
): Promise<GrocyImportReport> {
  const header = sqliteBuffer.subarray(0, 16).toString('utf8');
  if (!header.startsWith('SQLite format 3')) {
    throw new Error('Uploaded file is not a valid SQLite 3 database (grocy.db)');
  }

  const tmpFile = path.join(
    os.tmpdir(),
    `grocy-import-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`
  );
  fs.writeFileSync(tmpFile, sqliteBuffer);

  let sourceDb: DatabaseSync | null = null;
  try {
    sourceDb = new DatabaseSync(tmpFile, { readOnly: true });
    const tables = new Set(
      (
        sourceDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
          name: string;
        }>
      ).map((t) => t.name)
    );

    const readTable = (name: string): any[] => {
      if (!tables.has(name)) return [];
      return sourceDb!.prepare(`SELECT * FROM ${name}`).all() as any[];
    };

    const dataset: GrocyImportDataset = {
      locations: readTable('locations'),
      quantity_units: readTable('quantity_units'),
      product_groups: readTable('product_groups'),
      shopping_locations: readTable('shopping_locations'),
      products: readTable('products'),
      product_barcodes: readTable('product_barcodes'),
      stock: readTable('stock'),
      shopping_list: readTable('shopping_list'),
    };

    return await importDataset(ctx, dataset, { clearExisting: options.clearExisting });
  } finally {
    try {
      sourceDb?.close();
    } catch {
      // ignore
    }
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  }
}

export async function importDataset(
  ctx: DbContext,
  data: GrocyImportDataset,
  options: GrocyImportOptions = {}
): Promise<GrocyImportReport> {
  const db = ctx.db;
  const report: GrocyImportReport = {
    locations: 0,
    quantity_units: 0,
    product_groups: 0,
    shopping_locations: 0,
    products: 0,
    barcodes: 0,
    stock_entries: 0,
    shopping_list: 0,
    photos: 0,
    warnings: [],
  };

  if (options.clearExisting) {
    db.exec(`
      DELETE FROM shopping_list;
      DELETE FROM stock;
      DELETE FROM stock_log;
      DELETE FROM product_barcodes;
      DELETE FROM products;
      DELETE FROM product_groups;
      DELETE FROM shopping_locations;
      DELETE FROM locations;
      DELETE FROM quantity_units;
    `);
  }

  // 1. Locations
  const locMap = new Map<number, number>();
  for (const loc of data.locations) {
    const name = String(loc.name || '').trim();
    if (!name) continue;
    const oldId = toNum(loc.id);
    const existing = db
      .prepare('SELECT id FROM locations WHERE LOWER(name) = LOWER(?) LIMIT 1')
      .get(name) as { id: number } | undefined;
    if (existing) {
      if (oldId) locMap.set(oldId, existing.id);
    } else {
      const info = db
        .prepare('INSERT INTO locations (name, description, is_freezer, active) VALUES (?, ?, ?, ?)')
        .run(name, String(loc.description || ''), toNum(loc.is_freezer) ? 1 : 0, toNum(loc.active, 1) ? 1 : 0);
      const newId = Number(info.lastInsertRowid);
      if (oldId) locMap.set(oldId, newId);
      report.locations++;
    }
  }

  // Ensure at least one fallback location exists
  let fallbackLocId = (db.prepare('SELECT id FROM locations ORDER BY id ASC LIMIT 1').get() as { id: number } | undefined)?.id;
  if (!fallbackLocId) {
    fallbackLocId = Number(
      db.prepare("INSERT INTO locations (name, description, is_freezer) VALUES ('Pantry', '', 0)").run().lastInsertRowid
    );
  }

  // 2. Quantity Units
  const quMap = new Map<number, number>();
  for (const qu of data.quantity_units) {
    const name = String(qu.name || '').trim();
    if (!name) continue;
    const oldId = toNum(qu.id);
    const existing = db
      .prepare('SELECT id FROM quantity_units WHERE LOWER(name) = LOWER(?) LIMIT 1')
      .get(name) as { id: number } | undefined;
    if (existing) {
      if (oldId) quMap.set(oldId, existing.id);
    } else {
      const info = db
        .prepare('INSERT INTO quantity_units (name, name_plural, description, active) VALUES (?, ?, ?, ?)')
        .run(
          name,
          String(qu.name_plural || name),
          String(qu.description || ''),
          toNum(qu.active, 1) ? 1 : 0
        );
      const newId = Number(info.lastInsertRowid);
      if (oldId) quMap.set(oldId, newId);
      report.quantity_units++;
    }
  }

  let fallbackQuId = (db.prepare('SELECT id FROM quantity_units ORDER BY id ASC LIMIT 1').get() as { id: number } | undefined)?.id;
  if (!fallbackQuId) {
    fallbackQuId = Number(
      db.prepare("INSERT INTO quantity_units (name, name_plural) VALUES ('Piece', 'Pieces')").run().lastInsertRowid
    );
  }

  // 3. Product Groups
  const groupMap = new Map<number, number>();
  for (const g of data.product_groups) {
    const name = String(g.name || '').trim();
    if (!name) continue;
    const oldId = toNum(g.id);
    const existing = db
      .prepare('SELECT id FROM product_groups WHERE LOWER(name) = LOWER(?) LIMIT 1')
      .get(name) as { id: number } | undefined;
    if (existing) {
      if (oldId) groupMap.set(oldId, existing.id);
    } else {
      const info = db
        .prepare('INSERT INTO product_groups (name, description, active) VALUES (?, ?, ?)')
        .run(name, String(g.description || ''), toNum(g.active, 1) ? 1 : 0);
      const newId = Number(info.lastInsertRowid);
      if (oldId) groupMap.set(oldId, newId);
      report.product_groups++;
    }
  }

  // 4. Shopping Locations (Stores)
  const shopMap = new Map<number, number>();
  for (const s of data.shopping_locations) {
    const name = String(s.name || '').trim();
    if (!name) continue;
    const oldId = toNum(s.id);
    const existing = db
      .prepare('SELECT id FROM shopping_locations WHERE LOWER(name) = LOWER(?) LIMIT 1')
      .get(name) as { id: number } | undefined;
    if (existing) {
      if (oldId) shopMap.set(oldId, existing.id);
    } else {
      const info = db
        .prepare('INSERT INTO shopping_locations (name, description, active) VALUES (?, ?, ?)')
        .run(name, String(s.description || ''), toNum(s.active, 1) ? 1 : 0);
      const newId = Number(info.lastInsertRowid);
      if (oldId) shopMap.set(oldId, newId);
      report.shopping_locations++;
    }
  }

  // 5. Products (with optional product picture download from original Grocy)
  const prodMap = new Map<number, number>();
  for (const p of data.products) {
    const name = String(p.name || '').trim();
    if (!name) continue;
    const oldId = toNum(p.id);
    const existing = db
      .prepare('SELECT id, picture_file_name FROM products WHERE LOWER(name) = LOWER(?) LIMIT 1')
      .get(name) as { id: number; picture_file_name: string | null } | undefined;

    let newProdId: number;
    if (existing) {
      newProdId = existing.id;
      if (oldId) prodMap.set(oldId, newProdId);
    } else {
      const locId = locMap.get(toNum(p.location_id)) ?? fallbackLocId;
      const quPurchase = quMap.get(toNum(p.qu_id_purchase)) ?? fallbackQuId;
      const quStock = quMap.get(toNum(p.qu_id_stock)) ?? quPurchase;
      const groupId = p.product_group_id ? groupMap.get(toNum(p.product_group_id)) ?? null : null;
      const shopId = p.shopping_location_id
        ? shopMap.get(toNum(p.shopping_location_id)) ?? null
        : null;

      const info = db
        .prepare(
          `INSERT INTO products (
            name, description, product_group_id, active, location_id, shopping_location_id,
            qu_id_purchase, qu_id_stock, qu_factor_purchase_to_stock, min_stock_amount,
            default_best_before_days, default_best_before_days_after_open, due_type
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          name,
          String(p.description || ''),
          groupId,
          toNum(p.active, 1) ? 1 : 0,
          locId,
          shopId,
          quPurchase,
          quStock,
          toNum(p.qu_factor_purchase_to_stock, 1) || 1,
          toNum(p.min_stock_amount, 0),
          toNum(p.default_best_before_days, 0),
          toNum(p.default_best_before_days_after_open, 0),
          toNum(p.due_type, 1) || 1
        );
      newProdId = Number(info.lastInsertRowid);
      if (oldId) prodMap.set(oldId, newProdId);
      report.products++;
    }

    // Import product image if available and not already set
    if (
      p.picture_file_name &&
      options.photoFetcher &&
      options.importPhotos !== false &&
      (!existing || !existing.picture_file_name)
    ) {
      const fetched = await options.photoFetcher(String(p.picture_file_name));
      if (fetched) {
        try {
          const saved = savePhotoBuffer(ctx.photosDir, fetched.buffer, fetched.mimeType);
          db.prepare('UPDATE products SET picture_file_name = ? WHERE id = ?').run(
            saved.fileName,
            newProdId
          );
          report.photos++;
        } catch {
          report.warnings.push(`Could not save photo for "${name}"`);
        }
      }
    }
  }

  // 6. Product Barcodes
  for (const b of data.product_barcodes) {
    const code = String(b.barcode || '').trim();
    const mappedProdId = prodMap.get(toNum(b.product_id));
    if (!code || !mappedProdId) continue;
    const exists = db
      .prepare('SELECT id FROM product_barcodes WHERE barcode = ? LIMIT 1')
      .get(code);
    if (exists) continue;
    db.prepare(
      `INSERT INTO product_barcodes (product_id, barcode, qu_id, amount, shopping_location_id, note)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      mappedProdId,
      code,
      b.qu_id ? quMap.get(toNum(b.qu_id)) ?? null : null,
      b.amount != null && b.amount !== '' ? toNum(b.amount) : null,
      b.shopping_location_id ? shopMap.get(toNum(b.shopping_location_id)) ?? null : null,
      String(b.note || '')
    );
    report.barcodes++;
  }

  // 7. Stock Entries (active batches)
  for (const s of data.stock) {
    const mappedProdId = prodMap.get(toNum(s.product_id));
    const amount = toNum(s.amount, 0);
    if (!mappedProdId || amount <= 0) continue;

    const stockId = String(s.stock_id || '').trim() || crypto.randomBytes(8).toString('hex');
    const existingBatch = db
      .prepare('SELECT id FROM stock WHERE product_id = ? AND stock_id = ? LIMIT 1')
      .get(mappedProdId, stockId);
    if (existingBatch) continue;

    const prodRow = db
      .prepare('SELECT location_id FROM products WHERE id = ?')
      .get(mappedProdId) as { location_id: number } | undefined;
    const locId = locMap.get(toNum(s.location_id)) ?? prodRow?.location_id ?? fallbackLocId;
    const shopId = s.shopping_location_id
      ? shopMap.get(toNum(s.shopping_location_id)) ?? null
      : null;

    db.prepare(
      `INSERT INTO stock (
        product_id, amount, best_before_date, purchased_date, stock_id,
        price, open, opened_date, location_id, shopping_location_id, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      mappedProdId,
      amount,
      String(s.best_before_date || '').trim() || NEVER_EXPIRES,
      String(s.purchased_date || '').trim() || todayIso(),
      stockId,
      s.price != null && s.price !== '' ? toNum(s.price) : null,
      toNum(s.open, 0) ? 1 : 0,
      s.opened_date ? String(s.opened_date) : null,
      locId,
      shopId,
      String(s.note || '')
    );
    report.stock_entries++;
  }

  // 8. Shopping List
  for (const item of data.shopping_list) {
    const mappedProdId = item.product_id ? prodMap.get(toNum(item.product_id)) ?? null : null;
    const note = String(item.note || '').trim();
    if (!mappedProdId && !note) continue;
    const amount = toNum(item.amount, 1) || 1;
    const done = toNum(item.done, 0) ? 1 : 0;
    const quId = item.qu_id ? quMap.get(toNum(item.qu_id)) ?? null : null;

    const duplicate = mappedProdId
      ? db
          .prepare('SELECT id FROM shopping_list WHERE product_id = ? AND done = ? LIMIT 1')
          .get(mappedProdId, done)
      : db
          .prepare('SELECT id FROM shopping_list WHERE product_id IS NULL AND note = ? AND done = ? LIMIT 1')
          .get(note, done);
    if (duplicate) continue;

    db.prepare(
      `INSERT INTO shopping_list (product_id, note, amount, shopping_list_id, done, qu_id)
       VALUES (?, ?, ?, 1, ?, ?)`
    ).run(mappedProdId, note, amount, done, quId);
    report.shopping_list++;
  }

  return report;
}
