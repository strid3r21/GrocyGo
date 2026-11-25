import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
};

const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
};

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB

export function sanitizeFileName(raw: string): string | null {
  const base = path.basename(raw);
  if (!/^[a-zA-Z0-9._-]+$/.test(base)) return null;
  return base;
}

export function getMimeForFile(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return EXT_TO_MIME[ext] || 'application/octet-stream';
}

export function savePhotoBuffer(
  photosDir: string,
  buffer: Buffer,
  mimeType: string
): { fileName: string; size: number } {
  if (buffer.length === 0) {
    throw new Error('Empty image payload');
  }
  if (buffer.length > MAX_PHOTO_BYTES) {
    throw new Error('Image exceeds 10 MB limit');
  }

  const cleanMime = mimeType.split(';')[0].trim().toLowerCase();
  const ext = ALLOWED_MIME[cleanMime] || detectImageExtension(buffer) || '.jpg';
  const fileName = `img_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;
  const fullPath = path.join(photosDir, fileName);
  fs.writeFileSync(fullPath, buffer);
  return { fileName, size: buffer.length };
}

export function savePhotoBase64(
  photosDir: string,
  dataBase64: string,
  mimeType?: string
): { fileName: string; size: number } {
  let cleanB64 = dataBase64.trim();
  let detectedMime = mimeType || 'image/jpeg';

  const dataUriMatch = cleanB64.match(/^data:([^;]+);base64,(.+)$/s);
  if (dataUriMatch) {
    detectedMime = dataUriMatch[1];
    cleanB64 = dataUriMatch[2];
  }

  const buffer = Buffer.from(cleanB64, 'base64');
  return savePhotoBuffer(photosDir, buffer, detectedMime);
}

export function deletePhotoIfUnreferenced(
  photosDir: string,
  fileName: string | null | undefined,
  isStillReferenced: (name: string) => boolean
): void {
  if (!fileName) return;
  const safe = sanitizeFileName(fileName);
  if (!safe) return;
  if (isStillReferenced(safe)) return;
  const fullPath = path.join(photosDir, safe);
  try {
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch {
    // ignore cleanup error
  }
}

function detectImageExtension(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return '.jpg';
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return '.png';
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return '.webp';
  }
  return null;
}
