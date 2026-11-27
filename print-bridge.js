#!/usr/bin/env node
/**
 * GrocyGo Authenticated USB Thermal Print Bridge (for iDPRT SP310 & other TSPL printers)
 *
 * Run on the PC where your SP310 is plugged in via USB:
 *   PRINT_BRIDGE_TOKEN=your-secret-token node print-bridge.js
 *
 * Optional env vars:
 *   PRINT_BRIDGE_PORT=9105
 *   PRINTER_DEVICE=/dev/usb/lp0     (direct raw USB device write)
 *   CUPS_PRINTER=SP310              (use CUPS `lp -d SP310 -o raw` instead of PRINTER_DEVICE)
 */

const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const PORT = Number(process.env.PRINT_BRIDGE_PORT || 9105);
const HOST = process.env.PRINT_BRIDGE_HOST || '0.0.0.0';
const TOKEN = (process.env.PRINT_BRIDGE_TOKEN || '').trim() || crypto.randomBytes(16).toString('hex');
const PRINTER_DEVICE = process.env.PRINTER_DEVICE || '/dev/usb/lp0';
const CUPS_PRINTER = (process.env.CUPS_PRINTER || '').trim();
const MAX_BODY_BYTES = 128 * 1024;

function writeRawTspl(tspl) {
  return new Promise((resolve, reject) => {
    if (CUPS_PRINTER) {
      const lp = spawn('lp', ['-d', CUPS_PRINTER, '-o', 'raw']);
      let errOut = '';
      lp.stderr.on('data', (d) => (errOut += d.toString()));
      lp.on('error', reject);
      lp.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(errOut.trim() || `lp exited with code ${code}`));
      });
      lp.stdin.end(Buffer.from(tspl, 'utf8'));
      return;
    }

    fs.writeFile(PRINTER_DEVICE, Buffer.from(tspl, 'utf8'), (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(
      JSON.stringify({
        ok: true,
        service: 'grocygo-print-bridge',
        mode: CUPS_PRINTER ? `cups:${CUPS_PRINTER}` : `usb:${PRINTER_DEVICE}`,
      })
    );
    return;
  }

  if (req.method === 'POST' && req.url === '/print') {
    const provided = String(req.headers['x-print-token'] || '').trim();
    if (!provided || provided !== TOKEN) {
      res.writeHead(401);
      res.end(JSON.stringify({ error_message: 'Invalid or missing X-PRINT-TOKEN' }));
      return;
    }

    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        const tspl = typeof body.tspl === 'string' ? body.tspl : '';
        if (!tspl.trim() || !tspl.includes('PRINT ')) {
          res.writeHead(400);
          res.end(JSON.stringify({ error_message: 'Invalid TSPL payload' }));
          return;
        }
        await writeRawTspl(tspl);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, bytes: Buffer.byteLength(tspl, 'utf8') }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error_message: err.message || 'Printer write failed' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error_message: 'Not found' }));
});

server.listen(PORT, HOST, () => {
  console.log('====================================================');
  console.log('  GrocyGo SP310 USB Print Bridge');
  console.log('====================================================');
  console.log(`  Listening : http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  Target    : ${CUPS_PRINTER ? `CUPS printer "${CUPS_PRINTER}"` : PRINTER_DEVICE}`);
  console.log(`  Token     : ${TOKEN}`);
  console.log('====================================================');
});
