import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { parseOptionalPositiveInt } from '../common/parse-positive-int';
import {
  BulkRejectReviewsDto,
  BulkReviewIdsDto,
  CreateReviewAdminDto,
  RejectReviewAdminDto,
  ReorderReviewsAdminDto,
  UpdateReviewAdminDto,
} from './dto/reviews.dto';
import { ReviewsAdminService } from './reviews.admin.service';

@Controller('reviews/admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class ReviewsAdminController {
  constructor(private readonly reviews: ReviewsAdminService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 80 * 1024 * 1024 },
    }),
  )
  upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Файл не передан');
    return this.reviews.uploadMedia(file);
  }

  @Get()
  list(
    @Query('q') q?: string,
    @Query('status') status?: 'all' | 'pending' | 'published' | 'rejected',
    @Query('productId') productId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const st =
      status === 'pending' ||
      status === 'published' ||
      status === 'all' ||
      status === 'rejected'
        ? status
        : 'all';
    return this.reviews.list({
      q,
      status: st,
      productId,
      page: parseOptionalPositiveInt(page),
      limit: parseOptionalPositiveInt(limit),
    });
  }

  @Post('reorder')
  reorder(@Body() dto: ReorderReviewsAdminDto) {
    return this.reviews.reorder(dto.orderedIds);
  }

  @Post('bulk-publish')
  bulkPublish(@Body() dto: BulkReviewIdsDto, @CurrentUser('sub') userId: string) {
    return this.reviews.bulkPublish(dto.ids, userId);
  }

  @Post('bulk-reject')
  bulkReject(@Body() dto: BulkRejectReviewsDto, @CurrentUser('sub') userId: string) {
    return this.reviews.bulkReject(dto.ids, dto.reason, userId);
  }

  @Post('bulk-delete')
  bulkDelete(@Body() dto: BulkReviewIdsDto) {
    return this.reviews.bulkRemove(dto.ids);
  }

  @Post()
  create(@Body() dto: CreateReviewAdminDto, @CurrentUser('sub') userId: string) {
    return this.reviews.create(dto, userId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.reviews.get(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateReviewAdminDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.reviews.update(id, dto, userId);
  }

  @Post(':id/publish')
  publish(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.reviews.publish(id, userId);
  }

  @Post(':id/unpublish')
  unpublish(@Param('id') id: string) {
    return this.reviews.unpublish(id);
  }

  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectReviewAdminDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.reviews.reject(id, dto.reason, userId);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.reviews.remove(id);
  }
}
