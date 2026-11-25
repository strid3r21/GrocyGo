import crypto from 'node:crypto';
import { AuthUser, generateApiKey, hashPassword, verifyPassword } from './auth';
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

  // ─── Auth & Users ─────────────────────────────────────────────
  authenticateApiKey(key: string | null | undefined): AuthUser | null {
    if (!key) return null;
    const row = this.db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.role, u.active
         FROM api_keys k
         INNER JOIN users u ON u.id = k.user_id
         WHERE k.api_key = ? AND u.active = 1
         LIMIT 1`
      )
      .get(key.trim()) as AuthUser | undefined;
    return row || null;
  }

  loginWithPassword(
    username: string,
    password: string,
    deviceName?: string
  ): { user: AuthUser; api_key: string } {
    const cleanUser = username.trim();
    if (!cleanUser || !password) {
      throw new Error('Username and password are required');
    }
    const row = this.db
      .prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1')
      .get(cleanUser) as any;

    if (!row || !row.active || !verifyPassword(password, row.password_hash)) {
      throw new Error('Invalid username or password');
    }

    // Reuse user's primary API key if they have one, or create one
    let keyRow = this.db
      .prepare('SELECT api_key FROM api_keys WHERE user_id = ? ORDER BY id ASC LIMIT 1')
      .get(row.id) as { api_key: string } | undefined;

    if (!keyRow) {
      const newKey = generateApiKey();
      this.db
        .prepare('INSERT INTO api_keys (api_key, description, user_id) VALUES (?, ?, ?)')
        .run(newKey, deviceName?.trim() || `${row.display_name} Login`, row.id);
      keyRow = { api_key: newKey };
    }

    return {
      user: {
        id: row.id,
        username: row.username,
        display_name: row.display_name,
        role: row.role,
        active: row.active,
      },
      api_key: keyRow.api_key,
    };
  }

  listUsers(): any[] {
    return this.db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.role, u.active, u.created_at,
                (SELECT api_key FROM api_keys k WHERE k.user_id = u.id ORDER BY k.id ASC LIMIT 1) AS primary_api_key
         FROM users u
         ORDER BY u.id ASC`
      )
      .all();
  }

  createUser(payload: {
    username: string;
    display_name?: string;
    password: string;
    role?: string;
  }) {
    const username = payload.username?.trim();
    const displayName = (payload.display_name || username || '').trim();
    const password = payload.password || '';
    const role = payload.role === 'admin' ? 'admin' : 'member';

    if (!username || username.length < 2) {
      throw new Error('Username must be at least 2 characters');
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
      throw new Error('Username may only contain letters, numbers, dots, underscores, and hyphens');
    }
    if (password.length < 4) {
      throw new Error('Password must be at least 4 characters');
    }

    const info = this.db
      .prepare(
        'INSERT INTO users (username, display_name, password_hash, role, active) VALUES (?, ?, ?, ?, 1)'
      )
      .run(username, displayName, hashPassword(password), role);
    const userId = Number(info.lastInsertRowid);

    // Create a starter personal API key for QR onboarding
    const personalKey = generateApiKey();
    this.db
      .prepare('INSERT INTO api_keys (api_key, description, user_id) VALUES (?, ?, ?)')
      .run(personalKey, `${displayName} Personal Key`, userId);

    return {
      id: userId,
      username,
      display_name: displayName,
      role,
      active: 1,
      api_key: personalKey,
    };
  }

  updateUser(
    id: number,
    payload: { display_name?: string; password?: string; role?: string; active?: number | boolean }
  ) {
    const existing = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    if (!existing) throw new Error(`User #${id} not found`);

    const nextRole =
      payload.role === 'admin' || payload.role === 'member' ? payload.role : existing.role;
    const nextActive =
      payload.active !== undefined ? (payload.active ? 1 : 0) : existing.active;

    if (existing.role === 'admin' && (nextRole !== 'admin' || nextActive === 0)) {
      const otherAdmins = (
        this.db
          .prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1 AND id != ?")
          .get(id) as { c: number }
      ).c;
      if (otherAdmins === 0) {
        throw new Error('Cannot demote or disable the last active admin');
      }
    }

    const nextName = payload.display_name?.trim() || existing.display_name;
    const nextHash =
      payload.password && payload.password.length >= 4
        ? hashPassword(payload.password)
        : existing.password_hash;

    this.db
      .prepare(
        'UPDATE users SET display_name = ?, password_hash = ?, role = ?, active = ? WHERE id = ?'
      )
      .run(nextName, nextHash, nextRole, nextActive, id);
  }

  changeOwnPassword(userId: number, currentPassword: string, newPassword: string) {
    const existing = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
    if (!existing) throw new Error('User not found');
    if (!verifyPassword(currentPassword, existing.password_hash)) {
      throw new Error('Current password is incorrect');
    }
    if (!newPassword || newPassword.length < 4) {
      throw new Error('New password must be at least 4 characters');
    }
    this.db
      .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(hashPassword(newPassword), userId);
  }

  deleteUser(id: number, actingUserId: number) {
    if (id === actingUserId) {
      throw new Error('Cannot delete your own currently signed-in account');
    }
    const existing = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    if (!existing) throw new Error(`User #${id} not found`);
    if (existing.role === 'admin') {
      const otherAdmins = (
        this.db
          .prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1 AND id != ?")
          .get(id) as { c: number }
      ).c;
      if (otherAdmins === 0) throw new Error('Cannot delete the last active admin');
    }
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  logActivity(params: {
    productId?: number | null;
    itemLabel?: string;
    amount?: number;
    transactionType: string;
    locationId?: number | null;
    spoiled?: boolean;
    note?: string;
    userId?: number | null;
  }) {
    this.db
      .prepare(
        `INSERT INTO stock_log (
          product_id, item_label, amount, transaction_type, location_id, spoiled, note, user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.productId ?? null,
        params.itemLabel || '',
        params.amount ?? 0,
        params.transactionType,
        params.locationId ?? null,
        params.spoiled ? 1 : 0,
        params.note || '',
        params.userId ?? null
      );
  }

  getActivity(options: { limit?: number; productId?: number; userId?: number } = {}): any[] {
    const limit = Math.min(200, Math.max(1, options.limit || 50));
    const where: string[] = [];
    const args: any[] = [];
    if (options.productId) {
      where.push('sl.product_id = ?');
      args.push(options.productId);
    }
    if (options.userId) {
      where.push('sl.user_id = ?');
      args.push(options.userId);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    args.push(limit);

    return this.db
      .prepare(
        `SELECT
          sl.id,
          sl.product_id,
          COALESCE(p.name, NULLIF(sl.item_label, ''), 'Item') AS product_name,
          sl.amount,
          sl.transaction_type,
          sl.location_id,
          l.name AS location_name,
          sl.spoiled,
          sl.note,
          sl.user_id,
          u.username AS username,
          COALESCE(u.display_name, u.username, 'System') AS user_display_name,
          qu.name AS qu_name,
          qu.name_plural AS qu_name_plural,
          sl.row_created_timestamp AS timestamp
        FROM stock_log sl
        LEFT JOIN products p ON p.id = sl.product_id
        LEFT JOIN locations l ON l.id = sl.location_id
        LEFT JOIN users u ON u.id = sl.user_id
        LEFT JOIN quantity_units qu ON qu.id = p.qu_id_stock
        ${whereSql}
        ORDER BY sl.id DESC
        LIMIT ?`
      )
      .all(...args);
  }

  // ─── Stock & Inventory ────────────────────────────────────────
  getStockOverview(): any[] {
    const rows = this.db
      .prepare(
        `
        SELECT
          p.*,
          SUM(s.amount) AS total_amount,
          SUM(CASE WHEN s.open = 1 THEN s.amount ELSE 0 END) AS opened_amount,
          MIN(COALESCE(NULLIF(s.best_before_date, ''), '2999-12-31')) AS next_due_date,
          MAX(s.row_created_timestamp) AS last_added_at,
          (
            SELECT u.display_name
            FROM stock s4
            LEFT JOIN users u ON u.id = s4.added_by_user_id
            WHERE s4.product_id = p.id
            ORDER BY s4.id DESC
            LIMIT 1
          ) AS last_added_by,
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
        last_added_at,
        last_added_by,
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
        last_added_at: last_added_at || product.row_created_timestamp || null,
        last_added_by: last_added_by || null,
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
        SELECT s.*, l.name AS location_name, l.is_freezer AS location_is_freezer,
               u.display_name AS added_by_name
        FROM stock s
        LEFT JOIN locations l ON l.id = s.location_id
        LEFT JOIN users u ON u.id = s.added_by_user_id
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
    },
    userId?: number | null
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
          price, open, location_id, shopping_location_id, note, photo_file_name, added_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
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
        photoFileName,
        userId ?? null
      );

    if (photoFileName) {
      this.db
        .prepare('UPDATE products SET storage_photo_file_name = ? WHERE id = ?')
        .run(photoFileName, productId);
    }

    this.logActivity({
      productId,
      itemLabel: product.name,
      amount,
      transactionType: 'purchase',
      locationId,
      note: payload.note?.trim() || '',
      userId,
    });

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
    },
    userId?: number | null
  ) {
    const product = this.db.prepare('SELECT name FROM products WHERE id = ?').get(productId) as
      | { name: string }
      | undefined;
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

    this.logActivity({
      productId,
      itemLabel: product?.name || '',
      amount: -consumedTotal,
      transactionType: payload.spoiled ? 'spoiled' : 'consume',
      locationId: payload.location_id ?? entries[0]?.location_id ?? null,
      spoiled: Boolean(payload.spoiled),
      userId,
    });

    for (const ph of removedPhotos) {
      this.cleanupPhotoIfUnused(ph);
    }

    return { product_id: productId, consumed: consumedTotal };
  }

  openProduct(productId: number, amount = 1, userId?: number | null) {
    const product = this.db.prepare('SELECT name FROM products WHERE id = ?').get(productId) as
      | { name: string }
      | undefined;
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
              price, open, opened_date, location_id, shopping_location_id, note, photo_file_name, added_by_user_id
            ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`
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
            entry.photo_file_name,
            entry.added_by_user_id
          );
        remaining = 0;
      }
    }

    const opened = qty - remaining;
    this.logActivity({
      productId,
      itemLabel: product?.name || '',
      amount: opened,
      transactionType: 'open',
      locationId: unopened[0]?.location_id ?? null,
      userId,
    });

    return { product_id: productId, opened };
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
    },
    userId?: number | null
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
      return this.purchaseProduct(
        productId,
        {
          amount: delta,
          best_before_date: payload.best_before_date,
          location_id: payload.location_id,
          price: payload.price,
          note: payload.note || 'Inventory correction',
          photo_file_name: payload.photo_file_name,
        },
        userId
      );
    } else if (delta < 0) {
      return this.consumeProduct(
        productId,
        {
          amount: Math.abs(delta),
          location_id: payload.location_id,
        },
        userId
      );
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
    },
    userId?: number | null
  ) {
    const product = this.db.prepare('SELECT name FROM products WHERE id = ?').get(productId) as
      | { name: string }
      | undefined;
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
              price, open, opened_date, location_id, shopping_location_id, note, photo_file_name, added_by_user_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
            nextPhoto,
            userId ?? entry.added_by_user_id
          );
        remaining = 0;
      }
    }

    const fromLoc = this.db
      .prepare('SELECT name FROM locations WHERE id = ?')
      .get(payload.location_id_from) as { name: string } | undefined;
    const toLoc = this.db
      .prepare('SELECT name FROM locations WHERE id = ?')
      .get(payload.location_id_to) as { name: string } | undefined;

    this.logActivity({
      productId,
      itemLabel: product?.name || '',
      amount: moved,
      transactionType: 'transfer',
      locationId: payload.location_id_to,
      note: `${fromLoc?.name || `#${payload.location_id_from}`} → ${toLoc?.name || `#${payload.location_id_to}`}`,
      userId,
    });

    return {
      product_id: productId,
      transferred: moved,
      location_id_from: payload.location_id_from,
      location_id_to: payload.location_id_to,
    };
  }

  attachPhotoToStockEntry(entryId: number, fileName: string, userId?: number | null) {
    const existing = this.db
      .prepare('SELECT id, product_id, location_id, photo_file_name FROM stock WHERE id = ?')
      .get(entryId) as
      | { id: number; product_id: number; location_id: number; photo_file_name: string | null }
      | undefined;
    if (!existing) throw new Error(`Stock entry ${entryId} not found`);

    const prod = this.db
      .prepare('SELECT name FROM products WHERE id = ?')
      .get(existing.product_id) as { name: string } | undefined;

    this.db.prepare('UPDATE stock SET photo_file_name = ? WHERE id = ?').run(fileName, entryId);
    this.db
      .prepare('UPDATE products SET storage_photo_file_name = ? WHERE id = ?')
      .run(fileName, existing.product_id);

    this.logActivity({
      productId: existing.product_id,
      itemLabel: prod?.name || `Product #${existing.product_id}`,
      amount: 0,
      transactionType: 'photo_shelf',
      locationId: existing.location_id,
      userId,
    });

    if (existing.photo_file_name && existing.photo_file_name !== fileName) {
      this.cleanupPhotoIfUnused(existing.photo_file_name);
    }
    return { entry_id: entryId, product_id: existing.product_id, file_name: fileName };
  }

  attachPhotoToProduct(productId: number, fileName: string, userId?: number | null) {
    const existing = this.db
      .prepare('SELECT id, name, location_id, picture_file_name FROM products WHERE id = ?')
      .get(productId) as
      | { id: number; name: string; location_id: number; picture_file_name: string | null }
      | undefined;
    if (!existing) throw new Error(`Product ${productId} not found`);

    this.db
      .prepare('UPDATE products SET picture_file_name = ? WHERE id = ?')
      .run(fileName, productId);

    this.logActivity({
      productId,
      itemLabel: existing.name,
      amount: 0,
      transactionType: 'photo_product',
      locationId: existing.location_id,
      userId,
    });

    if (existing.picture_file_name && existing.picture_file_name !== fileName) {
      this.cleanupPhotoIfUnused(existing.picture_file_name);
    }
    return { product_id: productId, file_name: fileName };
  }

  attachStoragePhotoToProduct(productId: number, fileName: string, userId?: number | null) {
    const existing = this.db
      .prepare('SELECT id, name, location_id, storage_photo_file_name FROM products WHERE id = ?')
      .get(productId) as
      | { id: number; name: string; location_id: number; storage_photo_file_name: string | null }
      | undefined;
    if (!existing) throw new Error(`Product ${productId} not found`);

    this.db
      .prepare('UPDATE products SET storage_photo_file_name = ? WHERE id = ?')
      .run(fileName, productId);

    this.logActivity({
      productId,
      itemLabel: existing.name,
      amount: 0,
      transactionType: 'photo_shelf',
      locationId: existing.location_id,
      userId,
    });

    if (existing.storage_photo_file_name && existing.storage_photo_file_name !== fileName) {
      this.cleanupPhotoIfUnused(existing.storage_photo_file_name);
    }
    return { product_id: productId, file_name: fileName };
  }

  removePhotoFromProduct(productId: number, userId?: number | null) {
    const existing = this.db
      .prepare('SELECT id, name, location_id, picture_file_name FROM products WHERE id = ?')
      .get(productId) as
      | { id: number; name: string; location_id: number; picture_file_name: string | null }
      | undefined;
    if (!existing) throw new Error(`Product ${productId} not found`);

    const prev = existing.picture_file_name;
    this.db.prepare('UPDATE products SET picture_file_name = NULL WHERE id = ?').run(productId);

    if (prev) {
      this.cleanupPhotoIfUnused(prev);
      this.logActivity({
        productId,
        itemLabel: existing.name,
        amount: 0,
        transactionType: 'photo_product_remove',
        locationId: existing.location_id,
        userId,
      });
    }

    return { product_id: productId, removed: prev };
  }

  removeStoragePhotoFromProduct(productId: number, userId?: number | null) {
    const existing = this.db
      .prepare('SELECT id, name, location_id, storage_photo_file_name FROM products WHERE id = ?')
      .get(productId) as
      | { id: number; name: string; location_id: number; storage_photo_file_name: string | null }
      | undefined;
    if (!existing) throw new Error(`Product ${productId} not found`);

    const stockPhotos = (
      this.db
        .prepare(
          "SELECT DISTINCT photo_file_name FROM stock WHERE product_id = ? AND photo_file_name IS NOT NULL AND photo_file_name != ''"
        )
        .all(productId) as Array<{ photo_file_name: string }>
    ).map((r) => r.photo_file_name);

    const filesToCheck = new Set<string>(stockPhotos);
    if (existing.storage_photo_file_name) filesToCheck.add(existing.storage_photo_file_name);

    this.db
      .prepare('UPDATE products SET storage_photo_file_name = NULL WHERE id = ?')
      .run(productId);
    this.db.prepare('UPDATE stock SET photo_file_name = NULL WHERE product_id = ?').run(productId);

    for (const f of filesToCheck) {
      this.cleanupPhotoIfUnused(f);
    }

    if (filesToCheck.size > 0) {
      this.logActivity({
        productId,
        itemLabel: existing.name,
        amount: 0,
        transactionType: 'photo_shelf_remove',
        locationId: existing.location_id,
        userId,
      });
    }

    return { product_id: productId, removed: Array.from(filesToCheck) };
  }

  getMcpSettings(): { read_enabled: boolean; write_enabled: boolean; delete_enabled: boolean } {
    const rows = this.db
      .prepare(
        "SELECT key, value FROM server_settings WHERE key IN ('mcp_read_enabled', 'mcp_write_enabled', 'mcp_delete_enabled')"
      )
      .all() as Array<{ key: string; value: string }>;
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      read_enabled: map.get('mcp_read_enabled') !== '0',
      write_enabled: map.get('mcp_write_enabled') === '1',
      delete_enabled: map.get('mcp_delete_enabled') === '1',
    };
  }

  updateMcpSettings(payload: {
    read_enabled?: boolean;
    write_enabled?: boolean;
    delete_enabled?: boolean;
  }): { read_enabled: boolean; write_enabled: boolean; delete_enabled: boolean } {
    const upsert = this.db.prepare(
      `INSERT INTO server_settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    );
    if (typeof payload.read_enabled === 'boolean') {
      upsert.run('mcp_read_enabled', payload.read_enabled ? '1' : '0');
    }
    if (typeof payload.write_enabled === 'boolean') {
      upsert.run('mcp_write_enabled', payload.write_enabled ? '1' : '0');
    }
    if (typeof payload.delete_enabled === 'boolean') {
      upsert.run('mcp_delete_enabled', payload.delete_enabled ? '1' : '0');
    }
    return this.getMcpSettings();
  }

  createProductGroup(
    name: string,
    description = '',
    userId?: number | null
  ): { id: number; name: string; description: string } {
    const cleanName = name.trim();
    if (!cleanName) throw new Error('Group name is required');
    const cleanDesc = (description || '').trim();
    const existing = this.db
      .prepare('SELECT id, name FROM product_groups WHERE LOWER(name) = LOWER(?) LIMIT 1')
      .get(cleanName) as { id: number; name: string } | undefined;
    if (existing) {
      throw new Error(`Product group "${existing.name}" already exists (#${existing.id})`);
    }
    const info = this.db
      .prepare('INSERT INTO product_groups (name, description, active) VALUES (?, ?, 1)')
      .run(cleanName, cleanDesc);
    const id = Number(info.lastInsertRowid);
    this.logActivity({
      itemLabel: cleanName,
      amount: 0,
      transactionType: 'group_create',
      userId,
    });
    return { id, name: cleanName, description: cleanDesc };
  }

  bulkAssignProductGroup(
    productIds: number[],
    groupId: number | null,
    userId?: number | null
  ): { updated: number } {
    const cleanIds = productIds.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (cleanIds.length === 0) throw new Error('No valid product IDs provided');

    let groupName = 'Ungrouped';
    if (groupId !== null) {
      const g = this.db.prepare('SELECT id, name FROM product_groups WHERE id = ?').get(groupId) as
        | { id: number; name: string }
        | undefined;
      if (!g) throw new Error(`Product group #${groupId} not found`);
      groupName = g.name;
    }

    const stmt = this.db.prepare('UPDATE products SET product_group_id = ? WHERE id = ?');
    let updated = 0;
    for (const pid of cleanIds) {
      const info = stmt.run(groupId, pid);
      updated += Number(info.changes || 0);
    }

    this.logActivity({
      productId: cleanIds.length === 1 ? cleanIds[0] : null,
      itemLabel: `${updated} ${updated === 1 ? 'item' : 'items'}`,
      amount: updated,
      transactionType: 'bulk_group',
      note: `Group: ${groupName}`,
      userId,
    });

    return { updated };
  }

  editInventoryItem(
    productId: number,
    payload: {
      name?: string;
      description?: string;
      product_group_id?: number | null;
      location_id?: number;
      min_stock_amount?: number;
      amount?: number;
      best_before_date?: string | null;
    },
    userId?: number | null
  ) {
    const existing = this.db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as any;
    if (!existing) throw new Error(`Product #${productId} not found`);

    const changes: string[] = [];

    const nextName =
      payload.name !== undefined && payload.name.trim() ? payload.name.trim() : existing.name;
    if (nextName !== existing.name) changes.push(`renamed from "${existing.name}"`);

    const nextDesc =
      payload.description !== undefined ? payload.description.trim() : existing.description;
    const nextGroupId =
      payload.product_group_id !== undefined ? payload.product_group_id : existing.product_group_id;
    if (nextGroupId !== existing.product_group_id) changes.push('group updated');

    const nextLocId =
      payload.location_id !== undefined ? Number(payload.location_id) : existing.location_id;
    if (nextLocId !== existing.location_id) changes.push('location updated');

    const nextMin =
      payload.min_stock_amount !== undefined
        ? Math.max(0, Number(payload.min_stock_amount))
        : existing.min_stock_amount;

    this.db
      .prepare(
        `UPDATE products
         SET name = ?, description = ?, product_group_id = ?, location_id = ?, min_stock_amount = ?
         WHERE id = ?`
      )
      .run(nextName, nextDesc, nextGroupId ?? null, nextLocId, nextMin, productId);

    // Update stock location if product default location changed and user requested it
    if (payload.location_id !== undefined && nextLocId !== existing.location_id) {
      this.db
        .prepare('UPDATE stock SET location_id = ? WHERE product_id = ?')
        .run(nextLocId, productId);
    }

    // Update expiry date across active batches if supplied
    if (payload.best_before_date !== undefined) {
      const nextBbd = payload.best_before_date?.trim() || NEVER_EXPIRES;
      const info = this.db
        .prepare('UPDATE stock SET best_before_date = ? WHERE product_id = ? AND amount > 0')
        .run(nextBbd, productId);
      if (Number(info.changes) > 0) {
        changes.push(`expiry -> ${nextBbd === NEVER_EXPIRES ? 'none' : nextBbd}`);
      }
    }

    // Update total stock amount if supplied
    if (payload.amount !== undefined && Number.isFinite(Number(payload.amount))) {
      const targetAmt = Math.max(0, Number(payload.amount));
      const currentAmt = (
        this.db
          .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM stock WHERE product_id = ?')
          .get(productId) as { total: number }
      ).total;
      if (Math.abs(targetAmt - currentAmt) > 1e-6) {
        this.inventoryProduct(
          productId,
          {
            new_amount: targetAmt,
            location_id: nextLocId,
            best_before_date: payload.best_before_date || undefined,
            note: 'Edited in inventory',
          },
          userId
        );
        changes.push(`qty ${currentAmt} -> ${targetAmt}`);
      }
    }

    if (changes.length > 0) {
      this.logActivity({
        productId,
        itemLabel: nextName,
        amount: 0,
        transactionType: 'product_edit',
        locationId: nextLocId,
        note: changes.join(', '),
        userId,
      });
    }

    return this.getProductDetails(productId);
  }

  getShoppingListItems(listId?: number): any[] {
    const sql = listId
      ? `SELECT sl.*, p.name AS product_name, p.picture_file_name AS product_photo,
                qu.name AS qu_name, qu.name_plural AS qu_name_plural,
                ua.display_name AS added_by_name,
                uc.display_name AS completed_by_name
         FROM shopping_list sl
         LEFT JOIN products p ON p.id = sl.product_id
         LEFT JOIN quantity_units qu ON qu.id = COALESCE(sl.qu_id, p.qu_id_purchase)
         LEFT JOIN users ua ON ua.id = sl.added_by_user_id
         LEFT JOIN users uc ON uc.id = sl.completed_by_user_id
         WHERE sl.shopping_list_id = ?
         ORDER BY sl.done ASC, sl.id DESC`
      : `SELECT sl.*, p.name AS product_name, p.picture_file_name AS product_photo,
                qu.name AS qu_name, qu.name_plural AS qu_name_plural,
                ua.display_name AS added_by_name,
                uc.display_name AS completed_by_name
         FROM shopping_list sl
         LEFT JOIN products p ON p.id = sl.product_id
         LEFT JOIN quantity_units qu ON qu.id = COALESCE(sl.qu_id, p.qu_id_purchase)
         LEFT JOIN users ua ON ua.id = sl.added_by_user_id
         LEFT JOIN users uc ON uc.id = sl.completed_by_user_id
         ORDER BY sl.done ASC, sl.id DESC`;

    return listId ? this.db.prepare(sql).all(listId) : this.db.prepare(sql).all();
  }

  addMissingProductsToShoppingList(listId = 1, userId?: number | null): { added: number } {
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
            'INSERT INTO shopping_list (product_id, amount, shopping_list_id, done, added_by_user_id) VALUES (?, ?, ?, 0, ?)'
          )
          .run(missing.id, missing.amount_missing, listId, userId ?? null);
        this.logActivity({
          productId: missing.id,
          itemLabel: missing.name,
          amount: missing.amount_missing,
          transactionType: 'shopping_add',
          note: 'Auto-added low stock',
          userId,
        });
        this.recordShoppingListNotification(userId ?? null, missing.name);
        added++;
      }
    }

    return { added };
  }

  recordShoppingListNotification(actorUserId: number | null, itemName: string) {
    const cleanItem = itemName.trim() || 'an item';
    let actorName = 'Someone';
    if (actorUserId) {
      const u = this.db
        .prepare('SELECT display_name, username FROM users WHERE id = ?')
        .get(actorUserId) as { display_name: string; username: string } | undefined;
      if (u) actorName = u.display_name || u.username;
    }

    const title = 'Shopping List';
    const body = `${actorName} added ${cleanItem} to shopping list`;

    this.db
      .prepare(
        `INSERT INTO notifications (type, actor_user_id, actor_name, item_name, title, body)
         VALUES ('shopping_add', ?, ?, ?, ?, ?)`
      )
      .run(actorUserId, actorName, cleanItem, title, body);

    // Keep notifications table compact (last 500 events)
    this.db.exec(
      'DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY id DESC LIMIT 500)'
    );

    // Optional self-hosted ntfy webhook push if NTFY_TOPIC_URL is configured
    const ntfyUrl = process.env.NTFY_TOPIC_URL?.trim();
    if (ntfyUrl) {
      fetch(ntfyUrl, {
        method: 'POST',
        headers: { Title: title, Tags: 'shopping_cart' },
        body,
      }).catch(() => {});
    }
  }

  getNotificationsForUser(userId: number, afterId = 0, limit = 30) {
    const latestRow = this.db
      .prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM notifications')
      .get() as { max_id: number };
    const latestId = Number(latestRow?.max_id || 0);

    const items = this.db
      .prepare(
        `SELECT id, type, actor_user_id, actor_name, item_name, title, body, created_at
         FROM notifications
         WHERE id > ? AND (actor_user_id IS NULL OR actor_user_id != ?)
         ORDER BY id ASC
         LIMIT ?`
      )
      .all(afterId, userId, Math.min(100, Math.max(1, limit)));

    return { latest_id: latestId, notifications: items };
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

  purchaseDoneShoppingItems(listId = 1, userId?: number | null): { purchased: number } {
    const doneItems = this.db
      .prepare('SELECT * FROM shopping_list WHERE shopping_list_id = ? AND done = 1')
      .all(listId) as any[];

    let purchased = 0;
    for (const item of doneItems) {
      if (item.product_id) {
        this.purchaseProduct(
          item.product_id,
          {
            amount: Number(item.amount || 1),
            note: item.note || 'From shopping list',
          },
          userId
        );
        purchased++;
      }
      this.db.prepare('DELETE FROM shopping_list WHERE id = ?').run(item.id);
    }

    return { purchased };
  }
}
