import crypto from 'node:crypto';
import { AuthUser, generateApiKey, hashPassword, verifyPassword } from './auth';
import { DbContext } from './db';
import { deletePhotoIfUnreferenced } from './photos';
import { scoreReceiptItemMatch } from './receiptOcr';

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
    if (inProducts) return true;
    const inReceipts = this.db
      .prepare('SELECT 1 FROM receipts WHERE photo_file_name = ? LIMIT 1')
      .get(fileName);
    return Boolean(inReceipts);
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
          MIN(CASE WHEN s.open = 1 THEN NULLIF(s.opened_date, '') ELSE NULL END) AS earliest_opened_date,
          MIN(
            CASE
              WHEN s.open = 1 THEN COALESCE(
                NULLIF(s.opened_use_by_date, ''),
                CASE WHEN s.opened_date IS NOT NULL AND s.opened_date != '' THEN date(s.opened_date, '+14 days') ELSE NULL END
              )
              ELSE NULL
            END
          ) AS earliest_opened_use_by,
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
            WHERE s2.product_id = p.id
              AND s2.amount > 0
              AND s2.photo_file_name IS NOT NULL
              AND s2.photo_file_name != ''
            ORDER BY COALESCE(NULLIF(s2.best_before_date, ''), '2999-12-31') ASC, s2.id DESC
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
        earliest_opened_date,
        earliest_opened_use_by,
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
        opened_date: Number(opened_amount || 0) > 0 ? earliest_opened_date || null : null,
        opened_use_by_date: Number(opened_amount || 0) > 0 ? earliest_opened_use_by || null : null,
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
      stock_entry_id?: number;
      receipt_item_id?: number;
      store_name?: string;
      purchased_date?: string;
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

    const photoFileName = payload.photo_file_name?.trim() || null;

    // If a specific existing batch was selected, add the quantity directly into that batch
    if (payload.stock_entry_id) {
      const existing = this.db
        .prepare('SELECT * FROM stock WHERE id = ? AND product_id = ? AND amount > 0')
        .get(payload.stock_entry_id, productId) as any;
      if (existing) {
        const nextAmount = Math.round((Number(existing.amount) + amount) * 1000) / 1000;
        const nextNote = payload.note?.trim() ? payload.note.trim() : existing.note || '';
        const nextPrice = payload.price ?? existing.price ?? null;
        const nextPhoto = photoFileName || existing.photo_file_name || null;

        this.db
          .prepare(
            'UPDATE stock SET amount = ?, note = ?, price = ?, photo_file_name = ? WHERE id = ?'
          )
          .run(nextAmount, nextNote, nextPrice, nextPhoto, existing.id);

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
          locationId: Number(existing.location_id),
          note: payload.note?.trim() || '',
          userId,
        });

        if (payload.receipt_item_id) {
          this.linkReceiptItemToProduct(payload.receipt_item_id, productId, {
            unitPrice: payload.price,
            quantity: amount,
          });
        } else if (payload.price !== undefined && payload.price !== null && Number(payload.price) > 0) {
          this.recordPriceHistory({
            productId,
            unitPrice: Number(payload.price),
            quantity: amount,
            storeName: payload.store_name || '',
            purchasedDate: payload.purchased_date || todayIso(),
          });
        }

        return {
          id: Number(existing.id),
          stock_id: existing.stock_id,
          product_id: productId,
          amount: nextAmount,
          location_id: Number(existing.location_id),
          best_before_date: existing.best_before_date,
          photo_file_name: nextPhoto,
        };
      }
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

    if (payload.receipt_item_id) {
      this.linkReceiptItemToProduct(payload.receipt_item_id, productId, {
        unitPrice: payload.price,
        quantity: amount,
      });
    } else if (payload.price !== undefined && payload.price !== null && Number(payload.price) > 0) {
      this.recordPriceHistory({
        productId,
        unitPrice: Number(payload.price),
        quantity: amount,
        storeName: payload.store_name || '',
        purchasedDate: payload.purchased_date || todayIso(),
      });
    }

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

    // Optional automation: auto-add to shopping list when stock drops below min_stock_amount
    try {
      if (this.getAlertSettings().auto_add_below_min_stock) {
        const prodMeta = this.db
          .prepare('SELECT id, name, min_stock_amount FROM products WHERE id = ?')
          .get(productId) as { id: number; name: string; min_stock_amount: number } | undefined;
        const minAmt = Number(prodMeta?.min_stock_amount || 0);
        if (prodMeta && minAmt > 0) {
          const curRow = this.db
            .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM stock WHERE product_id = ? AND amount > 0')
            .get(productId) as { total: number };
          const current = Number(curRow?.total || 0);
          if (current < minAmt) {
            const missingQty = Math.max(1, Math.ceil(minAmt - current));
            const existingShop = this.db
              .prepare(
                'SELECT id, amount FROM shopping_list WHERE product_id = ? AND shopping_list_id = 1 AND done = 0 LIMIT 1'
              )
              .get(productId) as { id: number; amount: number } | undefined;
            if (existingShop) {
              if (Number(existingShop.amount) < missingQty) {
                this.db
                  .prepare('UPDATE shopping_list SET amount = ? WHERE id = ?')
                  .run(missingQty, existingShop.id);
              }
            } else {
              this.db
                .prepare(
                  'INSERT INTO shopping_list (product_id, amount, shopping_list_id, done, added_by_user_id) VALUES (?, ?, 1, 0, ?)'
                )
                .run(productId, missingQty, userId ?? null);
              this.recordShoppingListNotification(userId ?? null, prodMeta.name);
            }
          }
        }
      }
    } catch {
      // Never fail consume if auto-shopping-list check encounters an error
    }

    return { product_id: productId, consumed: consumedTotal };
  }

  openProduct(productId: number, amount = 1, userId?: number | null, days?: number) {
    const product = this.db
      .prepare('SELECT name, default_best_before_days_after_open FROM products WHERE id = ?')
      .get(productId) as
      | { name: string; default_best_before_days_after_open: number }
      | undefined;
    const qty = Number(amount);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Amount must be greater than 0');

    const countdownDays =
      days && Number.isFinite(Number(days)) && Number(days) > 0
        ? Math.round(Number(days))
        : product && Number(product.default_best_before_days_after_open) > 0
        ? Number(product.default_best_before_days_after_open)
        : 14;

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
    const useByDate = addDaysIso(countdownDays);
    let remaining = qty;

    for (const entry of unopened) {
      if (remaining <= 0) break;
      const entryAmt = Number(entry.amount);
      if (entryAmt <= remaining + 1e-9) {
        remaining = Math.max(0, Math.round((remaining - entryAmt) * 1000) / 1000);
        this.db
          .prepare('UPDATE stock SET open = 1, opened_date = ?, opened_use_by_date = ? WHERE id = ?')
          .run(today, useByDate, entry.id);
      } else {
        const leftover = Math.round((entryAmt - remaining) * 1000) / 1000;
        this.db.prepare('UPDATE stock SET amount = ? WHERE id = ?').run(leftover, entry.id);
        this.db
          .prepare(
            `INSERT INTO stock (
              product_id, amount, best_before_date, purchased_date, stock_id,
              price, open, opened_date, opened_use_by_date, location_id, shopping_location_id, note, photo_file_name, added_by_user_id
            ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            productId,
            remaining,
            entry.best_before_date,
            entry.purchased_date,
            crypto.randomBytes(8).toString('hex'),
            entry.price,
            today,
            useByDate,
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
      note: `${countdownDays}d countdown`,
      userId,
    });

    return { product_id: productId, opened, opened_use_by_date: useByDate };
  }

  extendOpenedProduct(
    productId: number,
    days = 7,
    stockEntryId?: number,
    userId?: number | null
  ) {
    const product = this.db.prepare('SELECT name FROM products WHERE id = ?').get(productId) as
      | { name: string }
      | undefined;
    if (!product) throw new Error(`Product ${productId} not found`);

    const extDays = Math.max(1, Math.round(Number(days) || 7));
    const entries = stockEntryId
      ? (this.db
          .prepare('SELECT * FROM stock WHERE id = ? AND product_id = ? AND open = 1 AND amount > 0')
          .all(stockEntryId, productId) as any[])
      : (this.db
          .prepare('SELECT * FROM stock WHERE product_id = ? AND open = 1 AND amount > 0')
          .all(productId) as any[]);

    if (entries.length === 0) {
      throw new Error('No opened stock available to extend');
    }

    const today = todayIso();
    const addDaysToIso = (iso: string, d: number): string => {
      const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return addDaysIso(d);
      const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      dt.setDate(dt.getDate() + d);
      const y = dt.getFullYear();
      const mo = String(dt.getMonth() + 1).padStart(2, '0');
      const da = String(dt.getDate()).padStart(2, '0');
      return `${y}-${mo}-${da}`;
    };

    let latestUseBy = addDaysIso(extDays);
    const updateStmt = this.db.prepare('UPDATE stock SET opened_use_by_date = ? WHERE id = ?');
    for (const e of entries) {
      const existingUseBy =
        (e.opened_use_by_date && String(e.opened_use_by_date).trim()) ||
        (e.opened_date ? addDaysToIso(String(e.opened_date).trim(), 14) : today);
      const base = existingUseBy > today ? existingUseBy : today;
      const nextUseBy = addDaysToIso(base, extDays);
      updateStmt.run(nextUseBy, e.id);
      latestUseBy = nextUseBy;
    }

    this.logActivity({
      productId,
      itemLabel: product.name,
      amount: entries.reduce((sum, e) => sum + Number(e.amount || 0), 0),
      transactionType: 'open_extend',
      locationId: entries[0]?.location_id ?? null,
      note: `+${extDays} days (until ${latestUseBy})`,
      userId,
    });

    return {
      product_id: productId,
      extended: entries.length,
      opened_use_by_date: latestUseBy,
    };
  }

  editStockEntry(
    entryId: number,
    payload: {
      amount?: number;
      best_before_date?: string;
      price?: number | null;
      note?: string;
      location_id?: number;
    },
    userId?: number | null
  ) {
    const existing = this.db
      .prepare('SELECT * FROM stock WHERE id = ?')
      .get(entryId) as any;
    if (!existing) {
      throw new Error(`Stock entry #${entryId} not found`);
    }

    const product = this.db
      .prepare('SELECT id, name FROM products WHERE id = ?')
      .get(existing.product_id) as { id: number; name: string } | undefined;
    const itemLabel = product?.name || `Product #${existing.product_id}`;

    const nextAmount =
      payload.amount !== undefined ? Number(payload.amount) : Number(existing.amount);
    if (!Number.isFinite(nextAmount) || nextAmount < 0) {
      throw new Error('amount must be a non-negative number');
    }

    if (nextAmount === 0) {
      this.db.prepare('DELETE FROM stock WHERE id = ?').run(entryId);
      this.logActivity({
        productId: existing.product_id,
        itemLabel,
        amount: Number(existing.amount),
        transactionType: 'stock_edit',
        locationId: existing.location_id ?? null,
        note: 'Batch cleared (set to 0)',
        userId,
      });
      return { id: entryId, deleted: true, amount: 0 };
    }

    const nextBbd =
      payload.best_before_date !== undefined
        ? payload.best_before_date.trim() || NEVER_EXPIRES
        : existing.best_before_date;
    const nextPrice =
      payload.price !== undefined
        ? payload.price === null || !Number.isFinite(Number(payload.price))
          ? null
          : Number(payload.price)
        : existing.price;
    const nextNote =
      payload.note !== undefined ? String(payload.note || '').trim() : existing.note || '';
    const nextLocationId =
      payload.location_id !== undefined && Number.isFinite(Number(payload.location_id)) && Number(payload.location_id) > 0
        ? Number(payload.location_id)
        : existing.location_id;

    this.db
      .prepare(
        `UPDATE stock
         SET amount = ?, best_before_date = ?, price = ?, note = ?, location_id = ?
         WHERE id = ?`
      )
      .run(nextAmount, nextBbd, nextPrice, nextNote, nextLocationId, entryId);

    this.logActivity({
      productId: existing.product_id,
      itemLabel,
      amount: nextAmount,
      transactionType: 'stock_edit',
      locationId: nextLocationId ?? null,
      note: nextNote || `Edited batch #${entryId}`,
      userId,
    });

    return this.db.prepare('SELECT * FROM stock WHERE id = ?').get(entryId);
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
      stock_entry_id?: number;
      photo_file_name?: string;
    },
    userId?: number | null
  ) {
    const product = this.db.prepare('SELECT name FROM products WHERE id = ?').get(productId) as
      | { name: string }
      | undefined;
    const qty = Number(payload.amount);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Transfer amount must be > 0');

    let entries: any[];
    let effectiveFromLocationId = Number(payload.location_id_from);

    if (payload.stock_entry_id) {
      entries = this.db
        .prepare('SELECT * FROM stock WHERE id = ? AND product_id = ? AND amount > 0')
        .all(payload.stock_entry_id, productId) as any[];
      if (entries.length > 0) {
        effectiveFromLocationId = Number(entries[0].location_id);
      }
    } else {
      entries = this.db
        .prepare(
          `SELECT * FROM stock WHERE product_id = ? AND location_id = ? AND amount > 0
           ORDER BY open DESC, COALESCE(NULLIF(best_before_date, ''), '2999-12-31') ASC, id ASC`
        )
        .all(productId, effectiveFromLocationId) as any[];
    }

    if (effectiveFromLocationId === Number(payload.location_id_to)) {
      throw new Error('Source and destination locations must be different');
    }

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
      .get(effectiveFromLocationId) as { name: string } | undefined;
    const toLoc = this.db
      .prepare('SELECT name FROM locations WHERE id = ?')
      .get(payload.location_id_to) as { name: string } | undefined;

    this.logActivity({
      productId,
      itemLabel: product?.name || '',
      amount: moved,
      transactionType: 'transfer',
      locationId: payload.location_id_to,
      note: `${fromLoc?.name || `#${effectiveFromLocationId}`} → ${toLoc?.name || `#${payload.location_id_to}`}`,
      userId,
    });

    return {
      product_id: productId,
      transferred: moved,
      location_id_from: effectiveFromLocationId,
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

  bulkDeleteProducts(
    productIds: number[],
    userId?: number | null
  ): { deleted: number; deleted_ids: number[]; deleted_names: string[] } {
    const cleanIds = Array.from(
      new Set(productIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))
    );
    if (cleanIds.length === 0) throw new Error('No valid product IDs provided');

    const getProd = this.db.prepare(
      'SELECT id, name, picture_file_name, storage_photo_file_name FROM products WHERE id = ?'
    );
    const getBatchPhotos = this.db.prepare(
      'SELECT DISTINCT photo_file_name FROM stock WHERE product_id = ? AND photo_file_name IS NOT NULL'
    );
    const delProd = this.db.prepare('DELETE FROM products WHERE id = ?');

    const deletedIds: number[] = [];
    const deletedNames: string[] = [];
    const photosToCheck = new Set<string>();

    for (const pid of cleanIds) {
      const row = getProd.get(pid) as
        | {
            id: number;
            name: string;
            picture_file_name: string | null;
            storage_photo_file_name: string | null;
          }
        | undefined;
      if (!row) continue;

      if (row.picture_file_name) photosToCheck.add(row.picture_file_name);
      if (row.storage_photo_file_name) photosToCheck.add(row.storage_photo_file_name);
      const batchPhotos = getBatchPhotos.all(pid) as Array<{ photo_file_name: string }>;
      for (const bp of batchPhotos) {
        if (bp.photo_file_name) photosToCheck.add(bp.photo_file_name);
      }

      const info = delProd.run(pid);
      if (Number(info.changes || 0) > 0) {
        deletedIds.push(row.id);
        deletedNames.push(row.name);
      }
    }

    for (const fileName of photosToCheck) {
      this.cleanupPhotoIfUnused(fileName);
    }

    if (deletedIds.length > 0) {
      const previewNames = deletedNames.slice(0, 5).join(', ');
      const extra = deletedNames.length > 5 ? ` +${deletedNames.length - 5} more` : '';
      this.logActivity({
        productId: null,
        itemLabel:
          deletedIds.length === 1
            ? deletedNames[0]
            : `${deletedIds.length} items`,
        amount: deletedIds.length,
        transactionType: deletedIds.length === 1 ? 'product_delete' : 'bulk_delete',
        note: deletedIds.length > 1 ? `${previewNames}${extra}` : '',
        userId,
      });
    }

    return {
      deleted: deletedIds.length,
      deleted_ids: deletedIds,
      deleted_names: deletedNames,
    };
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

    const rows = (listId ? this.db.prepare(sql).all(listId) : this.db.prepare(sql).all()) as any[];
    return rows.map((r) => ({
      ...r,
      unit: String(r.unit || '').trim(),
      qu_name: String(r.unit || '').trim() || r.qu_name || null,
      qu_name_plural: String(r.unit || '').trim() || r.qu_name_plural || null,
      recipe_names: this.parseRecipeNames(r.recipe_names),
    }));
  }

  private parseRecipeNames(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
    if (typeof raw !== 'string' || !raw.trim()) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((s) => String(s).trim()).filter(Boolean);
    } catch {
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
    return [];
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

  refillConsumedToShoppingList(
    listId = 1,
    days = 7,
    userId?: number | null
  ): {
    added: number;
    updated: number;
    items: Array<{ product_id: number; name: string; amount: number }>;
  } {
    const safeDays = Math.min(90, Math.max(1, Math.round(Number(days) || 7)));
    const rows = this.db
      .prepare(
        `
        SELECT
          sl.product_id,
          p.name AS product_name,
          SUM(ABS(sl.amount)) AS consumed_qty
        FROM stock_log sl
        INNER JOIN products p ON p.id = sl.product_id
        WHERE sl.product_id IS NOT NULL
          AND sl.transaction_type IN ('consume', 'spoiled')
          AND datetime(sl.row_created_timestamp) >= datetime('now', '-' || ? || ' days')
        GROUP BY sl.product_id
        HAVING SUM(ABS(sl.amount)) > 0
        ORDER BY p.name COLLATE NOCASE ASC
      `
      )
      .all(safeDays) as Array<{
      product_id: number;
      product_name: string;
      consumed_qty: number;
    }>;

    let added = 0;
    let updated = 0;
    const items: Array<{ product_id: number; name: string; amount: number }> = [];

    for (const row of rows) {
      const qty = Math.round(Number(row.consumed_qty) * 100) / 100;
      if (!Number.isFinite(qty) || qty <= 0) continue;

      const existing = this.db
        .prepare(
          'SELECT id, amount FROM shopping_list WHERE shopping_list_id = ? AND product_id = ? AND done = 0'
        )
        .get(listId, row.product_id) as { id: number; amount: number } | undefined;

      if (existing) {
        if (Number(existing.amount) < qty) {
          this.db
            .prepare('UPDATE shopping_list SET amount = ? WHERE id = ?')
            .run(qty, existing.id);
          updated++;
          items.push({ product_id: row.product_id, name: row.product_name, amount: qty });
        }
      } else {
        this.db
          .prepare(
            'INSERT INTO shopping_list (product_id, amount, shopping_list_id, done, added_by_user_id) VALUES (?, ?, ?, 0, ?)'
          )
          .run(row.product_id, qty, listId, userId ?? null);
        this.logActivity({
          productId: row.product_id,
          itemLabel: row.product_name,
          amount: qty,
          transactionType: 'shopping_add',
          note: `Refill (used in last ${safeDays}d)`,
          userId,
        });
        this.recordShoppingListNotification(userId ?? null, row.product_name);
        added++;
        items.push({ product_id: row.product_id, name: row.product_name, amount: qty });
      }
    }

    return { added, updated, items };
  }

  setAllShoppingListDone(
    listId = 1,
    done: boolean,
    userId?: number | null
  ): { updated: number } {
    const info = done
      ? this.db
          .prepare(
            `UPDATE shopping_list
             SET done = 1, completed_by_user_id = ?, completed_at = datetime('now')
             WHERE shopping_list_id = ? AND done = 0`
          )
          .run(userId ?? null, listId)
      : this.db
          .prepare(
            `UPDATE shopping_list
             SET done = 0, completed_by_user_id = NULL, completed_at = NULL
             WHERE shopping_list_id = ? AND done = 1`
          )
          .run(listId);
    return { updated: Number(info.changes || 0) };
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

  runDailyExpiringSoonCheck(
    dueSoonDays = Number(process.env.DUE_SOON_DAYS || 5),
    force = false
  ): {
    ran: boolean;
    notified: boolean;
    items: string[];
    title?: string;
    body?: string;
    date: string;
  } {
    const today = todayIso();
    const safeDays = Math.max(1, Math.min(30, Math.round(Number(dueSoonDays) || 5)));

    if (!force) {
      const lastRun = this.db
        .prepare("SELECT value FROM server_settings WHERE key = 'last_expiring_soon_notif_date'")
        .get() as { value: string } | undefined;
      if (lastRun?.value === today) {
        return { ran: false, notified: false, items: [], date: today };
      }
    }

    const volatile = this.getVolatileStock(safeDays);
    const dueItems = volatile.due_products || [];
    const itemNames = Array.from(
      new Set(
        dueItems
          .map((d: any) => String(d.product?.name || '').trim())
          .filter(Boolean)
      )
    );

    // Mark today as checked so we only send once per day
    this.db
      .prepare(
        `INSERT INTO server_settings (key, value, updated_at)
         VALUES ('last_expiring_soon_notif_date', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
      )
      .run(today);

    if (itemNames.length === 0) {
      return { ran: true, notified: false, items: [], date: today };
    }

    let listText: string;
    if (itemNames.length === 1) {
      listText = itemNames[0];
    } else if (itemNames.length === 2) {
      listText = `${itemNames[0]} and ${itemNames[1]}`;
    } else if (itemNames.length <= 5) {
      listText = `${itemNames.slice(0, -1).join(', ')}, and ${itemNames[itemNames.length - 1]}`;
    } else {
      const extra = itemNames.length - 5;
      listText = `${itemNames.slice(0, 5).join(', ')}, and ${extra} more ${extra === 1 ? 'item' : 'items'}`;
    }

    const title = 'Expiring Soon';
    const body =
      itemNames.length === 1
        ? `${listText} is expiring soon, use it or lose it!`
        : `${listText} are expiring soon, use them or lose them!`;

    this.db
      .prepare(
        `INSERT INTO notifications (type, actor_user_id, actor_name, item_name, title, body)
         VALUES ('expiring_soon', NULL, 'GrocyGo', ?, ?, ?)`
      )
      .run(itemNames.join(', '), title, body);

    this.db.exec(
      'DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY id DESC LIMIT 500)'
    );

    const ntfyUrl = process.env.NTFY_TOPIC_URL?.trim();
    if (ntfyUrl) {
      fetch(ntfyUrl, {
        method: 'POST',
        headers: { Title: title, Tags: 'hourglass_flowing_sand' },
        body,
      }).catch(() => {});
    }

    return {
      ran: true,
      notified: true,
      items: itemNames,
      title,
      body,
      date: today,
    };
  }

  // ─── Alert Settings & Inventory Stats ─────────────────────────
  getAlertSettings(): {
    expiring_soon_enabled: boolean;
    expiring_soon_days: number;
    expiring_soon_hour: number;
    auto_add_below_min_stock: boolean;
    last_expiring_soon_notif_date: string | null;
  } {
    const rows = this.db
      .prepare(
        `SELECT key, value FROM server_settings
         WHERE key IN (
           'alert_expiring_soon_enabled',
           'alert_expiring_soon_days',
           'alert_expiring_soon_hour',
           'alert_auto_add_below_min_stock',
           'last_expiring_soon_notif_date'
         )`
      )
      .all() as Array<{ key: string; value: string }>;
    const map = new Map(rows.map((r) => [r.key, r.value]));

    const envDays = Math.max(1, Math.min(30, Number(process.env.DUE_SOON_DAYS ?? 5) || 5));
    const envHour = Math.max(0, Math.min(23, Number(process.env.EXPIRING_NOTIFY_HOUR ?? 9)));

    return {
      expiring_soon_enabled: map.has('alert_expiring_soon_enabled')
        ? map.get('alert_expiring_soon_enabled') === '1'
        : true,
      expiring_soon_days: map.has('alert_expiring_soon_days')
        ? Math.max(1, Math.min(30, Number(map.get('alert_expiring_soon_days')) || envDays))
        : envDays,
      expiring_soon_hour: map.has('alert_expiring_soon_hour')
        ? Math.max(0, Math.min(23, Number(map.get('alert_expiring_soon_hour'))))
        : envHour,
      auto_add_below_min_stock: map.get('alert_auto_add_below_min_stock') === '1',
      last_expiring_soon_notif_date: map.get('last_expiring_soon_notif_date') || null,
    };
  }

  updateAlertSettings(payload: {
    expiring_soon_enabled?: boolean;
    expiring_soon_days?: number;
    expiring_soon_hour?: number;
    auto_add_below_min_stock?: boolean;
  }) {
    const upsert = this.db.prepare(
      `INSERT INTO server_settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    );
    if (typeof payload.expiring_soon_enabled === 'boolean') {
      upsert.run('alert_expiring_soon_enabled', payload.expiring_soon_enabled ? '1' : '0');
    }
    if (payload.expiring_soon_days !== undefined) {
      const d = Math.max(1, Math.min(30, Math.round(Number(payload.expiring_soon_days) || 5)));
      upsert.run('alert_expiring_soon_days', String(d));
    }
    if (payload.expiring_soon_hour !== undefined) {
      const h = Math.max(0, Math.min(23, Math.round(Number(payload.expiring_soon_hour))));
      upsert.run('alert_expiring_soon_hour', String(h));
    }
    if (typeof payload.auto_add_below_min_stock === 'boolean') {
      upsert.run('alert_auto_add_below_min_stock', payload.auto_add_below_min_stock ? '1' : '0');
    }
    return this.getAlertSettings();
  }

  getPrinterSettings(): {
    bridge_url: string;
    bridge_token: string;
    configured: boolean;
  } {
    const rows = this.db
      .prepare(
        "SELECT key, value FROM server_settings WHERE key IN ('printer_bridge_url', 'printer_bridge_token')"
      )
      .all() as Array<{ key: string; value: string }>;
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const bridgeUrl = (map.get('printer_bridge_url') ?? process.env.PRINT_BRIDGE_URL ?? '').trim().replace(/\/+$/, '');
    const bridgeToken = (map.get('printer_bridge_token') ?? process.env.PRINT_BRIDGE_TOKEN ?? '').trim();
    return {
      bridge_url: bridgeUrl,
      bridge_token: bridgeToken,
      configured: Boolean(bridgeUrl),
    };
  }

  updatePrinterSettings(payload: { bridge_url?: string; bridge_token?: string }) {
    const upsert = this.db.prepare(
      `INSERT INTO server_settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    );
    if (payload.bridge_url !== undefined) {
      upsert.run('printer_bridge_url', String(payload.bridge_url || '').trim().replace(/\/+$/, ''));
    }
    if (payload.bridge_token !== undefined) {
      upsert.run('printer_bridge_token', String(payload.bridge_token || '').trim());
    }
    return this.getPrinterSettings();
  }

  getInventoryStats(days = 30) {
    const safeDays = Math.max(1, Math.min(365, Math.round(Number(days) || 30)));
    const alertCfg = this.getAlertSettings();
    const dueSoonDays = alertCfg.expiring_soon_days;
    const today = todayIso();
    const soonCutoff = addDaysIso(dueSoonDays);

    const stockOverview = this.getStockOverview();
    const volatile = this.getVolatileStock(dueSoonDays);

    const totalProductsRow = this.db
      .prepare('SELECT COUNT(*) AS c FROM products')
      .get() as { c: number };
    const batchAgg = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total_batches,
           COALESCE(SUM(amount), 0) AS total_units,
           COALESCE(SUM(CASE WHEN price IS NOT NULL AND price > 0 THEN amount * price ELSE 0 END), 0) AS total_value
         FROM stock WHERE amount > 0`
      )
      .get() as { total_batches: number; total_units: number; total_value: number };

    // Expiry distribution across active stock items
    const d3 = addDaysIso(3);
    const d7 = addDaysIso(7);
    const d14 = addDaysIso(14);
    const d30 = addDaysIso(30);
    const expiryBuckets = {
      overdue: 0,
      days_0_3: 0,
      days_4_7: 0,
      days_8_14: 0,
      days_15_30: 0,
      days_30_plus: 0,
      no_expiry: 0,
    };

    let openedCount = 0;
    let openedExpiredCount = 0;
    let freshCount = 0;

    for (const s of stockOverview) {
      if (Number(s.amount_opened) > 0) {
        openedCount++;
        if (s.opened_use_by_date && s.opened_use_by_date <= today) {
          openedExpiredCount++;
        }
      }
      const bbd = s.best_before_date;
      if (!bbd || bbd === NEVER_EXPIRES) {
        expiryBuckets.no_expiry++;
        freshCount++;
      } else if (bbd < today) {
        expiryBuckets.overdue++;
      } else if (bbd <= d3) {
        expiryBuckets.days_0_3++;
      } else if (bbd <= d7) {
        expiryBuckets.days_4_7++;
      } else if (bbd <= d14) {
        expiryBuckets.days_8_14++;
      } else if (bbd <= d30) {
        expiryBuckets.days_15_30++;
      } else {
        expiryBuckets.days_30_plus++;
      }

      if (bbd && bbd !== NEVER_EXPIRES && bbd > soonCutoff) {
        freshCount++;
      }
    }

    // Waste vs consumed over window
    const windowModifier = `-${safeDays} days`;
    const usageRow = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN transaction_type = 'consume' AND spoiled = 0 THEN ABS(amount) ELSE 0 END), 0) AS consumed_qty,
           COALESCE(SUM(CASE WHEN transaction_type = 'spoiled' OR spoiled = 1 THEN ABS(amount) ELSE 0 END), 0) AS spoiled_qty,
           COALESCE(SUM(CASE WHEN transaction_type = 'purchase' THEN ABS(amount) ELSE 0 END), 0) AS purchased_qty
         FROM stock_log
         WHERE row_created_timestamp >= datetime('now', ?)`
      )
      .get(windowModifier) as { consumed_qty: number; spoiled_qty: number; purchased_qty: number };

    const consumedQty = Math.round(Number(usageRow?.consumed_qty || 0) * 100) / 100;
    const spoiledQty = Math.round(Number(usageRow?.spoiled_qty || 0) * 100) / 100;
    const totalUsedOrSpoiled = consumedQty + spoiledQty;
    const wasteRatePct =
      totalUsedOrSpoiled > 0 ? Math.round((spoiledQty / totalUsedOrSpoiled) * 1000) / 10 : 0;

    const topSpoiled = this.db
      .prepare(
        `SELECT
           COALESCE(p.name, NULLIF(sl.item_label, ''), 'Item') AS name,
           ROUND(SUM(ABS(sl.amount)), 2) AS total_spoiled
         FROM stock_log sl
         LEFT JOIN products p ON p.id = sl.product_id
         WHERE (sl.transaction_type = 'spoiled' OR sl.spoiled = 1)
           AND sl.row_created_timestamp >= datetime('now', ?)
         GROUP BY COALESCE(p.name, NULLIF(sl.item_label, ''), 'Item')
         ORDER BY total_spoiled DESC
         LIMIT 8`
      )
      .all(windowModifier) as Array<{ name: string; total_spoiled: number }>;

    const topConsumed = this.db
      .prepare(
        `SELECT
           sl.product_id,
           COALESCE(p.name, NULLIF(sl.item_label, ''), 'Item') AS name,
           ROUND(SUM(ABS(sl.amount)), 2) AS total_used,
           COALESCE((SELECT SUM(s.amount) FROM stock s WHERE s.product_id = sl.product_id AND s.amount > 0), 0) AS current_stock
         FROM stock_log sl
         LEFT JOIN products p ON p.id = sl.product_id
         WHERE sl.transaction_type = 'consume' AND sl.spoiled = 0
           AND sl.row_created_timestamp >= datetime('now', ?)
         GROUP BY COALESCE(p.name, NULLIF(sl.item_label, ''), 'Item')
         ORDER BY total_used DESC
         LIMIT 10`
      )
      .all(windowModifier) as Array<{
      product_id: number | null;
      name: string;
      total_used: number;
      current_stock: number;
    }>;

    // By location
    const byLocation = this.db
      .prepare(
        `SELECT
           l.id,
           l.name,
           l.is_freezer,
           COUNT(DISTINCT s.product_id) AS item_count,
           ROUND(COALESCE(SUM(s.amount), 0), 2) AS total_units
         FROM locations l
         LEFT JOIN stock s ON s.location_id = l.id AND s.amount > 0
         GROUP BY l.id
         ORDER BY item_count DESC, l.name COLLATE NOCASE ASC`
      )
      .all() as Array<{
      id: number;
      name: string;
      is_freezer: number;
      item_count: number;
      total_units: number;
    }>;

    // By group (including Ungrouped)
    const byGroup = this.db
      .prepare(
        `SELECT
           COALESCE(pg.id, 0) AS id,
           COALESCE(pg.name, 'Ungrouped') AS name,
           COUNT(DISTINCT s.product_id) AS item_count,
           ROUND(COALESCE(SUM(s.amount), 0), 2) AS total_units
         FROM stock s
         INNER JOIN products p ON p.id = s.product_id
         LEFT JOIN product_groups pg ON pg.id = p.product_group_id
         WHERE s.amount > 0
         GROUP BY COALESCE(pg.id, 0)
         ORDER BY item_count DESC, name COLLATE NOCASE ASC`
      )
      .all() as Array<{ id: number; name: string; item_count: number; total_units: number }>;

    // Household member activity breakdown
    const byUser = this.db
      .prepare(
        `SELECT
           COALESCE(u.id, 0) AS user_id,
           COALESCE(u.display_name, 'Household') AS display_name,
           SUM(CASE WHEN sl.transaction_type = 'purchase' THEN 1 ELSE 0 END) AS added_count,
           SUM(CASE WHEN sl.transaction_type IN ('consume', 'spoiled') THEN 1 ELSE 0 END) AS consumed_count,
           SUM(CASE WHEN sl.transaction_type = 'shopping_done' THEN 1 ELSE 0 END) AS shopping_checked_count,
           COUNT(*) AS total_actions
         FROM stock_log sl
         LEFT JOIN users u ON u.id = sl.user_id
         WHERE sl.row_created_timestamp >= datetime('now', ?)
         GROUP BY COALESCE(u.id, 0)
         ORDER BY total_actions DESC`
      )
      .all(windowModifier) as Array<{
      user_id: number;
      display_name: string;
      added_count: number;
      consumed_count: number;
      shopping_checked_count: number;
      total_actions: number;
    }>;

    // Data health & stale items (in-stock items untouched for 90+ days)
    const missingPhoto = (
      this.db
        .prepare(
          `SELECT COUNT(DISTINCT p.id) AS c
           FROM products p
           INNER JOIN stock s ON s.product_id = p.id AND s.amount > 0
           WHERE (p.picture_file_name IS NULL OR p.picture_file_name = '')`
        )
        .get() as { c: number }
    ).c;

    const missingGroup = (
      this.db
        .prepare(
          `SELECT COUNT(DISTINCT p.id) AS c
           FROM products p
           INNER JOIN stock s ON s.product_id = p.id AND s.amount > 0
           WHERE p.product_group_id IS NULL`
        )
        .get() as { c: number }
    ).c;

    const missingBarcode = (
      this.db
        .prepare(
          `SELECT COUNT(DISTINCT p.id) AS c
           FROM products p
           INNER JOIN stock s ON s.product_id = p.id AND s.amount > 0
           WHERE NOT EXISTS (SELECT 1 FROM product_barcodes pb WHERE pb.product_id = p.id)`
        )
        .get() as { c: number }
    ).c;

    const staleItems = this.db
      .prepare(
        `SELECT
           p.id,
           p.name,
           l.name AS location_name,
           ROUND(SUM(s.amount), 2) AS amount,
           MAX(s.row_created_timestamp) AS last_activity
         FROM stock s
         INNER JOIN products p ON p.id = s.product_id
         LEFT JOIN locations l ON l.id = p.location_id
         WHERE s.amount > 0
         GROUP BY p.id
         HAVING MAX(s.row_created_timestamp) <= datetime('now', '-90 days')
         ORDER BY last_activity ASC
         LIMIT 10`
      )
      .all() as Array<{
      id: number;
      name: string;
      location_name: string | null;
      amount: number;
      last_activity: string;
    }>;

    // Spend by store (from receipts within window)
    const byStore = this.db
      .prepare(
        `SELECT
           COALESCE(NULLIF(TRIM(store_name), ''), 'Unknown Store') AS store_name,
           COUNT(*) AS receipt_count,
           ROUND(COALESCE(SUM(COALESCE(total_amount, (SELECT SUM(COALESCE(ri.total_price, ri.quantity * COALESCE(ri.unit_price, 0))) FROM receipt_items ri WHERE ri.receipt_id = receipts.id), 0)), 0), 2) AS total_spent
         FROM receipts
         WHERE purchase_date >= date('now', ?)
         GROUP BY COALESCE(NULLIF(TRIM(store_name), ''), 'Unknown Store')
         ORDER BY total_spent DESC, store_name COLLATE NOCASE ASC`
      )
      .all(windowModifier) as Array<{
      store_name: string;
      receipt_count: number;
      total_spent: number;
    }>;

    return {
      window_days: safeDays,
      summary: {
        total_products: Number(totalProductsRow?.c || 0),
        in_stock_products: stockOverview.length,
        total_batches: Number(batchAgg?.total_batches || 0),
        total_units: Math.round(Number(batchAgg?.total_units || 0) * 100) / 100,
        estimated_stock_value: Math.round(Number(batchAgg?.total_value || 0) * 100) / 100,
        fresh_count: freshCount,
        due_soon_count: volatile.due_products.length,
        overdue_count: volatile.overdue_products.length,
        opened_count: openedCount,
        opened_expired_count: openedExpiredCount,
        below_min_stock_count: volatile.missing_products.length,
      },
      waste: {
        consumed_qty: consumedQty,
        spoiled_qty: spoiledQty,
        purchased_qty: Math.round(Number(usageRow?.purchased_qty || 0) * 100) / 100,
        waste_rate_pct: wasteRatePct,
        top_spoiled: topSpoiled,
      },
      expiry_buckets: expiryBuckets,
      top_consumed: topConsumed,
      by_location: byLocation,
      by_group: byGroup,
      by_store: byStore,
      by_user: byUser,
      data_health: {
        missing_photo: Number(missingPhoto || 0),
        missing_group: Number(missingGroup || 0),
        missing_barcode: Number(missingBarcode || 0),
        missing_expiry: expiryBuckets.no_expiry,
        stale_90d: staleItems.length,
      },
      stale_items: staleItems,
    };
  }

  // ─── Receipts & Price History ─────────────────────────────────
  createReceipt(
    payload: {
      store_name?: string;
      purchase_date?: string;
      total_amount?: number | null;
      photo_file_name?: string | null;
      raw_ocr_text?: string;
      items?: Array<{
        raw_name: string;
        quantity?: number;
        unit_price?: number | null;
        total_price?: number | null;
      }>;
    },
    userId?: number | null
  ) {
    const storeName = String(payload.store_name || '').trim();
    const purchaseDate = String(payload.purchase_date || '').trim() || todayIso();
    const totalAmt =
      payload.total_amount !== undefined && payload.total_amount !== null && Number.isFinite(Number(payload.total_amount))
        ? Math.round(Number(payload.total_amount) * 100) / 100
        : null;
    const photoFile = payload.photo_file_name?.trim() || null;
    const rawOcr = String(payload.raw_ocr_text || '');

    const info = this.db
      .prepare(
        `INSERT INTO receipts (store_name, purchase_date, total_amount, photo_file_name, raw_ocr_text, user_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(storeName, purchaseDate, totalAmt, photoFile, rawOcr, userId ?? null);

    const receiptId = Number(info.lastInsertRowid);
    const insertItem = this.db.prepare(
      `INSERT INTO receipt_items (receipt_id, raw_name, quantity, unit_price, total_price)
       VALUES (?, ?, ?, ?, ?)`
    );

    const cleanItems = Array.isArray(payload.items) ? payload.items : [];
    for (const item of cleanItems) {
      const name = String(item.raw_name || '').trim();
      if (!name) continue;
      const qty = Math.max(0.01, Number(item.quantity) || 1);
      const unitP =
        item.unit_price !== undefined && item.unit_price !== null && Number.isFinite(Number(item.unit_price))
          ? Math.round(Number(item.unit_price) * 100) / 100
          : item.total_price !== undefined && item.total_price !== null && Number.isFinite(Number(item.total_price))
          ? Math.round((Number(item.total_price) / qty) * 100) / 100
          : null;
      const totP =
        item.total_price !== undefined && item.total_price !== null && Number.isFinite(Number(item.total_price))
          ? Math.round(Number(item.total_price) * 100) / 100
          : unitP !== null
          ? Math.round(unitP * qty * 100) / 100
          : null;
      insertItem.run(receiptId, name, qty, unitP, totP);
    }

    this.logActivity({
      productId: null,
      itemLabel: storeName || 'Receipt',
      amount: cleanItems.length,
      transactionType: 'receipt_create',
      note: `${cleanItems.length} items${totalAmt !== null ? ` · $${totalAmt.toFixed(2)}` : ''}`,
      userId,
    });

    return this.getReceipt(receiptId);
  }

  getReceipt(receiptId: number) {
    const r = this.db.prepare('SELECT * FROM receipts WHERE id = ?').get(receiptId) as any;
    if (!r) return null;
    const items = this.db
      .prepare(
        `SELECT ri.*, p.name AS matched_product_name
         FROM receipt_items ri
         LEFT JOIN products p ON p.id = ri.matched_product_id
         WHERE ri.receipt_id = ?
         ORDER BY ri.id ASC`
      )
      .all(receiptId);
    return {
      ...r,
      items,
    };
  }

  listReceipts(limit = 30) {
    const receipts = this.db
      .prepare(
        `SELECT r.*,
           (SELECT COUNT(*) FROM receipt_items ri WHERE ri.receipt_id = r.id) AS item_count,
           (SELECT COUNT(*) FROM receipt_items ri WHERE ri.receipt_id = r.id AND ri.stock_added = 0) AS unlinked_count
         FROM receipts r
         ORDER BY r.purchase_date DESC, r.id DESC
         LIMIT ?`
      )
      .all(Math.min(100, Math.max(1, limit))) as any[];

    const getItems = this.db.prepare(
      `SELECT ri.*, p.name AS matched_product_name
       FROM receipt_items ri
       LEFT JOIN products p ON p.id = ri.matched_product_id
       WHERE ri.receipt_id = ?
       ORDER BY ri.id ASC`
    );

    return receipts.map((r) => ({
      ...r,
      items: getItems.all(r.id),
    }));
  }

  deleteReceipt(receiptId: number): { deleted: boolean } {
    const row = this.db
      .prepare('SELECT id, photo_file_name FROM receipts WHERE id = ?')
      .get(receiptId) as { id: number; photo_file_name: string | null } | undefined;
    if (!row) throw new Error(`Receipt #${receiptId} not found`);
    this.db.prepare('DELETE FROM price_history WHERE receipt_id = ?').run(receiptId);
    this.db.prepare('DELETE FROM receipts WHERE id = ?').run(receiptId);
    if (row.photo_file_name) {
      this.cleanupPhotoIfUnused(row.photo_file_name);
    }
    return { deleted: true };
  }

  updateReceipt(
    receiptId: number,
    payload: {
      store_name?: string;
      purchase_date?: string;
      total_amount?: number | null;
      items?: Array<{
        id?: number;
        raw_name: string;
        quantity?: number;
        unit_price?: number | null;
        total_price?: number | null;
        matched_product_id?: number | null;
      }>;
    },
    userId?: number | null
  ) {
    const existing = this.db.prepare('SELECT * FROM receipts WHERE id = ?').get(receiptId) as any;
    if (!existing) throw new Error(`Receipt #${receiptId} not found`);

    const nextStore =
      payload.store_name !== undefined ? String(payload.store_name || '').trim() : existing.store_name || '';
    const nextDate =
      payload.purchase_date !== undefined && String(payload.purchase_date).trim()
        ? String(payload.purchase_date).trim()
        : existing.purchase_date || todayIso();
    const nextTotal =
      payload.total_amount !== undefined
        ? payload.total_amount === null || payload.total_amount === ('' as any)
          ? null
          : Number.isFinite(Number(payload.total_amount))
          ? Math.round(Number(payload.total_amount) * 100) / 100
          : existing.total_amount
        : existing.total_amount;

    this.db
      .prepare('UPDATE receipts SET store_name = ?, purchase_date = ?, total_amount = ? WHERE id = ?')
      .run(nextStore, nextDate, nextTotal, receiptId);

    // Propagate receipt-level store_name and purchase_date to all linked price_history rows
    this.db
      .prepare('UPDATE price_history SET store_name = ?, purchased_date = ? WHERE receipt_id = ?')
      .run(nextStore, nextDate, receiptId);

    if (Array.isArray(payload.items)) {
      const existingItems = this.db
        .prepare('SELECT * FROM receipt_items WHERE receipt_id = ?')
        .all(receiptId) as any[];
      const existingById = new Map<number, any>(existingItems.map((it) => [Number(it.id), it]));
      const keptIds = new Set<number>();

      const updateItemStmt = this.db.prepare(
        `UPDATE receipt_items
         SET raw_name = ?, quantity = ?, unit_price = ?, total_price = ?, matched_product_id = ?, stock_added = ?
         WHERE id = ? AND receipt_id = ?`
      );
      const insertItemStmt = this.db.prepare(
        `INSERT INTO receipt_items (receipt_id, raw_name, quantity, unit_price, total_price, matched_product_id, stock_added)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      for (const item of payload.items) {
        const cleanName = String(item.raw_name || '').trim();
        if (!cleanName) continue;
        const qty = Math.max(0.01, Number(item.quantity) || 1);
        const rawUnit =
          item.unit_price !== undefined && item.unit_price !== null && String(item.unit_price) !== ''
            ? Number(item.unit_price)
            : null;
        const unitP =
          rawUnit !== null && Number.isFinite(rawUnit) && rawUnit >= 0
            ? Math.round(rawUnit * 100) / 100
            : null;
        const rawTot =
          item.total_price !== undefined && item.total_price !== null && String(item.total_price) !== ''
            ? Number(item.total_price)
            : null;
        const totP =
          rawTot !== null && Number.isFinite(rawTot) && rawTot >= 0
            ? Math.round(rawTot * 100) / 100
            : unitP !== null
            ? Math.round(unitP * qty * 100) / 100
            : null;

        const prev = item.id ? existingById.get(Number(item.id)) : undefined;
        const matchedProdId =
          item.matched_product_id !== undefined
            ? item.matched_product_id && Number(item.matched_product_id) > 0
              ? Number(item.matched_product_id)
              : null
            : prev
            ? prev.matched_product_id
            : null;
        const stockAdded = matchedProdId ? 1 : 0;

        let itemId: number;
        if (prev) {
          itemId = Number(prev.id);
          keptIds.add(itemId);
          updateItemStmt.run(cleanName, qty, unitP, totP, matchedProdId, stockAdded, itemId, receiptId);

          // Best-effort propagate corrected price/date to matching stock batch if price changed
          if (
            matchedProdId &&
            unitP !== null &&
            prev.unit_price !== null &&
            Number(prev.unit_price) !== unitP
          ) {
            this.db
              .prepare(
                `UPDATE stock SET price = ?
                 WHERE product_id = ? AND price = ? AND purchased_date = ?`
              )
              .run(unitP, matchedProdId, Number(prev.unit_price), existing.purchase_date);
          }
        } else {
          const info = insertItemStmt.run(
            receiptId,
            cleanName,
            qty,
            unitP,
            totP,
            matchedProdId,
            stockAdded
          );
          itemId = Number(info.lastInsertRowid);
          keptIds.add(itemId);
        }

        // Sync price_history row for this receipt item
        const existingPh = this.db
          .prepare('SELECT id FROM price_history WHERE receipt_item_id = ? LIMIT 1')
          .get(itemId) as { id: number } | undefined;

        if (matchedProdId && unitP !== null && unitP > 0) {
          if (existingPh) {
            this.db
              .prepare(
                `UPDATE price_history
                 SET product_id = ?, store_name = ?, unit_price = ?, quantity = ?, total_price = ?, purchased_date = ?
                 WHERE id = ?`
              )
              .run(matchedProdId, nextStore, unitP, qty, totP, nextDate, existingPh.id);
          } else {
            this.recordPriceHistory({
              productId: matchedProdId,
              receiptId,
              receiptItemId: itemId,
              storeName: nextStore,
              unitPrice: unitP,
              quantity: qty,
              totalPrice: totP,
              purchasedDate: nextDate,
            });
          }
        } else if (existingPh) {
          this.db.prepare('DELETE FROM price_history WHERE id = ?').run(existingPh.id);
        }
      }

      // Delete removed receipt items and their price_history rows
      for (const oldItem of existingItems) {
        const oid = Number(oldItem.id);
        if (!keptIds.has(oid)) {
          this.db.prepare('DELETE FROM price_history WHERE receipt_item_id = ?').run(oid);
          this.db.prepare('DELETE FROM receipt_items WHERE id = ?').run(oid);
        }
      }
    }

    this.logActivity({
      productId: null,
      itemLabel: nextStore || `Receipt #${receiptId}`,
      amount: 0,
      transactionType: 'receipt_edit',
      note: nextDate + (nextTotal !== null ? ` · $${nextTotal.toFixed(2)}` : ''),
      userId,
    });

    return this.getReceipt(receiptId);
  }

  getUnlinkedReceiptItems(query = '', days = 30) {
    const safeDays = Math.max(1, Math.min(365, Math.round(Number(days) || 30)));
    const rows = this.db
      .prepare(
        `SELECT
           ri.id,
           ri.receipt_id,
           ri.raw_name,
           ri.quantity,
           ri.unit_price,
           ri.total_price,
           ri.matched_product_id,
           ri.stock_added,
           r.store_name,
           r.purchase_date
         FROM receipt_items ri
         INNER JOIN receipts r ON r.id = ri.receipt_id
         WHERE ri.stock_added = 0
           AND r.created_at >= datetime('now', ?)
         ORDER BY r.purchase_date DESC, ri.id DESC
         LIMIT 150`
      )
      .all(`-${safeDays} days`) as any[];

    const cleanQuery = query.trim();
    if (!cleanQuery) {
      return rows.map((row) => ({ ...row, match_score: 0 }));
    }

    return rows
      .map((row) => ({
        ...row,
        match_score: scoreReceiptItemMatch(row.raw_name, cleanQuery),
      }))
      .sort((a, b) => {
        if (b.match_score !== a.match_score) return b.match_score - a.match_score;
        return String(b.purchase_date).localeCompare(String(a.purchase_date));
      });
  }

  recordPriceHistory(payload: {
    productId: number;
    unitPrice: number;
    quantity?: number;
    totalPrice?: number | null;
    storeName?: string;
    purchasedDate?: string;
    receiptId?: number | null;
    receiptItemId?: number | null;
  }) {
    const unitPrice = Math.round(Number(payload.unitPrice) * 100) / 100;
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return;
    const qty = Math.max(0.01, Number(payload.quantity) || 1);
    const totalPrice =
      payload.totalPrice !== undefined && payload.totalPrice !== null && Number.isFinite(Number(payload.totalPrice))
        ? Math.round(Number(payload.totalPrice) * 100) / 100
        : Math.round(unitPrice * qty * 100) / 100;
    const purchasedDate = payload.purchasedDate?.trim() || todayIso();

    this.db
      .prepare(
        `INSERT INTO price_history (
           product_id, receipt_id, receipt_item_id, store_name, unit_price, quantity, total_price, purchased_date
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        payload.productId,
        payload.receiptId ?? null,
        payload.receiptItemId ?? null,
        (payload.storeName || '').trim(),
        unitPrice,
        qty,
        totalPrice,
        purchasedDate
      );
  }

  linkReceiptItemToProduct(
    receiptItemId: number,
    productId: number,
    overrides?: { unitPrice?: number | null; quantity?: number }
  ) {
    const ri = this.db
      .prepare(
        `SELECT ri.*, r.store_name, r.purchase_date
         FROM receipt_items ri
         INNER JOIN receipts r ON r.id = ri.receipt_id
         WHERE ri.id = ?`
      )
      .get(receiptItemId) as any;
    if (!ri) throw new Error(`Receipt item #${receiptItemId} not found`);

    const prod = this.db.prepare('SELECT id, name FROM products WHERE id = ?').get(productId) as
      | { id: number; name: string }
      | undefined;
    if (!prod) throw new Error(`Product #${productId} not found`);

    this.db
      .prepare('UPDATE receipt_items SET matched_product_id = ?, stock_added = 1 WHERE id = ?')
      .run(productId, receiptItemId);

    const unitPrice =
      overrides?.unitPrice !== undefined && overrides.unitPrice !== null && Number(overrides.unitPrice) > 0
        ? Number(overrides.unitPrice)
        : ri.unit_price !== null && Number(ri.unit_price) > 0
        ? Number(ri.unit_price)
        : ri.total_price !== null && Number(ri.total_price) > 0
        ? Number(ri.total_price) / Math.max(1, Number(ri.quantity || 1))
        : null;

    if (unitPrice !== null) {
      const existingHistory = this.db
        .prepare('SELECT id FROM price_history WHERE receipt_item_id = ? LIMIT 1')
        .get(receiptItemId);
      if (!existingHistory) {
        this.recordPriceHistory({
          productId,
          receiptId: ri.receipt_id,
          receiptItemId,
          storeName: ri.store_name || '',
          unitPrice,
          quantity: overrides?.quantity ?? Number(ri.quantity || 1),
          totalPrice: ri.total_price,
          purchasedDate: ri.purchase_date || todayIso(),
        });
      }
    }

    return {
      id: receiptItemId,
      matched_product_id: productId,
      matched_product_name: prod.name,
      stock_added: 1,
    };
  }

  getProductPriceHistory(productId: number) {
    const history = this.db
      .prepare(
        `SELECT id, product_id, receipt_id, receipt_item_id, store_name, unit_price, quantity, total_price, purchased_date, created_at
         FROM price_history
         WHERE product_id = ?
         ORDER BY purchased_date DESC, id DESC
         LIMIT 50`
      )
      .all(productId) as Array<{
      id: number;
      product_id: number;
      receipt_id: number | null;
      receipt_item_id: number | null;
      store_name: string;
      unit_price: number;
      quantity: number;
      total_price: number | null;
      purchased_date: string;
      created_at: string;
    }>;

    if (history.length === 0) {
      return {
        product_id: productId,
        count: 0,
        latest_price: null,
        previous_price: null,
        min_price: null,
        max_price: null,
        avg_price: null,
        price_change: null,
        price_change_pct: null,
        history: [],
      };
    }

    const prices = history.map((h) => Number(h.unit_price));
    const latest = prices[0];
    const previous = prices.length > 1 ? prices[1] : null;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100;
    const priceChange = previous !== null ? Math.round((latest - previous) * 100) / 100 : null;
    const priceChangePct =
      previous !== null && previous > 0
        ? Math.round(((latest - previous) / previous) * 1000) / 10
        : null;

    return {
      product_id: productId,
      count: history.length,
      latest_price: latest,
      previous_price: previous,
      min_price: min,
      max_price: max,
      avg_price: avg,
      price_change: priceChange,
      price_change_pct: priceChangePct,
      history,
    };
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

  // ─── Recipes & Meal Planning ─────────────────────────────────

  private resolveProductIdByName(name: string): number | null {
    const clean = name.trim().toLowerCase();
    if (!clean) return null;
    const exact = this.db
      .prepare('SELECT id FROM products WHERE LOWER(name) = ? LIMIT 1')
      .get(clean) as { id: number } | undefined;
    if (exact) return exact.id;
    // Try substring match when query is specific enough (>= 4 chars)
    if (clean.length >= 4) {
      const partial = this.db
        .prepare('SELECT id FROM products WHERE LOWER(name) LIKE ? ORDER BY LENGTH(name) ASC LIMIT 1')
        .get(`%${clean}%`) as { id: number } | undefined;
      if (partial) return partial.id;
    }
    return null;
  }

  private enrichRecipes(recipeRows: any[]) {
    if (recipeRows.length === 0) return [];
    const alertCfg = this.getAlertSettings();
    const dueSoonDays = alertCfg.expiring_soon_days;
    const today = todayIso();
    const soonCutoff = addDaysIso(dueSoonDays);

    const stockOverview = this.getStockOverview();
    const stockByProductId = new Map<number, any>(
      stockOverview.map((s) => [Number(s.product_id), s])
    );
    const productsAll = this.db
      .prepare('SELECT id, name, location_id, picture_file_name FROM products')
      .all() as Array<{ id: number; name: string; location_id: number; picture_file_name: string | null }>;
    const productById = new Map(productsAll.map((p) => [p.id, p]));
    const productByLowerName = new Map(productsAll.map((p) => [p.name.trim().toLowerCase(), p]));

    const allIngs = this.db
      .prepare('SELECT * FROM recipe_ingredients ORDER BY id ASC')
      .all() as any[];
    const ingsByRecipe = new Map<number, any[]>();
    for (const ing of allIngs) {
      const arr = ingsByRecipe.get(ing.recipe_id) || [];
      arr.push(ing);
      ingsByRecipe.set(ing.recipe_id, arr);
    }

    const openShoppingRows = this.db
      .prepare('SELECT id, product_id, note, amount, recipe_names FROM shopping_list WHERE done = 0')
      .all() as Array<{
        id: number;
        product_id: number | null;
        note: string | null;
        amount: number;
        recipe_names: string | null;
      }>;
    const shopByProductId = new Map<number, { amount: number; recipes: string[] }>();
    const shopByLowerName = new Map<string, { amount: number; recipes: string[] }>();
    for (const sr of openShoppingRows) {
      const recNames = this.parseRecipeNames(sr.recipe_names);
      const entry = { amount: Number(sr.amount || 0), recipes: recNames };
      if (sr.product_id) {
        shopByProductId.set(Number(sr.product_id), entry);
      }
      const cleanNote = String(sr.note || '')
        .split(' — ')[0]
        .replace(/\s*\([^)]*\)\s*$/, '')
        .trim()
        .toLowerCase();
      if (cleanNote) {
        shopByLowerName.set(cleanNote, entry);
      }
    }

    return recipeRows.map((r) => {
      const rawIngs = ingsByRecipe.get(r.id) || [];
      let inStockCount = 0;
      let missingCount = 0;
      let urgentCount = 0;
      let overdueCount = 0;
      let dueSoonCount = 0;
      let openedCount = 0;
      let urgencyScore = 0;

      const ingredients = rawIngs.map((ing) => {
        let linkedProd = ing.product_id ? productById.get(Number(ing.product_id)) : undefined;
        let autoMatched = false;
        if (!linkedProd && ing.ingredient_name) {
          const byName = productByLowerName.get(String(ing.ingredient_name).trim().toLowerCase());
          if (byName) {
            linkedProd = byName;
            autoMatched = true;
          }
        }
        const st = linkedProd ? stockByProductId.get(linkedProd.id) : undefined;
        const stockAmount = st ? Number(st.amount || 0) : 0;
        const inStock = stockAmount > 0;
        const isOptional = Boolean(ing.optional);

        let dueStatus: 'overdue' | 'soon' | 'opened' | 'fresh' | 'none' = 'none';
        let bestBefore: string | null = null;

        if (inStock && st) {
          inStockCount++;
          const bbd = st.best_before_date && st.best_before_date !== NEVER_EXPIRES ? st.best_before_date : null;
          bestBefore = bbd;
          const isOpened = Number(st.amount_opened || 0) > 0;
          const openedExpired = Boolean(st.opened_use_by_date && st.opened_use_by_date <= today);
          if ((bbd && bbd < today) || openedExpired) {
            dueStatus = 'overdue';
            overdueCount++;
            urgentCount++;
            urgencyScore += 5;
          } else if (bbd && bbd <= soonCutoff) {
            dueStatus = 'soon';
            dueSoonCount++;
            urgentCount++;
            urgencyScore += 3;
          } else if (isOpened) {
            dueStatus = 'opened';
            openedCount++;
            urgentCount++;
            urgencyScore += 2;
          } else {
            dueStatus = 'fresh';
          }
        } else if (!isOptional) {
          missingCount++;
        }

        const displayIngName = String(ing.ingredient_name || linkedProd?.name || '');
        const shopMatch =
          (linkedProd ? shopByProductId.get(linkedProd.id) : undefined) ||
          shopByLowerName.get(displayIngName.trim().toLowerCase());
        const inShoppingList = Boolean(shopMatch);
        const inShoppingListForRecipe = Boolean(
          shopMatch &&
            shopMatch.recipes.some(
              (rn) => rn.toLowerCase() === String(r.name || '').trim().toLowerCase()
            )
        );

        return {
          id: Number(ing.id),
          recipe_id: Number(ing.recipe_id),
          product_id: linkedProd ? linkedProd.id : null,
          product_name: linkedProd ? linkedProd.name : null,
          auto_matched: autoMatched,
          ingredient_name: displayIngName,
          amount: Number(ing.amount || 1),
          unit: String(ing.unit || ''),
          note: String(ing.note || ''),
          optional: isOptional,
          in_stock: inStock,
          stock_amount: stockAmount,
          best_before_date: bestBefore,
          due_status: dueStatus,
          in_shopping_list: inShoppingList,
          in_shopping_list_for_recipe: inShoppingListForRecipe,
          shopping_list_amount: shopMatch ? shopMatch.amount : 0,
        };
      });

      const requiredTotal = ingredients.filter((i) => !i.optional).length;
      const requiredInStock = ingredients.filter((i) => !i.optional && i.in_stock).length;
      const coveragePct =
        requiredTotal > 0 ? Math.round((requiredInStock / requiredTotal) * 100) : ingredients.length > 0 ? 100 : 0;

      return {
        id: Number(r.id),
        name: String(r.name || ''),
        description: String(r.description || ''),
        instructions: String(r.instructions || ''),
        servings: Number(r.servings || 2),
        prep_minutes: r.prep_minutes != null ? Number(r.prep_minutes) : null,
        cook_minutes: r.cook_minutes != null ? Number(r.cook_minutes) : null,
        tags: String(r.tags || ''),
        source_url: String(r.source_url || ''),
        photo_file_name: r.photo_file_name || null,
        row_created_timestamp: r.row_created_timestamp,
        updated_at: r.updated_at,
        total_ingredients: ingredients.length,
        in_stock_count: inStockCount,
        missing_count: missingCount,
        coverage_pct: coveragePct,
        urgent_ingredient_count: urgentCount,
        overdue_ingredient_count: overdueCount,
        due_soon_ingredient_count: dueSoonCount,
        opened_ingredient_count: openedCount,
        urgency_score: urgencyScore,
        ingredients,
      };
    });
  }

  listRecipes(opts?: { sort?: string; q?: string }) {
    const rows = this.db.prepare('SELECT * FROM recipes ORDER BY id DESC').all() as any[];
    let enriched = this.enrichRecipes(rows);

    const q = (opts?.q || '').trim().toLowerCase();
    if (q) {
      enriched = enriched.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          r.tags.toLowerCase().includes(q) ||
          r.ingredients.some(
            (i) =>
              i.ingredient_name.toLowerCase().includes(q) ||
              (i.product_name && i.product_name.toLowerCase().includes(q))
          )
      );
    }

    const sort = (opts?.sort || 'urgent').toLowerCase();
    if (sort === 'coverage') {
      enriched.sort(
        (a, b) =>
          b.coverage_pct - a.coverage_pct ||
          b.urgency_score - a.urgency_score ||
          a.name.localeCompare(b.name)
      );
    } else if (sort === 'name') {
      enriched.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === 'recent') {
      enriched.sort((a, b) => b.id - a.id);
    } else {
      // 'urgent': prioritize recipes using the most expired / due-soon / opened ingredients
      enriched.sort(
        (a, b) =>
          b.urgency_score - a.urgency_score ||
          b.urgent_ingredient_count - a.urgent_ingredient_count ||
          b.coverage_pct - a.coverage_pct ||
          a.name.localeCompare(b.name)
      );
    }

    return enriched;
  }

  getRecipe(recipeId: number) {
    const row = this.db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipeId);
    if (!row) return null;
    return this.enrichRecipes([row])[0] || null;
  }

  createRecipe(
    payload: {
      name: string;
      description?: string;
      instructions?: string;
      servings?: number;
      prep_minutes?: number | null;
      cook_minutes?: number | null;
      tags?: string;
      source_url?: string;
      photo_file_name?: string | null;
      ingredients?: Array<{
        product_id?: number | null;
        product_name?: string;
        ingredient_name?: string;
        amount?: number;
        unit?: string;
        note?: string;
        optional?: boolean | number;
      }>;
    },
    userId?: number | null
  ) {
    const name = String(payload.name || '').trim();
    if (!name) throw new Error('Recipe name is required');

    const servings =
      payload.servings !== undefined && Number.isFinite(Number(payload.servings)) && Number(payload.servings) > 0
        ? Number(payload.servings)
        : 2;
    const prepMinutes =
      payload.prep_minutes !== undefined && payload.prep_minutes !== null && Number.isFinite(Number(payload.prep_minutes))
        ? Math.max(0, Math.round(Number(payload.prep_minutes)))
        : null;
    const cookMinutes =
      payload.cook_minutes !== undefined && payload.cook_minutes !== null && Number.isFinite(Number(payload.cook_minutes))
        ? Math.max(0, Math.round(Number(payload.cook_minutes)))
        : null;

    const info = this.db
      .prepare(
        `INSERT INTO recipes
           (name, description, instructions, servings, prep_minutes, cook_minutes, tags, source_url, photo_file_name, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        name,
        String(payload.description || '').trim(),
        String(payload.instructions || '').trim(),
        servings,
        prepMinutes,
        cookMinutes,
        String(payload.tags || '').trim(),
        String(payload.source_url || '').trim(),
        payload.photo_file_name || null,
        userId ?? null
      );

    const recipeId = Number(info.lastInsertRowid);
    this.replaceRecipeIngredients(recipeId, payload.ingredients || []);

    this.logActivity({
      itemLabel: name,
      amount: 0,
      transactionType: 'recipe_create',
      note: `${(payload.ingredients || []).length} ingredients`,
      userId,
    });

    return this.getRecipe(recipeId)!;
  }

  private replaceRecipeIngredients(
    recipeId: number,
    ingredients: Array<{
      product_id?: number | null;
      product_name?: string;
      ingredient_name?: string;
      amount?: number;
      unit?: string;
      note?: string;
      optional?: boolean | number;
    }>
  ) {
    this.db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?').run(recipeId);
    const ins = this.db.prepare(
      `INSERT INTO recipe_ingredients
         (recipe_id, product_id, ingredient_name, amount, unit, note, optional)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const raw of ingredients) {
      let productId: number | null =
        raw.product_id && Number.isFinite(Number(raw.product_id)) && Number(raw.product_id) > 0
          ? Number(raw.product_id)
          : null;
      const explicitName = String(raw.ingredient_name || raw.product_name || '').trim();
      if (!productId && (raw.product_name || explicitName)) {
        productId = this.resolveProductIdByName(String(raw.product_name || explicitName));
      }
      let prodName = explicitName;
      if (productId) {
        const p = this.db
          .prepare('SELECT id, name FROM products WHERE id = ?')
          .get(productId) as { id: number; name: string } | undefined;
        if (!p) {
          productId = null;
        } else if (!prodName) {
          prodName = p.name;
        }
      }
      if (!prodName) continue;
      const amt =
        raw.amount !== undefined && Number.isFinite(Number(raw.amount)) && Number(raw.amount) > 0
          ? Number(raw.amount)
          : 1;
      ins.run(
        recipeId,
        productId,
        prodName,
        amt,
        String(raw.unit || '').trim(),
        String(raw.note || '').trim(),
        raw.optional ? 1 : 0
      );
    }
  }

  updateRecipe(
    recipeId: number,
    payload: {
      name?: string;
      description?: string;
      instructions?: string;
      servings?: number;
      prep_minutes?: number | null;
      cook_minutes?: number | null;
      tags?: string;
      source_url?: string;
      photo_file_name?: string | null;
      ingredients?: Array<{
        product_id?: number | null;
        product_name?: string;
        ingredient_name?: string;
        amount?: number;
        unit?: string;
        note?: string;
        optional?: boolean | number;
      }>;
    },
    userId?: number | null
  ) {
    const existing = this.db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipeId) as any;
    if (!existing) throw new Error(`Recipe #${recipeId} not found`);

    const nextName =
      payload.name !== undefined ? String(payload.name || '').trim() || existing.name : existing.name;
    const nextDesc =
      payload.description !== undefined ? String(payload.description || '').trim() : existing.description;
    const nextInstr =
      payload.instructions !== undefined ? String(payload.instructions || '').trim() : existing.instructions;
    const nextServings =
      payload.servings !== undefined && Number.isFinite(Number(payload.servings)) && Number(payload.servings) > 0
        ? Number(payload.servings)
        : existing.servings;
    const nextPrep =
      payload.prep_minutes !== undefined
        ? payload.prep_minutes === null || !Number.isFinite(Number(payload.prep_minutes))
          ? null
          : Math.max(0, Math.round(Number(payload.prep_minutes)))
        : existing.prep_minutes;
    const nextCook =
      payload.cook_minutes !== undefined
        ? payload.cook_minutes === null || !Number.isFinite(Number(payload.cook_minutes))
          ? null
          : Math.max(0, Math.round(Number(payload.cook_minutes)))
        : existing.cook_minutes;
    const nextTags = payload.tags !== undefined ? String(payload.tags || '').trim() : existing.tags;
    const nextSource =
      payload.source_url !== undefined ? String(payload.source_url || '').trim() : existing.source_url;
    const nextPhoto =
      payload.photo_file_name !== undefined ? payload.photo_file_name : existing.photo_file_name;

    this.db
      .prepare(
        `UPDATE recipes
         SET name = ?, description = ?, instructions = ?, servings = ?,
             prep_minutes = ?, cook_minutes = ?, tags = ?, source_url = ?,
             photo_file_name = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        nextName,
        nextDesc,
        nextInstr,
        nextServings,
        nextPrep,
        nextCook,
        nextTags,
        nextSource,
        nextPhoto,
        recipeId
      );

    if (payload.photo_file_name !== undefined && existing.photo_file_name && existing.photo_file_name !== nextPhoto) {
      this.cleanupPhotoIfUnused(existing.photo_file_name);
    }

    if (Array.isArray(payload.ingredients)) {
      this.replaceRecipeIngredients(recipeId, payload.ingredients);
    }

    this.logActivity({
      itemLabel: nextName,
      amount: 0,
      transactionType: 'recipe_edit',
      userId,
    });

    return this.getRecipe(recipeId)!;
  }

  deleteRecipe(recipeId: number, userId?: number | null) {
    const existing = this.db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipeId) as any;
    if (!existing) throw new Error(`Recipe #${recipeId} not found`);

    this.db.prepare('DELETE FROM recipes WHERE id = ?').run(recipeId);
    if (existing.photo_file_name) {
      this.cleanupPhotoIfUnused(existing.photo_file_name);
    }
    this.logActivity({
      itemLabel: existing.name,
      amount: 0,
      transactionType: 'recipe_delete',
      userId,
    });
    return { deleted: true, id: recipeId, name: existing.name };
  }

  addRecipeMissingToShopping(
    recipeId: number,
    ingredientIds?: number[],
    userId?: number | null
  ): { added: number; items: string[] } {
    const recipe = this.getRecipe(recipeId);
    if (!recipe) throw new Error(`Recipe #${recipeId} not found`);

    const openShopping = this.db
      .prepare('SELECT id, product_id, note, amount, unit, recipe_names FROM shopping_list WHERE done = 0')
      .all() as Array<{
        id: number;
        product_id: number | null;
        note: string | null;
        amount: number;
        unit: string | null;
        recipe_names: string | null;
      }>;

    const isExplicitSelection = Array.isArray(ingredientIds) && ingredientIds.length > 0;
    const targets = isExplicitSelection
      ? recipe.ingredients.filter((i) => ingredientIds!.includes(i.id))
      : recipe.ingredients.filter((i) => !i.in_stock && !i.optional && !i.in_shopping_list_for_recipe);

    const addedItems: string[] = [];
    for (const ing of targets) {
      const displayLabel = (ing.product_name || ing.ingredient_name).trim();
      if (!displayLabel) continue;
      const lowerLabel = displayLabel.toLowerCase();
      const ingUnit = String(ing.unit || '').trim();
      const addQty = Math.max(0.25, Math.round(Number(ing.amount || 1) * 100) / 100);

      const existing = openShopping.find((s) => {
        if (ing.product_id && s.product_id && Number(s.product_id) === Number(ing.product_id)) {
          return true;
        }
        const cleanNote = String(s.note || '')
          .split(' — ')[0]
          .replace(/\s*\([^)]*\)\s*$/, '')
          .trim()
          .toLowerCase();
        return Boolean(cleanNote && cleanNote === lowerLabel);
      });

      if (existing) {
        const currentRecipes = this.parseRecipeNames(existing.recipe_names);
        const alreadyHasThisRecipe = currentRecipes.some(
          (rn) => rn.toLowerCase() === recipe.name.toLowerCase()
        );
        if (!isExplicitSelection && alreadyHasThisRecipe) {
          continue;
        }
        const nextRecipes = alreadyHasThisRecipe
          ? currentRecipes
          : [...currentRecipes, recipe.name];
        const nextAmount = Math.round((Number(existing.amount || 0) + addQty) * 100) / 100;
        const cleanExistingNote = existing.product_id ? '' : displayLabel;
        const nextUnit = String(existing.unit || '').trim() || ingUnit;

        this.db
          .prepare('UPDATE shopping_list SET amount = ?, note = ?, unit = ?, recipe_names = ? WHERE id = ?')
          .run(nextAmount, cleanExistingNote, nextUnit, JSON.stringify(nextRecipes), existing.id);

        existing.amount = nextAmount;
        existing.note = cleanExistingNote;
        existing.unit = nextUnit;
        existing.recipe_names = JSON.stringify(nextRecipes);
      } else {
        const cleanNote = ing.product_id ? '' : displayLabel;
        const nextRecipesJson = JSON.stringify([recipe.name]);
        const info = this.db
          .prepare(
            `INSERT INTO shopping_list (product_id, note, amount, unit, shopping_list_id, done, added_by_user_id, recipe_names)
             VALUES (?, ?, ?, ?, 1, 0, ?, ?)`
          )
          .run(ing.product_id || null, cleanNote, addQty, ingUnit, userId ?? null, nextRecipesJson);

        openShopping.push({
          id: Number(info.lastInsertRowid),
          product_id: ing.product_id || null,
          note: cleanNote,
          amount: addQty,
          unit: ingUnit,
          recipe_names: nextRecipesJson,
        });
      }

      this.logActivity({
        productId: ing.product_id || null,
        itemLabel: displayLabel,
        amount: addQty,
        transactionType: 'shopping_add',
        note: `Recipe: ${recipe.name}`,
        userId,
      });
      this.recordShoppingListNotification(userId ?? null, displayLabel);
      addedItems.push(displayLabel);
    }

    return { added: addedItems.length, items: addedItems };
  }
}
