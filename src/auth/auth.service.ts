import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { I18nContext, I18nService } from 'nestjs-i18n';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService } from '../email/email.service.js';
import { randomBytes } from 'node:crypto';

const TOKEN_EXPIRY_MINUTES = 15;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private email: EmailService,
    private jwt: JwtService,
    private config: ConfigService,
    private i18n: I18nService,
  ) {}

  async sendMagicLink(email: string): Promise<{ message: string }> {
    let user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: { email },
      });
    }

    const lang = I18nContext.current()?.lang ?? 'en';

    const token = randomBytes(64).toString('hex');

    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);

    await this.prisma.loginLink.create({
      data: {
        token,
        expiresAt,
        userId: user.id,
      },
    });

    const frontendUrl = this.config.get<string>('FRONTEND_URL');

    const link = `${frontendUrl}/auth/verify?token=${token}`;

    await this.email.sendMagicLink(email, link, lang);

    return {
      message: this.i18n.t('auth.LINK_SENT', { lang }),
    };
  }

  async verifyMagicLink(token: string) {
    const loginLink = await this.prisma.loginLink.findUnique({
      where: { token },
      include: { user: true },
    });

    const lang = I18nContext.current()?.lang ?? 'en';

    const t = (key: string) => this.i18n.t(key, { lang });

    if (!loginLink) {
      throw new UnauthorizedException(t('auth.INVALID_LINK'));
    }

    if (loginLink.usedAt) {
      throw new UnauthorizedException(t('auth.LINK_ALREADY_USED'));
    }

    if (loginLink.expiresAt < new Date()) {
      throw new UnauthorizedException(t('auth.LINK_EXPIRED'));
    }

    await this.prisma.loginLink.update({
      where: { id: loginLink.id },
      data: { usedAt: new Date() },
    });

    const user = loginLink.user;

    const accessToken = this.jwt.sign(
      { sub: user.id, email: user.email },
      { expiresIn: this.config.get('JWT_EXPIRES_IN', '30d') },
    );

    return {
      accessToken,
    };
  }
}
