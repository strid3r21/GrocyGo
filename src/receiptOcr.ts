import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

export interface ParsedReceiptItem {
  raw_name: string;
  quantity: number;
  unit_price: number | null;
  total_price: number | null;
}

export interface ParsedReceipt {
  store_name: string;
  purchase_date: string;
  total_amount: number | null;
  items: ParsedReceiptItem[];
}

function todayIsoLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function ocrReceiptImage(imageBuffer: Buffer, cacheDir: string): Promise<string> {
  fs.mkdirSync(cacheDir, { recursive: true });

  // Preprocess receipt image with sharp for much higher OCR accuracy
  let processed = imageBuffer;
  try {
    const meta = await sharp(imageBuffer).metadata();
    let pipeline = sharp(imageBuffer).rotate().grayscale().normalize();
    if (meta.width && meta.width < 1200) {
      pipeline = pipeline.resize({ width: Math.min(1800, meta.width * 2) });
    } else if (meta.width && meta.width > 2200) {
      pipeline = pipeline.resize({ width: 2000 });
    }
    processed = await pipeline.sharpen().png().toBuffer();
  } catch {
    processed = imageBuffer;
  }

  const worker = await createWorker('eng', 1, {
    cachePath: cacheDir,
    logger: () => {},
  });
  try {
    const {
      data: { text },
    } = await worker.recognize(processed);
    return String(text || '').trim();
  } finally {
    await worker.terminate().catch(() => {});
  }
}

const SKIP_LINE_RE =
  /\b(sub\s*total|subtotal|total|tax|sales\s*tax|hst|gst|vat|balance|change\s*due|change|cash|visa|mastercard|amex|discover|debit|credit|tender|card|auth|approval|chip|swipe|aid|tvr|tsi|ref\s*#|trans\s*#|store\s*#|register|cashier|clerk|terminal|receipt|thank\s*you|welcome|survey|rewards|points|member|savings|you\s*saved|items\s*sold|number\s*of\s*items|date|time|tel|phone|www\.|http|\.com)\b/i;

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function extractDate(lines: string[]): string {
  for (const line of lines) {
    // YYYY-MM-DD or YYYY/MM/DD
    const iso = line.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
    if (iso) {
      const y = Number(iso[1]);
      const m = Number(iso[2]);
      const d = Number(iso[3]);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
    // MM/DD/YYYY or MM/DD/YY or MM-DD-YYYY
    const us = line.match(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2}|\d{2})\b/);
    if (us) {
      const m = Number(us[1]);
      const d = Number(us[2]);
      let y = Number(us[3]);
      if (y < 100) y += 2000;
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2020 && y <= 2035) {
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
    // Mon DD, YYYY
    const named = line.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})\b/i);
    if (named) {
      const m = MONTH_MAP[named[1].toLowerCase().slice(0, 3)];
      const d = Number(named[2]);
      const y = Number(named[3]);
      if (m && d >= 1 && d <= 31) {
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
  }
  return todayIsoLocal();
}

function extractStoreName(lines: string[]): string {
  for (const raw of lines.slice(0, 6)) {
    const clean = raw.replace(/[^a-zA-Z0-9 '&.-]/g, '').trim();
    if (clean.length < 3 || clean.length > 42) continue;
    if (/^\d+$/.test(clean)) continue;
    if (/\d{3}[-.\s]\d{3}[-.\s]\d{4}/.test(clean)) continue;
    if (/\b(street|st\.|ave|avenue|blvd|road|rd\.|dr\.|drive|suite|ste|zip|receipt|welcome|store\s*#)\b/i.test(clean)) {
      continue;
    }
    if (/[a-zA-Z]{3,}/.test(clean)) {
      return clean;
    }
  }
  return '';
}

export function parseReceiptText(rawText: string): ParsedReceipt {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const store_name = extractStoreName(lines);
  const purchase_date = extractDate(lines);
  let total_amount: number | null = null;
  const items: ParsedReceiptItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Capture TOTAL amount
    const totalMatch = line.match(/\b(?:grand\s*)?(?:total|balance\s*due|amount\s*due)\b[^0-9]*\$?\s*(\d{1,5}[.,]\d{2})\b/i);
    if (totalMatch && !/sub\s*total/i.test(line)) {
      const val = Number(totalMatch[1].replace(',', '.'));
      if (Number.isFinite(val) && val > 0) {
        total_amount = val;
      }
      continue;
    }

    // Standalone "2 @ 3.49" or "2 @ $3.49   6.98" modifier line
    const qtyAtMatch = line.match(/^(\d+(?:\.\d+)?)\s*(?:@|x|at)\s*\$?(\d{1,4}[.,]\d{2})(?:\s+\$?(\d{1,5}[.,]\d{2}))?/i);
    if (qtyAtMatch) {
      const qty = Number(qtyAtMatch[1]);
      const unitP = Number(qtyAtMatch[2].replace(',', '.'));
      const totP = qtyAtMatch[3]
        ? Number(qtyAtMatch[3].replace(',', '.'))
        : Math.round(qty * unitP * 100) / 100;
      if (items.length > 0 && qty > 0 && Number.isFinite(unitP)) {
        const prev = items[items.length - 1];
        prev.quantity = qty;
        prev.unit_price = unitP;
        prev.total_price = totP;
      }
      continue;
    }

    if (SKIP_LINE_RE.test(line)) continue;

    // Match line ending with a price, optionally followed by a 1-2 char tax flag (F, T, N, A, B, etc.)
    const priceLine = line.match(/^(.+?)\s+(-?\$?\d{1,4}[.,]\d{2})(?:\s+[A-Za-z]{1,2})?$/);
    if (!priceLine) continue;

    let namePart = priceLine[1].trim();
    const rawPrice = Number(priceLine[2].replace('$', '').replace(',', '.'));
    if (!Number.isFinite(rawPrice) || rawPrice <= 0 || rawPrice > 999) continue;

    // Skip discount / coupon lines
    if (/\b(discount|coupon|mfr|off|rebate|void|refund)\b/i.test(namePart)) continue;

    // Strip leading SKU / item code numbers like "004122057646 " or "123456 "
    namePart = namePart.replace(/^\d{5,}\s+/, '').trim();

    let quantity = 1;
    let unit_price: number | null = rawPrice;
    const total_price = rawPrice;

    // Check inline "2x MILK" or "2 @ 3.49 MILK" or "2 MILK"
    const inlineQtyAt = namePart.match(/^(\d+)\s*@\s*\$?(\d{1,4}[.,]\d{2})\s+(.+)$/i);
    const inlinePrefixQty = namePart.match(/^(\d+)\s*[xX*]\s+(.+)$/);
    const inlineNumPrefix = namePart.match(/^(\d{1,2})\s+([A-Za-z].{2,})$/);

    if (inlineQtyAt) {
      quantity = Math.max(1, Number(inlineQtyAt[1]));
      unit_price = Number(inlineQtyAt[2].replace(',', '.'));
      namePart = inlineQtyAt[3].trim();
    } else if (inlinePrefixQty) {
      quantity = Math.max(1, Number(inlinePrefixQty[1]));
      namePart = inlinePrefixQty[2].trim();
      unit_price = Math.round((total_price / quantity) * 100) / 100;
    } else if (inlineNumPrefix && Number(inlineNumPrefix[1]) <= 24) {
      quantity = Number(inlineNumPrefix[1]);
      namePart = inlineNumPrefix[2].trim();
      unit_price = Math.round((total_price / quantity) * 100) / 100;
    }

    // Clean stray trailing symbols or quantity-at fragments
    namePart = namePart.replace(/[\s\-_:.*]+$/, '').trim();
    if (namePart.length < 2 || !/[a-zA-Z]{2,}/.test(namePart)) continue;

    items.push({
      raw_name: namePart,
      quantity,
      unit_price,
      total_price,
    });
  }

  return {
    store_name,
    purchase_date,
    total_amount,
    items,
  };
}

function tokenize(str: string): string[] {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

function consonantSkeleton(word: string): string {
  return word.replace(/[aeiou]/g, '');
}

/**
 * Computes a 0..1 similarity score between a receipt line item name (often abbreviated like "ORG WHL MLK")
 * and an inventory product name ("Organic Whole Milk").
 */
export function scoreReceiptItemMatch(receiptName: string, productName: string): number {
  const rTokens = tokenize(receiptName);
  const pTokens = tokenize(productName);
  if (rTokens.length === 0 || pTokens.length === 0) return 0;

  let matchedWeight = 0;
  for (const rt of rTokens) {
    let best = 0;
    const rSkel = consonantSkeleton(rt);
    for (const pt of pTokens) {
      if (rt === pt) {
        best = 1;
        break;
      }
      if (pt.startsWith(rt) || rt.startsWith(pt)) {
        best = Math.max(best, 0.85);
      } else if (rSkel.length >= 3 && consonantSkeleton(pt).startsWith(rSkel)) {
        best = Math.max(best, 0.75);
      } else if (pt.includes(rt) || rt.includes(pt)) {
        best = Math.max(best, 0.65);
      }
    }
    matchedWeight += best;
  }

  const coverageReceipt = matchedWeight / rTokens.length;
  const coverageProduct = matchedWeight / pTokens.length;
  return Math.round(((coverageReceipt * 0.6 + coverageProduct * 0.4) * 100)) / 100;
}
