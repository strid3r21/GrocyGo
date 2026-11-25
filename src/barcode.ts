/**
 * Pure-TypeScript ISO/IEC 15417 Code 128B SVG barcode generator.
 * Zero native dependencies, pixel-crisp vector bars suitable for 1"x2" thermal label printers
 * and scannable by phone cameras (Expo Camera code128) and hardware scanners.
 */

const CODE128_PATTERNS: string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_CODE_B = 104;
const STOP_CODE = 106;

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderCode128Svg(
  rawText: string,
  options: { barHeight?: number; showText?: boolean } = {}
): string {
  const text = rawText.trim();
  if (!text) throw new Error('Barcode text cannot be empty');
  if (text.length > 64) throw new Error('Barcode text is too long (max 64 characters)');

  const values: number[] = [START_CODE_B];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 32 || code > 126) {
      throw new Error('Code 128B supports standard printable ASCII characters only');
    }
    values.push(code - 32);
  }

  let checksum = values[0];
  for (let i = 1; i < values.length; i++) {
    checksum += values[i] * i;
  }
  values.push(checksum % 103);
  values.push(STOP_CODE);

  const quietModules = 10;
  const barHeight = options.barHeight ?? 48;
  const showText = options.showText !== false;
  const textHeight = showText ? 16 : 0;
  const totalHeight = barHeight + textHeight + 4;

  let cursor = quietModules;
  const rects: string[] = [];

  for (const val of values) {
    const pattern = CODE128_PATTERNS[val];
    for (let i = 0; i < pattern.length; i++) {
      const width = Number(pattern[i]);
      const isBar = i % 2 === 0;
      if (isBar) {
        rects.push(`<rect x="${cursor}" y="2" width="${width}" height="${barHeight}" fill="#000"/>`);
      }
      cursor += width;
    }
  }

  const totalWidth = cursor + quietModules;
  const labelSvg = showText
    ? `<text x="${totalWidth / 2}" y="${barHeight + 14}" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="11" font-weight="700" fill="#000">${escapeXml(text)}</text>`
    : '';

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges">`,
    `<rect width="${totalWidth}" height="${totalHeight}" fill="#fff"/>`,
    ...rects,
    labelSvg,
    '</svg>',
  ].join('');
}
