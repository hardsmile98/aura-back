import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service.js';
import { HoroscopeModule } from '../horoscope/horoscope.module.js';
import { SketchModule } from '../sketch/sketch.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [HoroscopeModule, SketchModule, AuthModule],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
