import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

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

export const MAX_PHOTO_BYTES = 12 * 1024 * 1024; // 12 MB raw upload cap (auto-downsized on save)
const MAX_DIMENSION = 1280;
const THUMB_SIZE = 240;

export function sanitizeFileName(raw: string): string | null {
  const base = path.basename(raw);
  if (!/^[a-zA-Z0-9._-]+$/.test(base)) return null;
  return base;
}

export function getMimeForFile(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return EXT_TO_MIME[ext] || 'application/octet-stream';
}

function getThumbPath(photosDir: string, fileName: string): string {
  const thumbsDir = path.join(photosDir, 'thumbs');
  fs.mkdirSync(thumbsDir, { recursive: true });
  return path.join(thumbsDir, `${fileName}.webp`);
}

export async function savePhotoBuffer(
  photosDir: string,
  buffer: Buffer,
  mimeType: string
): Promise<{ fileName: string; size: number; optimized: boolean }> {
  if (buffer.length === 0) {
    throw new Error('Empty image payload');
  }
  if (buffer.length > MAX_PHOTO_BYTES) {
    throw new Error('Image exceeds 12 MB limit');
  }

  // Try optimizing via sharp: EXIF auto-orient, resize max 1280px, WebP q80 + 240px cached thumbnail
  try {
    const optimizedBuf = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    const fileName = `img_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.webp`;
    const fullPath = path.join(photosDir, fileName);
    fs.writeFileSync(fullPath, optimizedBuf);

    // Pre-generate tiny thumbnail (~6-12 KB) so list/grid views load instantaneously
    try {
      const thumbPath = getThumbPath(photosDir, fileName);
      await sharp(optimizedBuf)
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
        .webp({ quality: 72 })
        .toFile(thumbPath);
    } catch {
      // Non-fatal: thumbnail can be generated lazily later
    }

    return { fileName, size: optimizedBuf.length, optimized: true };
  } catch {
    // Graceful fallback if buffer is not decodable by sharp (e.g. minimal header stubs or exotic format)
    const cleanMime = mimeType.split(';')[0].trim().toLowerCase();
    const ext = ALLOWED_MIME[cleanMime] || detectImageExtension(buffer) || '.jpg';
    const fileName = `img_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;
    const fullPath = path.join(photosDir, fileName);
    fs.writeFileSync(fullPath, buffer);
    return { fileName, size: buffer.length, optimized: false };
  }
}

export async function savePhotoBase64(
  photosDir: string,
  dataBase64: string,
  mimeType?: string
): Promise<{ fileName: string; size: number; optimized: boolean }> {
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

/**
 * Returns path to a cached 240x240 WebP thumbnail for any photo (including older unoptimized uploads).
 * Generates and caches it lazily on first request. Returns null if not decodable.
 */
export async function getOrCreateThumbnailPath(
  photosDir: string,
  fileName: string
): Promise<string | null> {
  const safe = sanitizeFileName(fileName);
  if (!safe) return null;
  const origPath = path.join(photosDir, safe);
  if (!fs.existsSync(origPath)) return null;

  const thumbPath = getThumbPath(photosDir, safe);
  if (fs.existsSync(thumbPath)) return thumbPath;

  try {
    await sharp(origPath, { failOn: 'none' })
      .rotate()
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
      .webp({ quality: 72 })
      .toFile(thumbPath);
    return thumbPath;
  } catch {
    return null;
  }
}

export function deleteThumbnail(photosDir: string, fileName: string): void {
  const safe = sanitizeFileName(fileName);
  if (!safe) return;
  const thumbPath = path.join(photosDir, 'thumbs', `${safe}.webp`);
  try {
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
  } catch {
    // ignore cleanup error
  }
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
  deleteThumbnail(photosDir, safe);
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
