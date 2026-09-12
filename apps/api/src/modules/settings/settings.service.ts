import { Injectable } from '@nestjs/common';
import type { SettingsDto, SettingsUpdateBody } from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { ApiError } from '../../common/errors/api-error';
import { lockSettings } from '../../prisma/locks';
import { PrismaService } from '../../prisma/prisma.service';
import { toAuditSnapshot } from '../audit/audit-snapshot';
import { AuditService } from '../audit/audit.service';
import { UploadsService } from '../uploads/uploads.service';
import { toSettingsDto } from './settings.mapper';

/** The single settings row, seeded by the migrate step (§13.3). */
const SETTINGS_ID = 1;
const EDITABLE_FIELDS = ['factoryName', 'phone', 'address', 'logoUploadId'] as const;
const WITH_LOGO = { logo: { select: { fileName: true } } } as const;

function pickFields(snapshot: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field, snapshot[field]]));
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<SettingsDto> {
    const row = await this.prisma.factorySettings.findUnique({ where: { id: SETTINGS_ID }, include: WITH_LOGO });
    // A missing row is a deployment fault, not something a user did: it surfaces as INTERNAL_ERROR.
    if (!row) throw new Error('factory_settings row 1 is missing: run the migrate step');
    return toSettingsDto(row);
  }

  /** §6.13: version first, then the logo's kind, then only what actually changed. */
  async update(body: SettingsUpdateBody, actor: AuthContext): Promise<SettingsDto> {
    return this.prisma.$transaction(async (tx) => {
      await lockSettings(tx);
      const before = await tx.factorySettings.findUniqueOrThrow({ where: { id: SETTINGS_ID }, include: WITH_LOGO });
      if (before.version !== body.version) {
        throw new ApiError('VERSION_CONFLICT', { currentVersion: before.version });
      }
      if (body.logoUploadId !== null) await this.uploads.assertKind(tx, body.logoUploadId, 'FACTORY_LOGO');

      const changed = EDITABLE_FIELDS.filter((field) => body[field] !== before[field]);
      // Saving an unchanged form is not an edit (Q36): no new version, no history row.
      if (changed.length === 0) return toSettingsDto(before);

      const after = await tx.factorySettings.update({
        where: { id: SETTINGS_ID },
        data: {
          factoryName: body.factoryName,
          phone: body.phone,
          address: body.address,
          logoUploadId: body.logoUploadId,
          version: { increment: 1 },
          updatedByUserId: actor.userId,
        },
        include: WITH_LOGO,
      });

      await this.audit.record(tx, {
        action: 'SETTINGS_CHANGE',
        entityType: 'SETTINGS',
        entityId: String(SETTINGS_ID),
        summaryParams: { fields: changed },
        // Only the fields that changed, before and after (§6.13).
        before: pickFields(toAuditSnapshot('SETTINGS', before), changed),
        after: pickFields(toAuditSnapshot('SETTINGS', after), changed),
      });
      return toSettingsDto(after);
    });
  }
}
