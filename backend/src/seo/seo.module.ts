import { Module, forwardRef } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SeoPrerenderController } from './seo-prerender.controller';
import { SeoPrerenderService } from './seo-prerender.service';
import { SeoService } from './seo.service';

@Module({
  imports: [PrismaModule, forwardRef(() => CatalogModule)],
  controllers: [SeoPrerenderController],
  providers: [SeoService, SeoPrerenderService],
  exports: [SeoService, SeoPrerenderService],
})
export class SeoModule {}
