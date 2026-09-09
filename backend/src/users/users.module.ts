import { Module } from '@nestjs/common';
import { UserGroupsModule } from '../user-groups/user-groups.module';
import { UsersAdminController } from './users-admin.controller';
import { UsersAdminService } from './users-admin.service';

@Module({
  imports: [UserGroupsModule],
  controllers: [UsersAdminController],
  providers: [UsersAdminService],
})
export class UsersModule {}
