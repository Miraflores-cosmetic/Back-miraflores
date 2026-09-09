import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CatalogVisibilityMode, CatalogVisibilityTarget } from '@prisma/client';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { parseOptionalPositiveInt } from '../common/parse-positive-int';
import {
  CreateCatalogVisibilityDto,
  UpdateCatalogVisibilityDto,
} from './dto/catalog-visibility-admin.dto';
import {
  AssignGroupMemberDto,
  CreateUserGroupDto,
  ReplaceGroupCategoryPricesDto,
  ReplaceGroupVariantPricesDto,
  UpdateUserGroupDto,
  UpsertGroupCategoryPriceDto,
  UpsertGroupVariantPriceDto,
} from './dto/user-groups-admin.dto';
import { UserGroupsAdminService } from './user-groups-admin.service';

function parseOptionalBool01(raw?: string): boolean | undefined {
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return undefined;
}

@Controller('user-groups/admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class UserGroupsAdminController {
  constructor(private readonly groups: UserGroupsAdminService) {}

  @Get()
  list(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('active') active?: string,
  ) {
    return this.groups.list({
      q,
      page: parseOptionalPositiveInt(page),
      limit: parseOptionalPositiveInt(limit),
      active: parseOptionalBool01(active),
    });
  }

  @Post()
  create(@Body() dto: CreateUserGroupDto) {
    return this.groups.create(dto);
  }

  @Get(':id')
  one(@Param('id') id: string) {
    return this.groups.one(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserGroupDto) {
    return this.groups.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.groups.remove(id);
  }

  @Get(':id/members')
  listMembers(
    @Param('id') id: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.groups.listMembers(id, {
      q,
      page: parseOptionalPositiveInt(page),
      limit: parseOptionalPositiveInt(limit),
    });
  }

  @Post(':id/members')
  assignMember(@Param('id') id: string, @Body() dto: AssignGroupMemberDto) {
    return this.groups.assignMember(id, dto.userId);
  }

  @Delete(':id/members/:userId')
  removeMember(@Param('id') id: string, @Param('userId') userId: string) {
    return this.groups.removeMember(id, userId);
  }

  @Get(':id/variant-prices')
  listVariantPrices(
    @Param('id') id: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.groups.listVariantPrices(id, {
      q,
      page: parseOptionalPositiveInt(page),
      limit: parseOptionalPositiveInt(limit),
    });
  }

  @Put(':id/variant-prices')
  replaceVariantPrices(@Param('id') id: string, @Body() dto: ReplaceGroupVariantPricesDto) {
    return this.groups.replaceVariantPrices(id, dto);
  }

  @Patch(':id/variant-prices/:variantId')
  upsertVariantPrice(
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body() dto: UpsertGroupVariantPriceDto,
  ) {
    return this.groups.upsertVariantPrice(id, variantId, dto);
  }

  @Delete(':id/variant-prices/:variantId')
  deleteVariantPrice(@Param('id') id: string, @Param('variantId') variantId: string) {
    return this.groups.deleteVariantPrice(id, variantId);
  }

  @Get(':id/category-prices')
  listCategoryPrices(@Param('id') id: string) {
    return this.groups.listCategoryPrices(id);
  }

  @Put(':id/category-prices')
  replaceCategoryPrices(@Param('id') id: string, @Body() dto: ReplaceGroupCategoryPricesDto) {
    return this.groups.replaceCategoryPrices(id, dto);
  }

  @Post(':id/category-prices/bulk')
  bulkUpsertCategoryPrices(
    @Param('id') id: string,
    @Body() dto: ReplaceGroupCategoryPricesDto,
  ) {
    return this.groups.bulkUpsertCategoryPrices(id, dto);
  }

  @Patch(':id/category-prices/:categoryId')
  upsertCategoryPrice(
    @Param('id') id: string,
    @Param('categoryId') categoryId: string,
    @Body() dto: UpsertGroupCategoryPriceDto,
  ) {
    return this.groups.upsertCategoryPrice(id, categoryId, dto);
  }

  @Delete(':id/category-prices/:categoryId')
  deleteCategoryPrice(@Param('id') id: string, @Param('categoryId') categoryId: string) {
    return this.groups.deleteCategoryPrice(id, categoryId);
  }

  @Get(':id/visibility')
  listGroupVisibility(@Param('id') id: string) {
    return this.groups.listGroupVisibility(id);
  }

  @Post(':id/visibility')
  createGroupVisibility(
    @Param('id') id: string,
    @Body() dto: CreateCatalogVisibilityDto,
  ) {
    return this.groups.createGroupVisibility(id, dto);
  }

  @Patch(':id/visibility/:ruleId')
  updateGroupVisibility(
    @Param('id') id: string,
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateCatalogVisibilityDto,
  ) {
    return this.groups.updateGroupVisibility(id, ruleId, dto);
  }

  @Delete(':id/visibility/:ruleId')
  deleteGroupVisibility(@Param('id') id: string, @Param('ruleId') ruleId: string) {
    return this.groups.deleteGroupVisibility(id, ruleId);
  }
}

@Controller('catalog/admin/visibility')
@UseGuards(JwtAuthGuard, AdminGuard)
export class CatalogVisibilityAdminController {
  constructor(private readonly groups: UserGroupsAdminService) {}

  @Get()
  list(
    @Query('mode') mode?: string,
    @Query('targetType') targetType?: string,
    @Query('groupId') groupId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedMode = Object.values(CatalogVisibilityMode).includes(
      mode as CatalogVisibilityMode,
    )
      ? (mode as CatalogVisibilityMode)
      : undefined;
    const parsedTarget = Object.values(CatalogVisibilityTarget).includes(
      targetType as CatalogVisibilityTarget,
    )
      ? targetType
      : undefined;
    return this.groups.listAllVisibility({
      mode: parsedMode,
      targetType: parsedTarget,
      groupId: groupId?.trim() || undefined,
      page: parseOptionalPositiveInt(page),
      limit: parseOptionalPositiveInt(limit),
    });
  }

  @Post()
  create(@Body() dto: CreateCatalogVisibilityDto) {
    return this.groups.createVisibility(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCatalogVisibilityDto) {
    return this.groups.updateVisibility(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.groups.deleteVisibility(id);
  }
}
