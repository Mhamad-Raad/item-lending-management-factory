import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  IdParam,
  UserCreateBody,
  UserListQuery,
  UserPermissionsBody,
  UserResetPasswordBody,
  UserUpdateBody,
  type PageDto,
  type UserDto,
  type UserListItemDto,
} from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { AdminOnly } from '../../common/decorators/access.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UsersService } from './users.service';

/** Every route is admin-only: user management is not a grantable permission (§3.2). */
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @AdminOnly()
  list(@Query(new ZodValidationPipe(UserListQuery)) query: UserListQuery): Promise<PageDto<UserListItemDto>> {
    return this.users.list(query);
  }

  @Post()
  @AdminOnly()
  create(@Body(new ZodValidationPipe(UserCreateBody)) body: UserCreateBody): Promise<UserDto> {
    return this.users.create(body);
  }

  @Get(':id')
  @AdminOnly()
  get(@Param('id', new ZodValidationPipe(IdParam)) id: number): Promise<UserDto> {
    return this.users.get(id);
  }

  @Patch(':id')
  @AdminOnly()
  update(
    @Param('id', new ZodValidationPipe(IdParam)) id: number,
    @Body(new ZodValidationPipe(UserUpdateBody)) body: UserUpdateBody,
    @CurrentUser() actor: AuthContext,
  ): Promise<UserDto> {
    return this.users.update(id, body, actor);
  }

  @Put(':id/permissions')
  @AdminOnly()
  setPermissions(
    @Param('id', new ZodValidationPipe(IdParam)) id: number,
    @Body(new ZodValidationPipe(UserPermissionsBody)) body: UserPermissionsBody,
  ): Promise<UserDto> {
    return this.users.setPermissions(id, body);
  }

  @Post(':id/reset-password')
  @AdminOnly()
  @HttpCode(204)
  resetPassword(
    @Param('id', new ZodValidationPipe(IdParam)) id: number,
    @Body(new ZodValidationPipe(UserResetPasswordBody)) body: UserResetPasswordBody,
  ): Promise<void> {
    return this.users.resetPassword(id, body);
  }

  @Post(':id/logout-all')
  @AdminOnly()
  @HttpCode(204)
  logoutAll(@Param('id', new ZodValidationPipe(IdParam)) id: number): Promise<void> {
    return this.users.logoutAll(id);
  }
}
