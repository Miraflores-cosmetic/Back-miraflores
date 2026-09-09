import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { parseOptionalPositiveInt } from '../common/parse-positive-int';
import { UpdateUserGroupAssignmentDto } from '../user-groups/dto/user-groups-admin.dto';
import { UsersAdminService } from './users-admin.service';

/** Покупатели с аккаунтом — как Win-Win /admin/clients, без партнёров и групп. */
@Controller('users/admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class UsersAdminController {
  constructor(private readonly users: UsersAdminService) {}

  @Get()
  list(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.users.listRetailUsers({
      q,
      page: parseOptionalPositiveInt(page),
      limit: parseOptionalPositiveInt(limit),
    });
  }

  @Get(':id')
  one(
    @Param('id') id: string,
    @Query('ordersPage') ordersPage?: string,
    @Query('ordersLimit') ordersLimit?: string,
  ) {
    return this.users.getRetailUser(id, {
      ordersPage: parseOptionalPositiveInt(ordersPage),
      ordersLimit: parseOptionalPositiveInt(ordersLimit),
    });
  }

  @Patch(':id/group')
  updateGroup(@Param('id') id: string, @Body() dto: UpdateUserGroupAssignmentDto) {
    return this.users.updateUserGroup(id, dto.groupId ?? null);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.users.deleteRetailUser(id);
  }
}
