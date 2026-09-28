import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '../../common/auth-context';
import type { Env } from '../../config/env';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { UploadsService } from './uploads.service';

const fs = vi.hoisted(() => ({
  mkdir: vi.fn(),
  unlink: vi.fn<(path: string) => Promise<void>>(),
  writeFile: vi.fn<(path: string, data: unknown, options: unknown) => Promise<void>>(),
}));
vi.mock('node:fs/promises', () => fs);
vi.mock('./image-processor', () => ({
  processImage: vi.fn(() => Promise.resolve({ buffer: Buffer.from('webp'), width: 10, height: 10 })),
}));

const actor = { userId: 1, isAdmin: true } as AuthContext;
const file = { buffer: Buffer.from('png') } as Express.Multer.File;
const errno = (code: string) => Object.assign(new Error(code), { code });

function service(transaction: () => Promise<unknown>): UploadsService {
  const prisma = { $transaction: vi.fn(transaction) } as unknown as PrismaService;
  return new UploadsService(prisma, {} as AuditService, { UPLOADS_DIR: '/uploads' } as Env);
}

describe('UploadsService.create leaves no file without a row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fs.unlink.mockResolvedValue(undefined);
  });

  it('removes the half-written file when the disk fills during the write', async () => {
    fs.writeFile.mockRejectedValue(errno('ENOSPC'));
    const uploads = service(() => Promise.resolve({}));

    await expect(uploads.create(file, 'ITEM_IMAGE', actor)).rejects.toMatchObject({ code: 'ENOSPC' });
    const written = fs.writeFile.mock.calls[0]?.[0];
    expect(fs.unlink).toHaveBeenCalledWith(written);
  });

  it('removes the file when the row cannot be saved', async () => {
    fs.writeFile.mockResolvedValue(undefined);
    const uploads = service(() => Promise.reject(errno('53100')));

    await expect(uploads.create(file, 'ITEM_IMAGE', actor)).rejects.toMatchObject({ code: '53100' });
    expect(fs.unlink).toHaveBeenCalledWith(fs.writeFile.mock.calls[0]?.[0]);
  });

  it('never removes a file of the same name that it did not write', async () => {
    fs.writeFile.mockRejectedValue(errno('EEXIST'));
    const uploads = service(() => Promise.resolve({}));

    await expect(uploads.create(file, 'ITEM_IMAGE', actor)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(fs.unlink).not.toHaveBeenCalled();
  });
});
