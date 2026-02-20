import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { HoroscopeModule } from '../horoscope/horoscope.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [HoroscopeModule, AuthModule],
  controllers: [UserController],
})
export class UserModule {}
