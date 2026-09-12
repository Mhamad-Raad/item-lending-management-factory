import { UPLOAD_ACCEPT, type UploadKind } from '@pallet/shared';
import sharp from 'sharp';
import { ApiError } from '../../common/errors/api-error';

/** Longest side of the stored image (Q35): an item photo is opened on a detail page. */
export const UPLOAD_MAX_DIMENSION: Readonly<Record<UploadKind, number>> = { ITEM_IMAGE: 1600, FACTORY_LOGO: 800 };

/** A decompression bomb stops here rather than in memory (§10.4 I6). */
const MAX_INPUT_PIXELS = 40_000_000;
const DECODED_FORMATS = new Set(['png', 'jpeg', 'webp']);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
}

/** PNG, JPEG or WebP by their first bytes — the cheap check that runs before any decoder does. */
export function hasImageSignature(buffer: Buffer): boolean {
  const isPng = buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isWebp =
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP';
  return isPng || isJpeg || isWebp;
}

function notAllowed(): ApiError {
  return new ApiError('UPLOAD_TYPE_NOT_ALLOWED', { allowed: [...UPLOAD_ACCEPT] });
}

/**
 * The upload pipeline of §6.14 and Q35: signature, then the decoder's own reading of the format,
 * then a re-encode to WebP that orients the pixels and drops every piece of metadata — EXIF, ICC,
 * XMP — because sharp keeps none unless asked to, and it is never asked.
 */
export async function processImage(buffer: Buffer, kind: UploadKind): Promise<ProcessedImage> {
  if (!hasImageSignature(buffer)) throw notAllowed();

  const decoder = (): sharp.Sharp => sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });

  let format: string | undefined;
  try {
    ({ format } = await decoder().metadata());
  } catch {
    throw new ApiError('UPLOAD_INVALID_IMAGE');
  }
  // A file can open with one signature and decode as something else; the decoder has the last word.
  if (!format || !DECODED_FORMATS.has(format)) throw notAllowed();

  const size = UPLOAD_MAX_DIMENSION[kind];
  try {
    const { data, info } = await decoder()
      .rotate()
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height };
  } catch {
    // A header that reads cleanly over a body that does not, or more pixels than the limit.
    throw new ApiError('UPLOAD_INVALID_IMAGE');
  }
}
