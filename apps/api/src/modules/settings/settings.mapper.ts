import type { SettingsDto } from '@pallet/shared';
import type { FactorySettings, Upload } from '../../generated/prisma/client';
import { uploadUrl } from '../uploads/uploads.mapper';

export type SettingsRow = FactorySettings & { logo: Pick<Upload, 'fileName'> | null };

export function toSettingsDto(row: SettingsRow): SettingsDto {
  return {
    factoryName: row.factoryName,
    phone: row.phone,
    address: row.address,
    logoUploadId: row.logoUploadId,
    logoUrl: row.logo ? uploadUrl(row.logo.fileName) : null,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}
