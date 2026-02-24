import { Module } from '@nestjs/common';
import { SketchService } from './sketch.service';

@Module({
  providers: [SketchService],
  exports: [SketchService],
})
export class SketchModule {}
