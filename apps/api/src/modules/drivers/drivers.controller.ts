import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  DriverCreateBody,
  DriverListQuery,
  DriverUpdateBody,
  IdParam,
  VersionQuery,
  type DriverDto,
  type PageDto,
} from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { RequirePermission } from '../../common/decorators/access.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { DriversService } from './drivers.service';

@Controller('drivers')
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Get()
  @RequirePermission('drivers.view')
  list(@Query(new ZodValidationPipe(DriverListQuery)) query: DriverListQuery): Promise<PageDto<DriverDto>> {
    return this.drivers.list(query);
  }

  @Get(':id')
  @RequirePermission('drivers.view')
  get(@Param('id', new ZodValidationPipe(IdParam)) id: number): Promise<DriverDto> {
    return this.drivers.get(id);
  }

  @Post()
  @RequirePermission('drivers.create')
  create(
    @Body(new ZodValidationPipe(DriverCreateBody)) body: DriverCreateBody,
    @CurrentUser() actor: AuthContext,
  ): Promise<DriverDto> {
    return this.drivers.create(body, actor);
  }

  @Patch(':id')
  @RequirePermission('drivers.edit')
  update(
    @Param('id', new ZodValidationPipe(IdParam)) id: number,
    @Body(new ZodValidationPipe(DriverUpdateBody)) body: DriverUpdateBody,
  ): Promise<DriverDto> {
    return this.drivers.update(id, body);
  }

  /** Always an archive, and allowed at any time: orders keep referring to the driver. */
  @Delete(':id')
  @RequirePermission('drivers.delete')
  archive(
    @Param('id', new ZodValidationPipe(IdParam)) id: number,
    @Query(new ZodValidationPipe(VersionQuery)) query: VersionQuery,
    @CurrentUser() actor: AuthContext,
  ): Promise<DriverDto> {
    return this.drivers.archive(id, query.version, actor);
  }
}
