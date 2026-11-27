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
    out.push('SIZE 50.8 mm,25.4 mm');
  } else {
    out.push('SIZE 25.4 mm,50.8 mm');
  }
  out.push('GAP 3 mm,0');
  out.push('DIRECTION 1');
  out.push('DENSITY 12');

  const pushBoldText = (x: number, y: number, font: string, text: string) => {
    out.push(`TEXT ${x},${y},"${font}",0,1,1,"${text}"`);
    out.push(`TEXT ${x + 1},${y},"${font}",0,1,1,"${text}"`);
  };

  for (const code of cleanCodes) {
    out.push('CLS');
    const cleanTitle = title && title.toLowerCase() !== code.toLowerCase() ? title : '';
    if (orient === '2x1') {
      if (format === 'qr') {
        // Large full-height QR on left (~168x168 dots on 406x203 label)
        const qrCell = code.length <= 16 ? 8 : code.length <= 34 ? 6 : 5;
        const qrY = qrCell === 8 ? 18 : 26;
        out.push(`QRCODE 16,${qrY},M,${qrCell},A,0,"${code}"`);

        // Vertically centered text stack on the right (x=198..398)
        const titleLines = cleanTitle ? wrapLines(cleanTitle, 12, 2) : [];
        const rows: Array<{ font: string; bold: boolean; text: string; h: number }> = [];
        for (const tl of titleLines) {
          rows.push({ font: '3', bold: true, text: tl, h: 28 });
        }
        if (subtitle) {
          rows.push({ font: '2', bold: false, text: subtitle.slice(0, 16), h: 25 });
        }
        rows.push({
          font: code.length <= 12 ? '3' : '2',
          bold: true,
          text: code.slice(0, 16),
          h: code.length <= 12 ? 26 : 22,
        });

        const totalH = rows.reduce((sum, r) => sum + r.h, 0);
        let y = Math.max(18, Math.round((203 - totalH) / 2));
        for (const r of rows) {
          if (r.bold) pushBoldText(198, y, r.font, r.text);
          else out.push(`TEXT 198,${y},"${r.font}",0,1,1,"${r.text}"`);
          y += r.h;
        }
      } else {
        // Landscape Code 128 barcode + bold title on top
        if (cleanTitle) {
          pushBoldText(18, 14, '3', cleanTitle.slice(0, 23));
        }
        out.push(`BARCODE 22,50,"128",92,1,0,2,2,"${code}"`);
        if (subtitle) {
          out.push(`TEXT 18,174,"2",0,1,1,"${subtitle.slice(0, 30)}"`);
        }
      }
    } else {
      // Portrait 1"x2" (203x406 dots)
      if (format === 'qr') {
        const qrCell = code.length <= 16 ? 7 : code.length <= 34 ? 6 : 5;
        out.push(`QRCODE 26,20,M,${qrCell},A,0,"${code}"`);
        const titleLines = cleanTitle ? wrapLines(cleanTitle, 11, 3) : [];
        let y = 192;
        for (const tl of titleLines) {
          pushBoldText(14, y, '3', tl);
          y += 30;
        }
        if (subtitle) {
          out.push(`TEXT 14,${y + 4},"2",0,1,1,"${subtitle.slice(0, 15)}"`);
          y += 28;
        }
        pushBoldText(14, y + 6, code.length <= 11 ? '3' : '2', code.slice(0, 15));
      } else {
        const titleLines = cleanTitle ? wrapLines(cleanTitle, 11, 2) : [];
        let y = 18;
        for (const tl of titleLines) {
          pushBoldText(14, y, '3', tl);
          y += 30;
        }
        out.push(`BARCODE 16,108,"128",114,1,0,2,2,"${code}"`);
        if (subtitle) {
          out.push(`TEXT 14,274,"2",0,1,1,"${subtitle.slice(0, 15)}"`);
        }
      }
    }
    out.push(`PRINT ${copies},1`);
  }

  return out.join('\r\n') + '\r\n';
}
