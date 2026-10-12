import type { ReceiptFactoryDto } from '@pallet/shared';
import type { Prisma } from '../../generated/prisma/client';
import { uploadUrl } from '../uploads/uploads.mapper';

/** The factory as every printed receipt heads it (§7.16.3, Q137): from Settings, the logo as a URL. */
export async function loadReceiptFactory(db: Prisma.TransactionClient): Promise<ReceiptFactoryDto> {
  const settings = await db.factorySettings.findUniqueOrThrow({
    where: { id: 1 },
    include: { logo: { select: { fileName: true } } },
  });
  return {
    name: settings.factoryName,
    phone: settings.phone,
    address: settings.address,
    logoUrl: settings.logo ? uploadUrl(settings.logo.fileName) : null,
  };
}
