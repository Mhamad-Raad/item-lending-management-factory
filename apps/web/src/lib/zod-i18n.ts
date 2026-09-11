import { mapZodIssue } from '@pallet/shared';
import { z } from 'zod';
import { encodeValidationMessage } from './validation-message';

/**
 * Makes every zod message an i18n key rather than English prose (§7.9), so a validation failure
 * reads in the user's language whether it came from the client or from the API.
 */
export function installZodI18n(): void {
  z.config({
    customError: (issue) => {
      const [first] = mapZodIssue(issue as Parameters<typeof mapZodIssue>[0]);
      return first ? encodeValidationMessage(first.code, first.params) : 'validation.invalid_type';
    },
  });
}
