import { z } from 'zod';
import { Id, Version } from './common.js';

/** `PUT /api/settings` (§6.13): the whole form every time, with the version it was loaded at. */
export const SettingsUpdateBody = z.strictObject({
  version: Version,
  factoryName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(100),
  address: z.string().trim().min(1).max(300),
  logoUploadId: Id.nullable(),
});
export type SettingsUpdateBody = z.infer<typeof SettingsUpdateBody>;
