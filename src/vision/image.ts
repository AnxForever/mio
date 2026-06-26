/**
 * Mio — Image Input Processing
 *
 * processImage(filePath):   Read image, resize if >4.5MB, base64-encode,
 *                            return an ImageContent block.
 * resizeImage(buffer):      Use sharp to resize. Max 2000x2000, max 4.5MB.
 * detectMimeType(buffer):   Detect format from magic bytes.
 * supportsImage(filePath):  Check file extension is supported.
 */

import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import type { ContentBlock } from '../types.js';

// ─── Constants ───

/** Supported image file extensions. */
const SUPPORTED_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.heic',
];

/** Maximum file size in bytes (4.5MB — Claude's limit for base64 images). */
const MAX_FILE_SIZE = 4.5 * 1024 * 1024;

/** Maximum dimension in pixels (width or height). */
const MAX_DIMENSION = 2000;

/** JPEG quality for resized images. */
const DEFAULT_QUALITY = 85;

// ─── Public API ───

/**
 * Check whether a file path has a supported image extension.
 *
 * Supported: .jpg, .jpeg, .png, .gif, .webp, .heic
 */
export function supportsImage(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(ext);
}

/**
 * Detect the MIME type of an image from its magic bytes.
 *
 * Supports PNG, JPEG, GIF, WebP, and HEIC.
 * Falls back to 'application/octet-stream' if unknown.
 */
export function detectMimeType(buffer: Buffer): string {
  if (buffer.length >= 4) {
    // PNG: 89 50 4E 47
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      return 'image/png';
    }
    // JPEG: FF D8
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      return 'image/jpeg';
    }
    // GIF: 47 49 46 ("GIF")
    if (
      buffer[0] === 0x47 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46
    ) {
      return 'image/gif';
    }
  }

  // WebP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
    buffer.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  // HEIC: ftypheic / ftypheix / ftypmif1
  if (buffer.length >= 12) {
    const ftyp = buffer.slice(4, 12).toString('ascii');
    if (['ftypheic', 'ftypheix', 'ftypmif1', 'ftyphevc'].includes(ftyp)) {
      return 'image/heic';
    }
  }

  return 'application/octet-stream';
}

/**
 * Resize an image buffer to fit within maxDim × maxDim.
 *
 * Uses sharp to resize (fit: inside, no enlargement) and re-encode as JPEG.
 * If the result still exceeds MAX_FILE_SIZE, quality is reduced further.
 *
 * @param buffer   Raw image bytes.
 * @param maxDim   Maximum dimension in pixels (default 2000).
 * @param quality  JPEG quality 1-100 (default 85).
 * @returns        Resized image buffer (JPEG).
 */
export async function resizeImage(
  buffer: Buffer,
  maxDim: number = MAX_DIMENSION,
  quality: number = DEFAULT_QUALITY,
): Promise<Buffer> {
  const image = sharp(buffer, { animated: false });
  const metadata = await image.metadata();

  let pipeline = image;

  // Resize if either dimension exceeds maxDim.
  if (metadata.width && metadata.height) {
    if (metadata.width > maxDim || metadata.height > maxDim) {
      pipeline = image.resize(maxDim, maxDim, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }
  }

  // Encode as JPEG with the specified quality.
  let output = await pipeline
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();

  // If still too large, progressively reduce quality.
  let currentQuality = quality;
  while (output.length > MAX_FILE_SIZE && currentQuality > 30) {
    currentQuality = Math.max(30, currentQuality - 15);
    output = await sharp(buffer, { animated: false })
      .resize(maxDim, maxDim, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: currentQuality, mozjpeg: true })
      .toBuffer();
  }

  return output;
}

/**
 * Read an image file, resize if needed, and convert to a ContentBlock
 * suitable for sending to an AI provider.
 *
 * Steps:
 *  1. Read the file into a buffer.
 *  2. Detect MIME type from magic bytes.
 *  3. If the buffer exceeds 4.5MB or dimensions exceed 2000px, resize.
 *  4. Convert to base64 and wrap in an ImageContent block.
 *
 * @param filePath  Path to the image file.
 * @returns         ImageContent ContentBlock with base64-encoded data.
 * @throws          Error if the file cannot be read or processed.
 */
export async function processImage(filePath: string): Promise<ContentBlock> {
  const buffer = readFileSync(filePath);
  const originalMime = detectMimeType(buffer);

  let processedBuffer: Buffer = buffer;
  let needsResize = false;

  // Check file size.
  if (buffer.length > MAX_FILE_SIZE) {
    needsResize = true;
  }

  // Check dimensions (if sharp can read the metadata).
  if (!needsResize) {
    try {
      const metadata = await sharp(buffer, { animated: false }).metadata();
      if (
        metadata.width &&
        metadata.height &&
        (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION)
      ) {
        needsResize = true;
      }
    } catch {
      // sharp cannot read metadata — proceed with the original buffer.
      // The provider may reject it if it's too large.
    }
  }

  if (needsResize) {
    // sharp returns Buffer<ArrayBufferLike>; we widen it to Buffer for the
    // downstream `toString('base64')` call which doesn't care which flavor.
    const resized = await resizeImage(buffer);
    processedBuffer = resized as unknown as Buffer;
  }

  // After resizing, the format is JPEG. Otherwise keep the original MIME.
  const finalMime = needsResize ? 'image/jpeg' : originalMime;
  const base64Data = processedBuffer.toString('base64');

  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: finalMime,
      data: base64Data,
    },
  };
}
