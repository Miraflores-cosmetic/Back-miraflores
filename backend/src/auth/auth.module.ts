import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { RegistrationService } from './registration.service';
import { RegistrationCleanupWorker } from './registration-cleanup.worker';
import { resolveJwtSecret } from './jwt-secret';
import { PrismaModule } from '../prisma/prisma.module';
import { OrderChatModule } from '../order-chat/order-chat.module';

@Module({
  imports: [
    PrismaModule,
    OrderChatModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: resolveJwtSecret(config),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '12h') },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [AuthService, RegistrationService, RegistrationCleanupWorker, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
