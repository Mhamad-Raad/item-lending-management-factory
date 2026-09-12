import type { UploadDto } from '@pallet/shared';
import type { Upload } from '../../generated/prisma/client';

/** Where an upload is served (§6.9): the one place the path is spelled out. */
export function uploadUrl(fileName: string): string {
  return `/api/uploads/${fileName}`;
}

export function toUploadDto(upload: Upload): UploadDto {
  return {
    id: upload.id,
    kind: upload.kind,
    url: uploadUrl(upload.fileName),
    width: upload.width,
    height: upload.height,
  };
}
