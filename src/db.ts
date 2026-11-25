import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { generateApiKey, generateTempPassword, hashPassword } from './auth';

export interface DbContext {
  db: DatabaseSync;
  dataDir: string;
  photosDir: string;
  initialApiKey: string | null;
  initialAdminPassword: string | null;
}

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

export function initDatabase(dataDir: string): DbContext {
  fs.mkdirSync(dataDir, { recursive: true });
  const photosDir = path.join(dataDir, 'photos');
  fs.mkdirSync(photosDir, { recursive: true });

  const dbPath = path.join(dataDir, 'grocygo.db');
  const db = new DatabaseSync(dbPath);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      is_freezer INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      row_created_timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS quantity_units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      name_plural TEXT DEFAULT '',
      description TEXT DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      row_created_timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS product_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      row_created_timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shopping_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      row_created_timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      product_group_id INTEGER REFERENCES product_groups(id) ON DELETE SET NULL,
      active INTEGER NOT NULL DEFAULT 1,
      location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
      shopping_location_id INTEGER REFERENCES shopping_locations(id) ON DELETE SET NULL,
      qu_id_purchase INTEGER NOT NULL REFERENCES quantity_units(id) ON DELETE RESTRICT,
      qu_id_stock INTEGER NOT NULL REFERENCES quantity_units(id) ON DELETE RESTRICT,
      qu_factor_purchase_to_stock REAL NOT NULL DEFAULT 1,
      min_stock_amount REAL NOT NULL DEFAULT 0,
      default_best_before_days INTEGER NOT NULL DEFAULT 0,
      default_best_before_days_after_open INTEGER NOT NULL DEFAULT 0,
      picture_file_name TEXT DEFAULT NULL,
      storage_photo_file_name TEXT DEFAULT NULL,
      due_type INTEGER NOT NULL DEFAULT 1,
      row_created_timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS product_barcodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      barcode TEXT NOT NULL UNIQUE,
      qu_id INTEGER REFERENCES quantity_units(id) ON DELETE SET NULL,
      amount REAL DEFAULT NULL,
      shopping_location_id INTEGER REFERENCES shopping_locations(id) ON DELETE SET NULL,
      note TEXT DEFAULT '',
      row_created_timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      best_before_date TEXT DEFAULT '2999-12-31',
      purchased_date TEXT NOT NULL DEFAULT (date('now')),
      stock_id TEXT NOT NULL,
      price REAL DEFAULT NULL,
      open INTEGER NOT NULL DEFAULT 0,
      opened_date TEXT DEFAULT NULL,
      location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
      shopping_location_id INTEGER REFERENCES shopping_locations(id) ON DELETE SET NULL,
      note TEXT DEFAULT '',
      photo_file_name TEXT DEFAULT NULL,
      added_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      row_created_timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stock_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER,
      item_label TEXT DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      transaction_type TEXT NOT NULL,
      location_id INTEGER,
      spoiled INTEGER NOT NULL DEFAULT 0,
      note TEXT DEFAULT '',
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      row_created_timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shopping_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      row_created_timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shopping_list (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      note TEXT DEFAULT '',
      amount REAL NOT NULL DEFAULT 1,
      shopping_list_id INTEGER NOT NULL DEFAULT 1 REFERENCES shopping_lists(id) ON DELETE CASCADE,
      done INTEGER NOT NULL DEFAULT 0,
      qu_id INTEGER REFERENCES quantity_units(id) ON DELETE SET NULL,
      added_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      completed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      completed_at TEXT DEFAULT NULL,
      row_created_timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_stock_product ON stock(product_id);
    CREATE INDEX IF NOT EXISTS idx_stock_location ON stock(location_id);
    CREATE INDEX IF NOT EXISTS idx_barcodes_code ON product_barcodes(barcode);
    CREATE INDEX IF NOT EXISTS idx_shopping_list_list ON shopping_list(shopping_list_id);
    CREATE INDEX IF NOT EXISTS idx_stock_log_time ON stock_log(id DESC);
  `);

  // Safe migrations for existing databases
  if (!hasColumn(db, 'products', 'storage_photo_file_name')) {
    db.exec('ALTER TABLE products ADD COLUMN storage_photo_file_name TEXT DEFAULT NULL;');
  }
  if (!hasColumn(db, 'api_keys', 'user_id')) {
    db.exec('ALTER TABLE api_keys ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;');
  }
  if (!hasColumn(db, 'stock', 'added_by_user_id')) {
    db.exec('ALTER TABLE stock ADD COLUMN added_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;');
  }
  if (!hasColumn(db, 'stock_log', 'user_id')) {
    db.exec('ALTER TABLE stock_log ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;');
  }
  if (!hasColumn(db, 'stock_log', 'item_label')) {
    db.exec("ALTER TABLE stock_log ADD COLUMN item_label TEXT DEFAULT '';");
  }
  if (!hasColumn(db, 'shopping_list', 'added_by_user_id')) {
    db.exec('ALTER TABLE shopping_list ADD COLUMN added_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;');
  }
  if (!hasColumn(db, 'shopping_list', 'completed_by_user_id')) {
    db.exec('ALTER TABLE shopping_list ADD COLUMN completed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;');
  }
  if (!hasColumn(db, 'shopping_list', 'completed_at')) {
    db.exec('ALTER TABLE shopping_list ADD COLUMN completed_at TEXT DEFAULT NULL;');
  }

  // Migrate legacy stock_log tables created in v1.1.0 where product_id had a NOT NULL constraint
  const stockLogCols = db.prepare('PRAGMA table_info(stock_log)').all() as Array<{
    name: string;
    notnull: number;
  }>;
  const prodIdCol = stockLogCols.find((c) => c.name === 'product_id');
  if (prodIdCol && prodIdCol.notnull === 1) {
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE stock_log_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER,
        item_label TEXT DEFAULT '',
        amount REAL NOT NULL DEFAULT 0,
        transaction_type TEXT NOT NULL,
        location_id INTEGER,
        spoiled INTEGER NOT NULL DEFAULT 0,
        note TEXT DEFAULT '',
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        row_created_timestamp TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO stock_log_migrated (
        id, product_id, item_label, amount, transaction_type, location_id, spoiled, note, user_id, row_created_timestamp
      )
      SELECT
        id, product_id, COALESCE(item_label, ''), amount, transaction_type, location_id, spoiled, COALESCE(note, ''), user_id, row_created_timestamp
      FROM stock_log;
      DROP TABLE stock_log;
      ALTER TABLE stock_log_migrated RENAME TO stock_log;
      CREATE INDEX IF NOT EXISTS idx_stock_log_time ON stock_log(id DESC);
      COMMIT;
    `);
  }

  // Ensure default admin user exists
  let initialAdminPassword: string | null = null;
  let defaultAdmin = db
    .prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1")
    .get() as { id: number } | undefined;

  if (!defaultAdmin) {
    const adminUsername = (process.env.INITIAL_ADMIN_USER || 'admin').trim();
    initialAdminPassword = process.env.INITIAL_ADMIN_PASSWORD?.trim() || generateTempPassword();
    const info = db
      .prepare(
        'INSERT INTO users (username, display_name, password_hash, role, active) VALUES (?, ?, ?, ?, 1)'
      )
      .run(adminUsername, 'Admin', hashPassword(initialAdminPassword), 'admin');
    defaultAdmin = { id: Number(info.lastInsertRowid) };
  }

  // Attach any legacy API keys without a user_id to defaultAdmin
  db.prepare('UPDATE api_keys SET user_id = ? WHERE user_id IS NULL').run(defaultAdmin.id);

  // Seed default locations
  const locCount = (db.prepare('SELECT COUNT(*) as c FROM locations').get() as { c: number }).c;
  if (locCount === 0) {
    const insertLoc = db.prepare(
      'INSERT INTO locations (name, description, is_freezer) VALUES (?, ?, ?)'
    );
    insertLoc.run('Pantry', 'Dry goods & shelf-stable food', 0);
    insertLoc.run('Fridge', 'Main refrigerator', 0);
    insertLoc.run('Freezer', 'Frozen foods', 1);
  }

  // Seed default quantity units
  const quCount = (db.prepare('SELECT COUNT(*) as c FROM quantity_units').get() as { c: number }).c;
  if (quCount === 0) {
    const insertQu = db.prepare(
      'INSERT INTO quantity_units (name, name_plural) VALUES (?, ?)'
    );
    const defaults: Array<[string, string]> = [
      ['Piece', 'Pieces'],
      ['Pack', 'Packs'],
      ['Bottle', 'Bottles'],
      ['Can', 'Cans'],
      ['Box', 'Boxes'],
      ['Bag', 'Bags'],
      ['Jar', 'Jars'],
      ['g', 'g'],
      ['kg', 'kg'],
      ['ml', 'ml'],
      ['L', 'L'],
      ['oz', 'oz'],
      ['lb', 'lb'],
    ];
    for (const [singular, plural] of defaults) {
      insertQu.run(singular, plural);
    }
  }

  // Seed default product groups
  const groupCount = (db.prepare('SELECT COUNT(*) as c FROM product_groups').get() as { c: number }).c;
  if (groupCount === 0) {
    const insertGroup = db.prepare('INSERT INTO product_groups (name) VALUES (?)');
    for (const name of [
      'Produce',
      'Dairy & Eggs',
      'Meat & Seafood',
      'Pantry Staples',
      'Snacks',
      'Beverages',
      'Frozen',
      'Condiments & Spices',
    ]) {
      insertGroup.run(name);
    }
  }

  // Seed default shopping list
  const listCount = (db.prepare('SELECT COUNT(*) as c FROM shopping_lists').get() as { c: number }).c;
  if (listCount === 0) {
    db.prepare('INSERT INTO shopping_lists (id, name, description) VALUES (1, ?, ?)').run(
      'Shopping List',
      'Primary grocery list'
    );
  }

  // Ensure at least one API key exists (linked to defaultAdmin)
  let initialApiKey: string | null = null;
  const keyCount = (db.prepare('SELECT COUNT(*) as c FROM api_keys').get() as { c: number }).c;
  if (keyCount === 0) {
    initialApiKey = process.env.INITIAL_API_KEY?.trim() || generateApiKey();
    db.prepare('INSERT INTO api_keys (api_key, description, user_id) VALUES (?, ?, ?)').run(
      initialApiKey,
      'Initial Admin Key',
      defaultAdmin.id
    );
  } else if (process.env.INITIAL_API_KEY?.trim()) {
    const envKey = process.env.INITIAL_API_KEY.trim();
    const exists = db.prepare('SELECT id FROM api_keys WHERE api_key = ?').get(envKey);
    if (!exists) {
      db.prepare('INSERT INTO api_keys (api_key, description, user_id) VALUES (?, ?, ?)').run(
        envKey,
        'Configured via INITIAL_API_KEY',
        defaultAdmin.id
      );
    }
  }

  return { db, dataDir, photosDir, initialApiKey, initialAdminPassword };
}
