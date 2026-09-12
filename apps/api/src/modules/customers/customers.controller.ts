import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  CustomerCreateBody,
  CustomerListQuery,
  CustomerPhoneCheckQuery,
  CustomerUpdateBody,
  IdParam,
  VersionQuery,
  type CustomerDetailDto,
  type CustomerDto,
  type CustomerPhoneCheckDto,
  type PageDto,
} from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { RequirePermission } from '../../common/decorators/access.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CustomersService } from './customers.service';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermission('customers.view')
  list(@Query(new ZodValidationPipe(CustomerListQuery)) query: CustomerListQuery): Promise<PageDto<CustomerDto>> {
    return this.customers.list(query);
  }

  /** Declared before `:id`, which would otherwise take `phone-check` for an id (§6.17). */
  @Get('phone-check')
  @RequirePermission('customers.view')
  phoneCheck(
    @Query(new ZodValidationPipe(CustomerPhoneCheckQuery)) query: CustomerPhoneCheckQuery,
  ): Promise<CustomerPhoneCheckDto> {
    return this.customers.phoneCheck(query);
  }

  @Get(':id')
  @RequirePermission('customers.view')
  get(@Param('id', new ZodValidationPipe(IdParam)) id: number): Promise<CustomerDetailDto> {
    return this.customers.get(id);
  }

  @Post()
  @RequirePermission('customers.create')
  create(
    @Body(new ZodValidationPipe(CustomerCreateBody)) body: CustomerCreateBody,
    @CurrentUser() actor: AuthContext,
  ): Promise<CustomerDto> {
    return this.customers.create(body, actor);
  }

  @Patch(':id')
  @RequirePermission('customers.edit')
  update(
    @Param('id', new ZodValidationPipe(IdParam)) id: number,
    @Body(new ZodValidationPipe(CustomerUpdateBody)) body: CustomerUpdateBody,
  ): Promise<CustomerDto> {
    return this.customers.update(id, body);
  }

  @Delete(':id')
  @RequirePermission('customers.delete')
  archive(
    @Param('id', new ZodValidationPipe(IdParam)) id: number,
    @Query(new ZodValidationPipe(VersionQuery)) query: VersionQuery,
    @CurrentUser() actor: AuthContext,
  ): Promise<CustomerDto> {
    return this.customers.archive(id, query.version, actor);
  }
}
