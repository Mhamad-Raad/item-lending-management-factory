import { z } from 'zod';
import { UPLOAD_KINDS } from '../enums.js';

/** Largest image `POST /api/uploads` accepts (§6.14); the web app checks it before sending. */
export const UPLOAD_MAX_BYTES = 5_242_880;

/**
 * The only image types an upload may be. The server decides by the file's content — its first bytes
 * and what the decoder reads — never by its name or the type the browser declares (Q35).
 */
export const UPLOAD_ACCEPT = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** The only names the API writes, and so the only names it will serve. */
export const UPLOAD_FILE_NAME_PATTERN = /^[0-9a-f]{32}\.webp$/;

/** `POST /api/uploads?kind=…` (§6.14): the kind travels in the query string, the file in the body. */
export const UploadCreateQuery = z.strictObject({ kind: z.enum(UPLOAD_KINDS) });
export type UploadCreateQuery = z.infer<typeof UploadCreateQuery>;
