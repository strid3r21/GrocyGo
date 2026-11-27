import http from 'node:http';
import path from 'node:path';
import { startDailyBackupScheduler } from './backups';
import { initDatabase } from './db';
import { createRequestHandler } from './grocyApi';
import { InventoryService } from './inventoryService';

const PORT = Number(process.env.PORT || 9283);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));

export function startDailyExpiringSoonScheduler(service: InventoryService): NodeJS.Timeout {
  const check = () => {
    try {
      const cfg = service.getAlertSettings();
      if (!cfg.expiring_soon_enabled) return;
      const now = new Date();
      if (now.getHours() < cfg.expiring_soon_hour) return;
      const res = service.runDailyExpiringSoonCheck(cfg.expiring_soon_days, false);
      if (res.notified) {
        console.log(`[GrocyGo] Sent daily expiring-soon alert: ${res.body}`);
      }
    } catch (err) {
      console.error('[GrocyGo] Daily expiring-soon check failed:', err);
    }
  };

  // Check once shortly after startup, then every 30 minutes
  setTimeout(check, 5000).unref();
  const timer = setInterval(check, 30 * 60 * 1000);
  timer.unref();
  return timer;
}

export function startServer(port = PORT, host = HOST, dataDir = DATA_DIR) {
  const ctx = initDatabase(dataDir);
  const service = new InventoryService(ctx);
  const backupTimer = startDailyBackupScheduler(ctx);
  const expiringTimer = startDailyExpiringSoonScheduler(service);
  const handler = createRequestHandler(ctx, service);
  const server = http.createServer(handler);

  server.listen(port, host, () => {
    console.log('');
    console.log('====================================================');
    console.log('  GrocyGo Server v2.4.0 (Food Inventory + MCP)');
    console.log('====================================================');
    console.log(`  Web UI & API : http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    console.log(`  MCP Endpoint : http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/mcp`);
    console.log(`  Data Dir     : ${dataDir}`);
    if (ctx.initialAdminPassword) {
      console.log(`  Admin Login  : ${process.env.INITIAL_ADMIN_USER || 'admin'} / ${ctx.initialAdminPassword}`);
    }
    if (ctx.initialApiKey) {
      console.log(`  Initial Key  : ${ctx.initialApiKey}`);
    }
    console.log('====================================================');
    console.log('');
  });

  const shutdown = () => {
    clearInterval(backupTimer);
    clearInterval(expiringTimer);
    server.close(() => {
      try {
        ctx.db.close();
      } catch {
        // ignore
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { server, ctx, service };
}

if (require.main === module) {
  startServer();
}
