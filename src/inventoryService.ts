import crypto from 'node:crypto';
import { DbContext } from './db';
import { deletePhotoIfUnreferenced } from './photos';

export const NEVER_EXPIRES = '2999-12-31';

export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export class InventoryService {
  constructor(private readonly ctx: DbContext) {}

  get db() {
    return this.ctx.db;
  }

  isPhotoReferenced(fileName: string): boolean {
    const inStock = this.db
      .prepare('SELECT 1 FROM stock WHERE photo_file_name = ? LIMIT 1')
      .get(fileName);
    if (inStock) return true;
    const inProducts = this.db
      .prepare(
        'SELECT 1 FROM products WHERE picture_file_name = ? OR storage_photo_file_name = ? LIMIT 1'
      )
      .get(fileName, fileName);
    return Boolean(inProducts);
  }

  cleanupPhotoIfUnused(fileName: string | null | undefined): void {
    deletePhotoIfUnreferenced(this.ctx.photosDir, fileName, (name) =>
      this.isPhotoReferenced(name)
    );
  }

  validateApiKey(key: string | null | undefined): boolean {
    if (!key) return false;
    const row = this.db
      .prepare('SELECT id FROM api_keys WHERE api_key = ? LIMIT 1')
      .get(key.trim());
    return Boolean(row);
  }

  getStockOverview(): any[] {
    const rows = this.db
      .prepare(
        `
        SELECT
          p.*,
          SUM(s.amount) AS total_amount,
          SUM(CASE WHEN s.open = 1 THEN s.amount ELSE 0 END) AS opened_amount,
          MIN(COALESCE(NULLIF(s.best_before_date, ''), '2999-12-31')) AS next_due_date,
          (
            SELECT s2.photo_file_name
            FROM stock s2
            WHERE s2.product_id = p.id AND s2.photo_file_name IS NOT NULL AND s2.photo_file_name != ''
            ORDER BY s2.id DESC
            LIMIT 1
          ) AS latest_stock_photo,
          (
            SELECT COUNT(*)
            FROM stock s3
            WHERE s3.product_id = p.id AND s3.photo_file_name IS NOT NULL AND s3.photo_file_name != ''
          ) AS photo_count
        FROM stock s
        INNER JOIN products p ON p.id = s.product_id
        WHERE s.amount > 0
        GROUP BY p.id
        ORDER BY p.name COLLATE NOCASE ASC
      `
      )
      .all() as any[];

    return rows.map((r) => {
      const {
        total_amount,
        opened_amount,
        next_due_date,
        latest_stock_photo,
        photo_count,
        ...product
      } = r;

      return {
        product_id: product.id,
        amount: Number(total_amount || 0),
        amount_aggregated: Number(total_amount || 0),
        amount_opened: Number(opened_amount || 0),
        amount_opened_aggregated: Number(opened_amount || 0),
        best_before_date: next_due_date || NEVER_EXPIRES,
        is_aggregated_amount: 0,
        due_type: product.due_type ?? 1,
        product_photo_file_name: product.picture_file_name || null,
        storage_photo_file_name: latest_stock_photo || product.storage_photo_file_name || null,
        latest_photo_file_name:
          latest_stock_photo || product.storage_photo_file_name || product.picture_file_name || null,
        photo_count: Number(photo_count || 0),
        product,
      };
    });
  }

  getVolatileStock(dueSoonDays = 5) {
    const stock = this.getStockOverview();
    const today = todayIso();
    const soonCutoff = addDaysIso(dueSoonDays);

    const due_products: any[] = [];
    const overdue_products: any[] = [];
    const expired_products: any[] = [];

    for (const item of stock) {
      const bbd: string = item.best_before_date || NEVER_EXPIRES;
      if (bbd === NEVER_EXPIRES) continue;

      if (bbd < today) {
        if (item.due_type === 2) {
          expired_products.push(item);
        } else {
          overdue_products.push(item);
        }
      } else if (bbd <= soonCutoff) {
        due_products.push(item);
      }
    }

    const stockByProduct = new Map<number, number>();
    for (const item of stock) {
      stockByProduct.set(item.product_id, item.amount);
    }

    const products = this.db
      .prepare('SELECT * FROM products WHERE min_stock_amount > 0 AND active = 1')
      .all() as any[];

    const missing_products: any[] = [];
    for (const p of products) {
      const current = stockByProduct.get(p.id) || 0;
      if (current < Number(p.min_stock_amount)) {
        missing_products.push({
          id: p.id,
          name: p.name,
          amount_missing: Math.round((Number(p.min_stock_amount) - current) * 100) / 100,
          is_partly_in_stock: current > 0 ? 1 : 0,
        });
      }
    }

    return {
      due_products,
      overdue_products,
      expired_products,
      missing_products,
    };
  }

  getProductDetails(productId: number): any | null {
    const product = this.db
      .prepare('SELECT * FROM products WHERE id = ?')
      .get(productId) as any;
    if (!product) return null;

    const barcodes = this.db
      .prepare('SELECT * FROM product_barcodes WHERE product_id = ?')
      .all(productId);
    const quStock = this.db
      .prepare('SELECT * FROM quantity_units WHERE id = ?')
      .get(product.qu_id_stock);
    const quPurchase = this.db
      .prepare('SELECT * FROM quantity_units WHERE id = ?')
      .get(product.qu_id_purchase);
    const location = this.db
      .prepare('SELECT * FROM locations WHERE id = ?')
      .get(product.location_id);

    const agg = this.db
      .prepare(
        `
        SELECT
          COALESCE(SUM(amount), 0) AS total_amount,
          COALESCE(SUM(CASE WHEN open = 1 THEN amount ELSE 0 END), 0) AS opened_amount,
          MIN(COALESCE(NULLIF(best_before_date, ''), '2999-12-31')) AS next_due_date,
          (
            SELECT photo_file_name FROM stock
            WHERE product_id = ? AND photo_file_name IS NOT NULL AND photo_file_name != ''
            ORDER BY id DESC LIMIT 1
          ) AS latest_stock_photo
        FROM stock
        WHERE product_id = ? AND amount > 0
      `
      )
      .get(productId, productId) as any;

    const lastPurchased = this.db
      .prepare(
        `SELECT row_created_timestamp FROM stock_log
         WHERE product_id = ? AND transaction_type = 'purchase'
         ORDER BY id DESC LIMIT 1`
      )
      .get(productId) as any;

    const lastUsed = this.db
      .prepare(
        `SELECT row_created_timestamp FROM stock_log
         WHERE product_id = ? AND transaction_type = 'consume'
         ORDER BY id DESC LIMIT 1`
      )
      .get(productId) as any;

    return {
      product,
      product_barcodes: barcodes,
      last_purchased: lastPurchased?.row_created_timestamp || null,
      last_used: lastUsed?.row_created_timestamp || null,
      stock_amount: Number(agg?.total_amount || 0),
      stock_amount_opened: Number(agg?.opened_amount || 0),
      stock_amount_aggregated: Number(agg?.total_amount || 0),
      stock_amount_opened_aggregated: Number(agg?.opened_amount || 0),
      default_quantity_unit_purchase: quPurchase || undefined,
      quantity_unit_stock: quStock || undefined,
      location: location || undefined,
      next_due_date: agg?.total_amount > 0 ? agg?.next_due_date || NEVER_EXPIRES : null,
      product_photo_file_name: product.picture_file_name || null,
      storage_photo_file_name: agg?.latest_stock_photo || product.storage_photo_file_name || null,
      latest_photo_file_name:
        agg?.latest_stock_photo || product.storage_photo_file_name || product.picture_file_name || null,
    };
  }

  getProductByBarcode(barcode: string): any | null {
    const row = this.db
      .prepare('SELECT product_id FROM product_barcodes WHERE barcode = ? LIMIT 1')
      .get(barcode.trim()) as { product_id: number } | undefined;
    if (!row) return null;
    return this.getProductDetails(row.product_id);
  }

  getProductEntries(productId: number): any[] {
    return this.db
      .prepare(
        `
        SELECT s.*, l.name AS location_name, l.is_freezer AS location_is_freezer
        FROM stock s
        LEFT JOIN locations l ON l.id = s.location_id
        WHERE s.product_id = ? AND s.amount > 0
        ORDER BY s.open DESC, COALESCE(NULLIF(s.best_before_date, ''), '2999-12-31') ASC, s.id DESC
      `
      )
      .all(productId);
  }

  getProductLocations(productId: number): any[] {
    return this.db
      .prepare(
        `
        SELECT
          s.product_id,
          s.location_id,
          l.name AS location_name,
          l.is_freezer AS location_is_freezer,
          SUM(s.amount) AS amount
        FROM stock s
        INNER JOIN locations l ON l.id = s.location_id
        WHERE s.product_id = ? AND s.amount > 0
        GROUP BY s.location_id
        ORDER BY l.name COLLATE NOCASE ASC
      `
      )
      .all(productId);
  }

  purchaseProduct(
    productId: number,
    payload: {
      amount: number;
      best_before_date?: string;
      price?: number;
      location_id?: number;
      shopping_location_id?: number;
      note?: string;
      photo_file_name?: string;
    }
  ) {
    const product = this.db
      .prepare('SELECT * FROM products WHERE id = ?')
      .get(productId) as any;
    if (!product) throw new Error(`Product ${productId} not found`);

    const amount = Number(payload.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Amount must be greater than 0');
    }

    const locationId = payload.location_id || product.location_id;
    let bbd = payload.best_before_date?.trim() || '';
    if (!bbd) {
      if (Number(product.default_best_before_days) === -1) {
        bbd = NEVER_EXPIRES;
      } else if (Number(product.default_best_before_days) > 0) {
        bbd = addDaysIso(Number(product.default_best_before_days));
      } else {
        bbd = NEVER_EXPIRES;
      }
    }

    const stockId = crypto.randomBytes(8).toString('hex');
    const photoFileName = payload.photo_file_name?.trim() || null;

    const info = this.db
      .prepare(
        `
        INSERT INTO stock (
          product_id, amount, best_before_date, purchased_date, stock_id,
          price, open, location_id, shopping_location_id, note, photo_file_name
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
      `
      )
      .run(
        productId,
        amount,
        bbd,
        todayIso(),
        stockId,
        payload.price ?? null,
        locationId,
        payload.shopping_location_id ?? product.shopping_location_id ?? null,
        payload.note?.trim() || '',
        photoFileName
      );

    // Keep product's default storage/shelf photo updated with latest shelf snapshot
    if (photoFileName) {
      this.db
        .prepare('UPDATE products SET storage_photo_file_name = ? WHERE id = ?')
        .run(photoFileName, productId);
    }

    this.db
      .prepare(
        `INSERT INTO stock_log (product_id, amount, transaction_type, location_id, note)
         VALUES (?, ?, 'purchase', ?, ?)`
      )
      .run(productId, amount, locationId, payload.note?.trim() || '');

    return {
      id: Number(info.lastInsertRowid),
      stock_id: stockId,
      product_id: productId,
      amount,
      location_id: locationId,
      best_before_date: bbd,
      photo_file_name: photoFileName,
    };
  }

  consumeProduct(
    productId: number,
    payload: {
      amount: number;
      spoiled?: boolean;
      location_id?: number;
      stock_entry_id?: number;
    }
  ) {
    const amountRequested = Number(payload.amount);
    if (!Number.isFinite(amountRequested) || amountRequested <= 0) {
      throw new Error('Consume amount must be greater than 0');
    }

    let entries: any[];
    if (payload.stock_entry_id) {
      entries = this.db
        .prepare('SELECT * FROM stock WHERE id = ? AND product_id = ? AND amount > 0')
        .all(payload.stock_entry_id, productId) as any[];
    } else if (payload.location_id) {
      entries = this.db
        .prepare(
          `SELECT * FROM stock WHERE product_id = ? AND location_id = ? AND amount > 0
           ORDER BY open DESC, COALESCE(NULLIF(best_before_date, ''), '2999-12-31') ASC, id ASC`
        )
        .all(productId, payload.location_id) as any[];
    } else {
      entries = this.db
        .prepare(
          `SELECT * FROM stock WHERE product_id = ? AND amount > 0
           ORDER BY open DESC, COALESCE(NULLIF(best_before_date, ''), '2999-12-31') ASC, id ASC`
        )
        .all(productId) as any[];
    }

    const totalAvailable = entries.reduce((sum, e) => sum + Number(e.amount), 0);
    if (totalAvailable <= 0) {
      throw new Error('No stock available to consume');
    }

    let remaining = Math.min(amountRequested, totalAvailable);
    const consumedTotal = remaining;
    const removedPhotos: string[] = [];

    for (const entry of entries) {
      if (remaining <= 0) break;
      const entryAmt = Number(entry.amount);
      if (entryAmt <= remaining + 1e-9) {
        remaining = Math.max(0, Math.round((remaining - entryAmt) * 1000) / 1000);
        this.db.prepare('DELETE FROM stock WHERE id = ?').run(entry.id);
        if (entry.photo_file_name) removedPhotos.push(entry.photo_file_name);
      } else {
        const nextAmt = Math.round((entryAmt - remaining) * 1000) / 1000;
        remaining = 0;
        this.db.prepare('UPDATE stock SET amount = ? WHERE id = ?').run(nextAmt, entry.id);
      }
    }

    this.db
      .prepare(
        `INSERT INTO stock_log (product_id, amount, transaction_type, location_id, spoiled)
         VALUES (?, ?, 'consume', ?, ?)`
      )
      .run(
        productId,
        -consumedTotal,
        payload.location_id ?? entries[0]?.location_id ?? null,
        payload.spoiled ? 1 : 0
      );

    for (const ph of removedPhotos) {
      this.cleanupPhotoIfUnused(ph);
    }

    return { product_id: productId, consumed: consumedTotal };
  }

  openProduct(productId: number, amount = 1) {
    const qty = Number(amount);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Amount must be greater than 0');

    const unopened = this.db
      .prepare(
        `SELECT * FROM stock WHERE product_id = ? AND open = 0 AND amount > 0
         ORDER BY COALESCE(NULLIF(best_before_date, ''), '2999-12-31') ASC, id ASC`
      )
      .all(productId) as any[];

    if (unopened.length === 0) {
      throw new Error('No unopened stock available');
    }

    const today = todayIso();
    let remaining = qty;

    for (const entry of unopened) {
      if (remaining <= 0) break;
      const entryAmt = Number(entry.amount);
      if (entryAmt <= remaining + 1e-9) {
        remaining = Math.max(0, Math.round((remaining - entryAmt) * 1000) / 1000);
        this.db
          .prepare('UPDATE stock SET open = 1, opened_date = ? WHERE id = ?')
          .run(today, entry.id);
      } else {
        const leftover = Math.round((entryAmt - remaining) * 1000) / 1000;
        this.db.prepare('UPDATE stock SET amount = ? WHERE id = ?').run(leftover, entry.id);
        this.db
          .prepare(
            `INSERT INTO stock (
              product_id, amount, best_before_date, purchased_date, stock_id,
              price, open, opened_date, location_id, shopping_location_id, note, photo_file_name
            ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
          )
          .run(
            productId,
            remaining,
            entry.best_before_date,
            entry.purchased_date,
            crypto.randomBytes(8).toString('hex'),
            entry.price,
            today,
            entry.location_id,
            entry.shopping_location_id,
            entry.note,
            entry.photo_file_name
          );
        remaining = 0;
      }
    }

    return { product_id: productId, opened: qty - remaining };
  }

  inventoryProduct(
    productId: number,
    payload: {
      new_amount: number;
      best_before_date?: string;
      location_id?: number;
      price?: number;
      note?: string;
      photo_file_name?: string;
    }
  ) {
    const newAmount = Number(payload.new_amount);
    if (!Number.isFinite(newAmount) || newAmount < 0) {
      throw new Error('new_amount must be a non-negative number');
    }

    const current = (
      this.db
        .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM stock WHERE product_id = ?')
        .get(productId) as { total: number }
    ).total;

    const delta = Math.round((newAmount - current) * 1000) / 1000;
    if (delta > 0) {
      return this.purchaseProduct(productId, {
        amount: delta,
        best_before_date: payload.best_before_date,
        location_id: payload.location_id,
        price: payload.price,
        note: payload.note || 'Inventory correction',
        photo_file_name: payload.photo_file_name,
      });
    } else if (delta < 0) {
      return this.consumeProduct(productId, {
        amount: Math.abs(delta),
        location_id: payload.location_id,
      });
    }
    return { product_id: productId, unchanged: true, amount: current };
  }

  transferProduct(
    productId: number,
    payload: {
      amount: number;
      location_id_from: number;
      location_id_to: number;
      photo_file_name?: string;
    }
  ) {
    const qty = Number(payload.amount);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Transfer amount must be > 0');
    if (payload.location_id_from === payload.location_id_to) {
      throw new Error('Source and destination locations must be different');
    }

    const entries = this.db
      .prepare(
        `SELECT * FROM stock WHERE product_id = ? AND location_id = ? AND amount > 0
         ORDER BY open DESC, COALESCE(NULLIF(best_before_date, ''), '2999-12-31') ASC, id ASC`
      )
      .all(productId, payload.location_id_from) as any[];

    const available = entries.reduce((sum, e) => sum + Number(e.amount), 0);
    if (available <= 0) {
      throw new Error('No stock in source location to transfer');
    }

    let remaining = Math.min(qty, available);
    const moved = remaining;

    for (const entry of entries) {
      if (remaining <= 0) break;
      const entryAmt = Number(entry.amount);
      const nextPhoto = payload.photo_file_name || entry.photo_file_name;

      if (entryAmt <= remaining + 1e-9) {
        remaining = Math.max(0, Math.round((remaining - entryAmt) * 1000) / 1000);
        this.db
          .prepare('UPDATE stock SET location_id = ?, photo_file_name = ? WHERE id = ?')
          .run(payload.location_id_to, nextPhoto, entry.id);
      } else {
        const stay = Math.round((entryAmt - remaining) * 1000) / 1000;
        this.db.prepare('UPDATE stock SET amount = ? WHERE id = ?').run(stay, entry.id);
        this.db
          .prepare(
            `INSERT INTO stock (
              product_id, amount, best_before_date, purchased_date, stock_id,
              price, open, opened_date, location_id, shopping_location_id, note, photo_file_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            productId,
            remaining,
            entry.best_before_date,
            entry.purchased_date,
            crypto.randomBytes(8).toString('hex'),
            entry.price,
            entry.open,
            entry.opened_date,
            payload.location_id_to,
            entry.shopping_location_id,
            entry.note,
            nextPhoto
          );
        remaining = 0;
      }
    }

    this.db
      .prepare(
        `INSERT INTO stock_log (product_id, amount, transaction_type, location_id, note)
         VALUES (?, ?, 'transfer', ?, ?)`
      )
      .run(
        productId,
        moved,
        payload.location_id_to,
        `From location #${payload.location_id_from} to #${payload.location_id_to}`
      );

    return {
      product_id: productId,
      transferred: moved,
      location_id_from: payload.location_id_from,
      location_id_to: payload.location_id_to,
    };
  }

  attachPhotoToStockEntry(entryId: number, fileName: string) {
    const existing = this.db
      .prepare('SELECT id, product_id, photo_file_name FROM stock WHERE id = ?')
      .get(entryId) as { id: number; product_id: number; photo_file_name: string | null } | undefined;
    if (!existing) throw new Error(`Stock entry ${entryId} not found`);

    this.db
      .prepare('UPDATE stock SET photo_file_name = ? WHERE id = ?')
      .run(fileName, entryId);

    // Update product's default shelf photo too
    this.db
      .prepare('UPDATE products SET storage_photo_file_name = ? WHERE id = ?')
      .run(fileName, existing.product_id);

    if (existing.photo_file_name && existing.photo_file_name !== fileName) {
      this.cleanupPhotoIfUnused(existing.photo_file_name);
    }
    return { entry_id: entryId, product_id: existing.product_id, file_name: fileName };
  }

  attachPhotoToProduct(productId: number, fileName: string) {
    const existing = this.db
      .prepare('SELECT id, picture_file_name FROM products WHERE id = ?')
      .get(productId) as { id: number; picture_file_name: string | null } | undefined;
    if (!existing) throw new Error(`Product ${productId} not found`);

    this.db
      .prepare('UPDATE products SET picture_file_name = ? WHERE id = ?')
      .run(fileName, productId);

    if (existing.picture_file_name && existing.picture_file_name !== fileName) {
      this.cleanupPhotoIfUnused(existing.picture_file_name);
    }
    return { product_id: productId, file_name: fileName };
  }

  attachStoragePhotoToProduct(productId: number, fileName: string) {
    const existing = this.db
      .prepare('SELECT id, storage_photo_file_name FROM products WHERE id = ?')
      .get(productId) as { id: number; storage_photo_file_name: string | null } | undefined;
    if (!existing) throw new Error(`Product ${productId} not found`);

    this.db
      .prepare('UPDATE products SET storage_photo_file_name = ? WHERE id = ?')
      .run(fileName, productId);

    if (existing.storage_photo_file_name && existing.storage_photo_file_name !== fileName) {
      this.cleanupPhotoIfUnused(existing.storage_photo_file_name);
    }
    return { product_id: productId, file_name: fileName };
  }

  getShoppingListItems(listId?: number): any[] {
    const sql = listId
      ? `SELECT sl.*, p.name AS product_name, p.picture_file_name AS product_photo,
                qu.name AS qu_name, qu.name_plural AS qu_name_plural
         FROM shopping_list sl
         LEFT JOIN products p ON p.id = sl.product_id
         LEFT JOIN quantity_units qu ON qu.id = COALESCE(sl.qu_id, p.qu_id_purchase)
         WHERE sl.shopping_list_id = ?
         ORDER BY sl.done ASC, sl.id DESC`
      : `SELECT sl.*, p.name AS product_name, p.picture_file_name AS product_photo,
                qu.name AS qu_name, qu.name_plural AS qu_name_plural
         FROM shopping_list sl
         LEFT JOIN products p ON p.id = sl.product_id
         LEFT JOIN quantity_units qu ON qu.id = COALESCE(sl.qu_id, p.qu_id_purchase)
         ORDER BY sl.done ASC, sl.id DESC`;

    return listId ? this.db.prepare(sql).all(listId) : this.db.prepare(sql).all();
  }

  addMissingProductsToShoppingList(listId = 1): { added: number } {
    const volatile = this.getVolatileStock(5);
    let added = 0;

    for (const missing of volatile.missing_products) {
      const existing = this.db
        .prepare(
          'SELECT id, amount FROM shopping_list WHERE shopping_list_id = ? AND product_id = ? AND done = 0'
        )
        .get(listId, missing.id) as { id: number; amount: number } | undefined;

      if (existing) {
        if (existing.amount < missing.amount_missing) {
          this.db
            .prepare('UPDATE shopping_list SET amount = ? WHERE id = ?')
            .run(missing.amount_missing, existing.id);
        }
      } else {
        this.db
          .prepare(
            'INSERT INTO shopping_list (product_id, amount, shopping_list_id, done) VALUES (?, ?, ?, 0)'
          )
          .run(missing.id, missing.amount_missing, listId);
        added++;
      }
    }

    return { added };
  }

  clearShoppingList(listId = 1, doneOnly = false): { deleted: number } {
    const info = doneOnly
      ? this.db
          .prepare('DELETE FROM shopping_list WHERE shopping_list_id = ? AND done = 1')
          .run(listId)
      : this.db
          .prepare('DELETE FROM shopping_list WHERE shopping_list_id = ?')
          .run(listId);
    return { deleted: Number(info.changes || 0) };
  }

  purchaseDoneShoppingItems(listId = 1): { purchased: number } {
    const doneItems = this.db
      .prepare(
        'SELECT * FROM shopping_list WHERE shopping_list_id = ? AND done = 1'
      )
      .all(listId) as any[];

    let purchased = 0;
    for (const item of doneItems) {
      if (item.product_id) {
        this.purchaseProduct(item.product_id, {
          amount: Number(item.amount || 1),
          note: item.note || 'From shopping list',
        });
        purchased++;
      }
      this.db.prepare('DELETE FROM shopping_list WHERE id = ?').run(item.id);
    }

    return { purchased };
  }
}
