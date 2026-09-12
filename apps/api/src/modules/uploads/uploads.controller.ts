import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Controller, Get, Param, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { UPLOAD_FILE_NAME_PATTERN, UploadCreateQuery, type UploadDto } from '@pallet/shared';
import type { Response } from 'express';
import type { AuthContext } from '../../common/auth-context';
import { Public, RequireAnyPermission } from '../../common/decorators/access.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApiError } from '../../common/errors/api-error';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UploadIntakeInterceptor } from './upload-intake.interceptor';
import { UploadThrottleGuard } from './upload-throttle.guard';
import { UploadsService } from './uploads.service';

/** §6.14 and §10.4 I9: the file is inert — never sniffed, never scripted, cached for good. */
const SERVE_HEADERS: Record<string, string> = {
  'Content-Type': 'image/webp',
  'Cache-Control': 'public, max-age=31536000, immutable',
  'X-Content-Type-Options': 'nosniff',
  'Content-Disposition': 'inline',
  'Content-Security-Policy': "default-src 'none'",
};

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  @RequireAnyPermission('items.create', 'items.edit')
  @UseGuards(UploadThrottleGuard)
  @UseInterceptors(UploadIntakeInterceptor)
  create(
    @Query(new ZodValidationPipe(UploadCreateQuery)) query: UploadCreateQuery,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() actor: AuthContext,
  ): Promise<UploadDto> {
    return this.uploads.create(file, query.kind, actor);
  }

  /**
   * Public: the name is 128 random bits, and an `<img>` cannot send an access token. The name is
   * matched against its exact shape before it is joined to any path, and every miss — malformed,
   * traversal, absent — is the same 404 with nothing to probe.
   */
  @Get(':fileName')
  @Public()
  async serve(@Param('fileName') fileName: string, @Res() res: Response): Promise<void> {
    if (!UPLOAD_FILE_NAME_PATTERN.test(fileName)) throw new ApiError('NOT_FOUND');
    try {
      await stat(path.join(this.uploads.directory, fileName));
    } catch {
      throw new ApiError('NOT_FOUND');
    }

    res.sendFile(fileName, { root: this.uploads.directory, dotfiles: 'deny', headers: SERVE_HEADERS }, (error) => {
      // The file vanished between the check and the read, before anything was sent.
      if (error && !res.headersSent) res.status(404).end();
    });
  }
}
