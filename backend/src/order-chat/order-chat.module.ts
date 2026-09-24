import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { StaffModule } from '../staff/staff.module';
import { MailModule } from '../mail/mail.module';
import { resolveJwtSecret } from '../auth/jwt-secret';
import { OrderChatService } from './order-chat.service';
import { OrderChatGateway } from './order-chat.gateway';
import {
  OrderChatAccountController,
  OrderChatAccountOrdersController,
} from './order-chat-account.controller';
import { OrderChatAdminController } from './order-chat-admin.controller';
import { OrderChatRetentionWorker } from './order-chat-retention.worker';
import { OrderChatFilesController } from './order-chat-files.controller';

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    StaffModule,
    MailModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: resolveJwtSecret(config),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '12h') },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [
    OrderChatAccountController,
    OrderChatAccountOrdersController,
    OrderChatAdminController,
    OrderChatFilesController,
  ],
  providers: [OrderChatService, OrderChatGateway, OrderChatRetentionWorker],
  exports: [OrderChatService],
})
export class OrderChatModule {}
