export interface TsplLabelOptions {
  codes: string[];
  title?: string;
  subtitle?: string;
  format?: 'qr' | 'barcode';
  orient?: '2x1' | '1x2';
  copies?: number;
}

function escapeTsplText(str: string): string {
  return String(str || '')
    .replace(/["\r\n]/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}

function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = escapeTsplText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if (!current) {
      current = w.slice(0, maxChars);
    } else if ((current + ' ' + w).length <= maxChars) {
      current += ' ' + w;
    } else {
      lines.push(current);
      if (lines.length >= maxLines) return lines;
      current = w.slice(0, maxChars);
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  return lines;
}

/**
 * Generates native TSPL commands for 203-DPI thermal label printers (such as the iDPRT SP310).
 * 2"x1" = 406x203 dots; 1"x2" = 203x406 dots.
 */
export function buildTsplLabels(opts: TsplLabelOptions): string {
  const cleanCodes = (opts.codes || [])
    .map((c) => escapeTsplText(c))
    .filter(Boolean);
  if (cleanCodes.length === 0) {
    throw new Error('At least one label code is required');
  }

  const format = opts.format === 'barcode' ? 'barcode' : 'qr';
  const orient = opts.orient === '1x2' ? '1x2' : '2x1';
  const copies = Math.max(1, Math.min(20, Math.round(Number(opts.copies) || 1)));
  const title = escapeTsplText(opts.title || '');
  const subtitle = escapeTsplText(opts.subtitle || '');

  const out: string[] = [];
  if (orient === '2x1') {
    out.push('SIZE 2,1');
  } else {
    out.push('SIZE 1,2');
  }
  out.push('GAP 0.12,0');
  out.push('DIRECTION 1');
  out.push('DENSITY 8');

  for (const code of cleanCodes) {
    out.push('CLS');
    if (orient === '2x1') {
      if (format === 'qr') {
        // Left QR code (roughly 140x140 dots), right title + subtitle + code
        out.push(`QRCODE 16,24,M,5,A,0,"${code}"`);
        const titleLines = wrapLines(title || code, 17, 2);
        let y = 28;
        for (const tl of titleLines) {
          out.push(`TEXT 172,${y},"3",0,1,1,"${tl}"`);
          y += 30;
        }
        if (subtitle) {
          out.push(`TEXT 172,${y + 4},"2",0,1,1,"${subtitle.slice(0, 21)}"`);
          y += 26;
        }
        out.push(`TEXT 172,158,"2",0,1,1,"${code.slice(0, 20)}"`);
      } else {
        // Landscape Code 128 barcode + title on top
        if (title) {
          out.push(`TEXT 18,14,"3",0,1,1,"${title.slice(0, 26)}"`);
        }
        out.push(`BARCODE 22,52,"128",86,1,0,2,2,"${code}"`);
        if (subtitle) {
          out.push(`TEXT 18,172,"1",0,1,1,"${subtitle.slice(0, 34)}"`);
        }
      }
    } else {
      // Portrait 1"x2" (203x406 dots)
      if (format === 'qr') {
        out.push(`QRCODE 28,22,M,5,A,0,"${code}"`);
        const titleLines = wrapLines(title || code, 14, 3);
        let y = 196;
        for (const tl of titleLines) {
          out.push(`TEXT 14,${y},"3",0,1,1,"${tl}"`);
          y += 30;
        }
        if (subtitle) {
          out.push(`TEXT 14,${y + 6},"2",0,1,1,"${subtitle.slice(0, 16)}"`);
        }
        out.push(`TEXT 14,364,"2",0,1,1,"${code.slice(0, 16)}"`);
      } else {
        const titleLines = wrapLines(title || code, 14, 2);
        let y = 18;
        for (const tl of titleLines) {
          out.push(`TEXT 14,${y},"3",0,1,1,"${tl}"`);
          y += 30;
        }
        out.push(`BARCODE 16,110,"128",110,1,0,2,2,"${code}"`);
        if (subtitle) {
          out.push(`TEXT 14,270,"2",0,1,1,"${subtitle.slice(0, 16)}"`);
        }
      }
    }
    out.push(`PRINT ${copies},1`);
  }

  return out.join('\r\n') + '\r\n';
}
