import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { UPLOAD_MAX_BYTES } from '@pallet/shared';
import type { Request, Response } from 'express';
import multer from 'multer';
import type { Observable } from 'rxjs';
import { ApiError } from '../../common/errors/api-error';

/** One file part named `file` and nothing else: the kind travels in the query string (Q35). */
const parseSingleFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_BYTES, files: 1, fields: 0, parts: 2 },
}).single('file');

/**
 * Multer's refusals in the API's own vocabulary (Q35). Nest's `FileInterceptor` would turn them
 * into generic HTTP exceptions — an oversized file would read as PAYLOAD_TOO_LARGE, not the
 * UPLOAD_TOO_LARGE the web app translates.
 */
function toApiError(error: unknown): ApiError {
  if (!(error instanceof multer.MulterError)) {
    // Busboy's own complaint about a body that is not well-formed multipart.
    return new ApiError('VALIDATION_FAILED', undefined, [{ path: 'file', code: 'invalid_format' }]);
  }

  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return new ApiError('UPLOAD_TOO_LARGE', { maxBytes: UPLOAD_MAX_BYTES });
    case 'LIMIT_UNEXPECTED_FILE':
      // The file arrived under another name, so the `file` part is missing.
      return new ApiError('UPLOAD_MISSING_FILE');
    case 'LIMIT_FIELD_COUNT':
    case 'LIMIT_FIELD_KEY':
    case 'LIMIT_FIELD_VALUE':
      return new ApiError('VALIDATION_FAILED', undefined, [{ path: error.field ?? '', code: 'unknown_key' }]);
    case 'LIMIT_FILE_COUNT':
    case 'LIMIT_PART_COUNT':
      return new ApiError('VALIDATION_FAILED', undefined, [{ path: 'file', code: 'too_big', params: { maximum: 1 } }]);
    default:
      return new ApiError('VALIDATION_FAILED', undefined, [{ path: 'file', code: 'invalid_format' }]);
  }
}

/** Parses the multipart body into `req.file` (memory only; nothing touches the disk here). */
@Injectable()
export class UploadIntakeInterceptor implements NestInterceptor {
  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    await new Promise<void>((resolve, reject) => {
      parseSingleFile(http.getRequest<Request>(), http.getResponse<Response>(), (error: unknown) => {
        if (error) reject(toApiError(error));
        else resolve();
      });
    });
    return next.handle();
  }
}
