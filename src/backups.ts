import fs from 'node:fs';
import path from 'node:path';
import { DbContext } from './db';
import { todayIso } from './inventoryService';

export interface BackupFileInfo {
  file_name: string;
  size_bytes: number;
  created_at: string;
}

const DEFAULT_RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 7);

export function getBackupsDir(dataDir: string): string {
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function sanitizeBackupName(raw: string): string | null {
  const base = path.basename(raw);
  if (!/^grocygo-[0-9]{4}-[0-9]{2}-[0-9]{2}(-[0-9]{6})?\.db$/.test(base)) {
    return null;
  }
  return base;
}

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Creates a clean, atomic single-file SQLite backup via VACUUM INTO (safe under WAL mode)
 * and prunes backups older than the retention count (default: last 7 daily backups).
 */
export function createDatabaseBackup(
  ctx: DbContext,
  options: { manual?: boolean; retentionDays?: number } = {}
): BackupFileInfo {
  const backupsDir = getBackupsDir(ctx.dataDir);
  const datePart = todayIso();
  let fileName = `grocygo-${datePart}.db`;

  if (options.manual) {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    fileName = `grocygo-${datePart}-${hh}${mm}${ss}.db`;
  }

  const targetPath = path.join(backupsDir, fileName);
  const tmpPath = `${targetPath}.tmp`;

  try {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    ctx.db.exec(`VACUUM INTO '${escapeSqlString(tmpPath)}'`);
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // ignore cleanup
    }
    throw err;
  }

  pruneOldBackups(ctx.dataDir, options.retentionDays ?? DEFAULT_RETENTION_DAYS);

  const stat = fs.statSync(targetPath);
  return {
    file_name: fileName,
    size_bytes: stat.size,
    created_at: stat.mtime.toISOString(),
  };
}

export function listDatabaseBackups(dataDir: string): BackupFileInfo[] {
  const backupsDir = getBackupsDir(dataDir);
  const files = fs
    .readdirSync(backupsDir)
    .filter((f) => Boolean(sanitizeBackupName(f)))
    .map((fileName) => {
      const stat = fs.statSync(path.join(backupsDir, fileName));
      return {
        file_name: fileName,
        size_bytes: stat.size,
        created_at: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.file_name.localeCompare(a.file_name));

  return files;
}

export function pruneOldBackups(dataDir: string, keepCount = DEFAULT_RETENTION_DAYS): number {
  const keep = Math.max(1, keepCount);
  const backupsDir = getBackupsDir(dataDir);
  const files = fs
    .readdirSync(backupsDir)
    .filter((f) => Boolean(sanitizeBackupName(f)))
    .sort((a, b) => b.localeCompare(a));

  let deleted = 0;
  for (const oldFile of files.slice(keep)) {
    try {
      fs.unlinkSync(path.join(backupsDir, oldFile));
      deleted++;
    } catch {
      // ignore
    }
  }
  return deleted;
}

export function ensureDailyBackup(ctx: DbContext, retentionDays = DEFAULT_RETENTION_DAYS): boolean {
  const backupsDir = getBackupsDir(ctx.dataDir);
  const todayFile = path.join(backupsDir, `grocygo-${todayIso()}.db`);
  if (fs.existsSync(todayFile)) {
    pruneOldBackups(ctx.dataDir, retentionDays);
    return false;
  }
  createDatabaseBackup(ctx, { manual: false, retentionDays });
  return true;
}

export function startDailyBackupScheduler(ctx: DbContext): NodeJS.Timeout {
  const retentionDays = DEFAULT_RETENTION_DAYS;

  const runCheck = () => {
    try {
      const created = ensureDailyBackup(ctx, retentionDays);
      if (created) {
        console.log(`[Backup] Created daily SQLite backup grocygo-${todayIso()}.db (keeping last ${retentionDays})`);
      }
    } catch (err: any) {
      console.error('[Backup] Daily backup failed:', err?.message || err);
    }
  };

  // Run immediately on startup so today's backup exists right away
  runCheck();

  // Check once per hour so daily backups run automatically after midnight
  const timer = setInterval(runCheck, 60 * 60 * 1000);
  timer.unref();
  return timer;
}
