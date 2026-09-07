import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { parseOptionalPositiveInt } from '../common/parse-positive-int';
import { CreateReviewPublicDto } from './dto/reviews.dto';
import { ReviewsPublicService } from './reviews.public.service';

@Controller('reviews')
export class ReviewsPublicController {
  constructor(private readonly reviews: ReviewsPublicService) {}

  @Public()
  @Get('latest')
  latest(
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ) {
    return this.reviews.listPublished({
      page: parseOptionalPositiveInt(page) ?? 1,
      limit: parseOptionalPositiveInt(limit) ?? 12,
    });
  }

  @Public()
  @Get('product/:slug')
  byProduct(
    @Param('slug') slug: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    let s = slug;
    try {
      s = decodeURIComponent(slug);
    } catch {
      /* as-is */
    }
    return this.reviews.listByProductSlug(s, {
      page: parseOptionalPositiveInt(page),
      limit: parseOptionalPositiveInt(limit),
    });
  }

  /** Product ids, по которым текущий пользователь уже оставлял отзыв (любой статус). */
  @UseGuards(JwtAuthGuard)
  @Get('mine/product-ids')
  mineProductIds(@CurrentUser('sub') userId: string) {
    return this.reviews.listMyReviewedProductIds(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @Body() dto: CreateReviewPublicDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.reviews.create(userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/images')
  @UseInterceptors(
    FilesInterceptor('files', 2, {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  attachImages(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser('sub') userId: string,
  ) {
    if (!files?.length) throw new BadRequestException('Файлы не переданы');
    return this.reviews.attachImages(id, userId, files);
  }
}
