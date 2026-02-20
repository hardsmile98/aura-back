import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { CreateLeadDto } from './dto/create-lead.dto.js';
import { SendMagicLinkDto } from './dto/send-magic-link.dto.js';
import { VerifyMagicLinkDto } from './dto/verify-magic-link.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('lead')
  async createLead(@Body() dto: CreateLeadDto) {
    return this.auth.createLead(dto.email, dto.quizResult, dto.locale);
  }

  @Post('send-link')
  async sendMagicLink(@Body() dto: SendMagicLinkDto) {
    return this.auth.sendMagicLink(dto.email);
  }

  @Post('verify')
  async verifyMagicLink(@Body() dto: VerifyMagicLinkDto) {
    return this.auth.verifyMagicLink(dto.token);
  }
}
