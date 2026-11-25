import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface DbContext {
  db: DatabaseSync;
  dataDir: string;
  photosDir: string;
  initialApiKey: string | null;
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

    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
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
      row_created_timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stock_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      transaction_type TEXT NOT NULL,
      location_id INTEGER,
      spoiled INTEGER NOT NULL DEFAULT 0,
      note TEXT DEFAULT '',
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
      row_created_timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_stock_product ON stock(product_id);
    CREATE INDEX IF NOT EXISTS idx_stock_location ON stock(location_id);
    CREATE INDEX IF NOT EXISTS idx_barcodes_code ON product_barcodes(barcode);
    CREATE INDEX IF NOT EXISTS idx_shopping_list_list ON shopping_list(shopping_list_id);
  `);

  // Safe migration for existing databases missing storage_photo_file_name
  const prodCols = db.prepare('PRAGMA table_info(products)').all() as Array<{ name: string }>;
  if (!prodCols.some((c) => c.name === 'storage_photo_file_name')) {
    db.exec('ALTER TABLE products ADD COLUMN storage_photo_file_name TEXT DEFAULT NULL;');
  }

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

  // Ensure at least one API key exists
  let initialApiKey: string | null = null;
  const keyCount = (db.prepare('SELECT COUNT(*) as c FROM api_keys').get() as { c: number }).c;
  if (keyCount === 0) {
    initialApiKey =
      process.env.INITIAL_API_KEY?.trim() ||
      `gg_${crypto.randomBytes(24).toString('base64url')}`;
    db.prepare('INSERT INTO api_keys (api_key, description) VALUES (?, ?)').run(
      initialApiKey,
      'Initial Default Key'
    );
  } else if (process.env.INITIAL_API_KEY?.trim()) {
    const envKey = process.env.INITIAL_API_KEY.trim();
    const exists = db.prepare('SELECT id FROM api_keys WHERE api_key = ?').get(envKey);
    if (!exists) {
      db.prepare('INSERT INTO api_keys (api_key, description) VALUES (?, ?)').run(
        envKey,
        'Configured via INITIAL_API_KEY'
      );
    }
  }

  return { db, dataDir, photosDir, initialApiKey };
}
