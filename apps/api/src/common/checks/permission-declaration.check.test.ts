import { Controller, Get, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { ACCESS_METADATA, AdminOnly, Authenticated, Public } from '../decorators/access.decorators';
import { PermissionDeclarationCheck } from './permission-declaration.check';

@Controller('declared')
class DeclaredController {
  @Get()
  @Authenticated()
  list(): string[] {
    return [];
  }
}

@Controller('undeclared')
class UndeclaredController {
  @Get(':id')
  find(): null {
    return null;
  }
}

@Controller('twice')
class TwiceDeclaredController {
  @Get()
  @Authenticated()
  @AdminOnly()
  list(): string[] {
    return [];
  }
}

@Controller('empty-keys')
class EmptyKeysController {
  // The decorator's signature makes this impossible in TypeScript; the metadata can still end up
  // empty through a spread of an array that turns out to be empty, so the check must catch it.
  @Get()
  @((target: object, key: string, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata(ACCESS_METADATA, [{ kind: 'all', keys: [] }], descriptor.value as object);
    return descriptor;
  })
  list(): string[] {
    return [];
  }
}

@Controller('not-a-route')
class HelperOnlyController {
  @Public()
  @Get()
  ping(): string {
    return 'pong';
  }

  /** Not a handler: the check must ignore it rather than demand a declaration. */
  helper(): string {
    return 'helper';
  }
}

async function bootstrapWith(controller: new () => unknown): Promise<void> {
  @Module({ imports: [DiscoveryModule], controllers: [controller], providers: [PermissionDeclarationCheck] })
  class TestModule {}

  const app = (await Test.createTestingModule({ imports: [TestModule] }).compile()).createNestApplication();
  try {
    await app.init();
  } finally {
    await app.close();
  }
}

describe('PermissionDeclarationCheck', () => {
  beforeAll(() => {
    process.env.DATABASE_URL ??= 'postgresql://pallet_app:x@127.0.0.1:5434/pallet?schema=public';
    process.env.JWT_ACCESS_SECRET ??= 'a'.repeat(64);
  });

  it('accepts a handler that declares its access exactly once', async () => {
    await expect(bootstrapWith(DeclaredController)).resolves.toBeUndefined();
  });

  it('ignores controller methods that are not routes', async () => {
    await expect(bootstrapWith(HelperOnlyController)).resolves.toBeUndefined();
  });

  it('fails bootstrap when a route has no access declaration', async () => {
    await expect(bootstrapWith(UndeclaredController)).rejects.toThrow(
      'Routes without access declaration: GET /api/undeclared/:id',
    );
  });

  it('fails bootstrap when a route declares its access twice', async () => {
    await expect(bootstrapWith(TwiceDeclaredController)).rejects.toThrow(
      'Routes with more than one access declaration: GET /api/twice',
    );
  });

  it('fails bootstrap when a permission rule carries no keys', async () => {
    await expect(bootstrapWith(EmptyKeysController)).rejects.toThrow(
      'Routes declaring a permission rule without keys: GET /api/empty-keys',
    );
  });

  it('boots the whole application: every real route is declared', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $connect: () => Promise.resolve(), $disconnect: () => Promise.resolve() })
      .compile();

    const app = moduleRef.createNestApplication();
    try {
      await expect(app.init()).resolves.toBeDefined();
      expect(
        app
          .get(PermissionDeclarationCheck)
          .scan()
          .map((d) => d.route),
      ).toContain('GET /api/health');
    } finally {
      await app.close();
    }
  });
});
