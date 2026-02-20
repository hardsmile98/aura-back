import { Module } from '@nestjs/common';
import { HoroscopeService } from './horoscope.service';

@Module({
  providers: [HoroscopeService],
  exports: [HoroscopeService],
})
export class HoroscopeModule {}
