import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { UploadDto, UploadKind } from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { ApiError } from '../../common/errors/api-error';
import { ENV, type Env } from '../../config/env';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toAuditSnapshot } from '../audit/audit-snapshot';
import { AuditService } from '../audit/audit.service';
import { processImage } from './image-processor';
import { toUploadDto } from './uploads.mapper';
import { runInTransaction } from '../../prisma/transaction';

@Injectable()
export class UploadsService implements OnModuleInit {
  /** Absolute, so writes and `sendFile` agree whatever the process's working directory is. */
  readonly directory: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) env: Env,
  ) {
    this.directory = path.resolve(env.UPLOADS_DIR);
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }

  /** §6.14. `file` is what the intake interceptor parsed; absent when the request carried none. */
  async create(file: Express.Multer.File | undefined, kind: UploadKind, actor: AuthContext): Promise<UploadDto> {
    // The route admits anyone who may add or edit items; the factory logo is the admin's alone.
    if (kind === 'FACTORY_LOGO' && !actor.isAdmin) throw new ApiError('ADMIN_ONLY');
    if (!file) throw new ApiError('UPLOAD_MISSING_FILE');

    const image = await processImage(file.buffer, kind);
    const fileName = `${randomBytes(16).toString('hex')}.webp`;
    const filePath = path.join(this.directory, fileName);
    // `wx` refuses to overwrite: a collision of 128 random bits is not expected, and never silent.
    await writeFile(filePath, image.buffer, { flag: 'wx', mode: 0o640 });

    try {
      return await runInTransaction(this.prisma, async (tx) => {
        const upload = await tx.upload.create({
          data: {
            fileName,
            kind,
            width: image.width,
            height: image.height,
            sizeBytes: image.buffer.length,
            createdByUserId: actor.userId,
          },
        });
        await this.audit.record(tx, {
          action: 'UPLOAD_CREATE',
          entityType: 'UPLOAD',
          entityId: String(upload.id),
          summaryParams: { kind, width: upload.width, height: upload.height },
          after: toAuditSnapshot('UPLOAD', upload),
        });
        return toUploadDto(upload);
      });
    } catch (error) {
      // No row, no file: an orphan on disk would never be referenced or cleaned up.
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Checks that an id a form sends names an upload of the right kind — the settings logo now, item
   * images in M2 — inside the caller's transaction.
   */
  async assertKind(tx: Prisma.TransactionClient, uploadId: number, expected: UploadKind): Promise<void> {
    const upload = await tx.upload.findUnique({ where: { id: uploadId }, select: { kind: true } });
    if (!upload) throw new ApiError('UPLOAD_NOT_FOUND', { uploadId });
    if (upload.kind !== expected) throw new ApiError('UPLOAD_KIND_MISMATCH', { expected, actual: upload.kind });
  }
}
