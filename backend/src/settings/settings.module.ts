import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { SettingsAdminController } from './settings-admin.controller';
import { SettingsPublicController } from './settings.public.controller';
import { SettingsAdminService, SettingsPublicService } from './settings.service';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [SettingsAdminController, SettingsPublicController],
  providers: [SettingsAdminService, SettingsPublicService],
  exports: [SettingsPublicService, SettingsAdminService],
})
export class SettingsModule {}
