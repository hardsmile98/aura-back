import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nService } from 'nestjs-i18n';
import * as nodemailer from 'nodemailer';
import { readFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'node:crypto';
import { PrismaService } from 'src/prisma/prisma.service';
@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;
  private tokenExpiryMinutes: number;

  constructor(
    private config: ConfigService,
    private i18n: I18nService,
    private prismaService: PrismaService,
  ) {
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: Number(this.config.get<string>('SMTP_PORT')),
      secure: this.config.get<string>('SMTP_SECURE') === 'true',
      auth: {
        type: 'OAuth2',
        user: this.config.get<string>('SMTP_USER'),
        clientId: this.config.get<string>('SMTP_OAUTH_CLIENT_ID'),
        clientSecret: this.config.get<string>('SMTP_OAUTH_CLIENT_SECRET'),
        refreshToken: this.config.get<string>('SMTP_OAUTH_REFRESH_TOKEN'),
      },
    });

    this.tokenExpiryMinutes = Number(
      this.config.get<string>('TOKEN_EXPIRY_MINUTES'),
    );
  }

  async sendMagicLink(email: string, link: string, lang = 'en'): Promise<void> {
    const subject = this.i18n.t('email.LOGIN_SUBJECT', { lang });
    const body = this.i18n.t('email.LOGIN_BODY', { lang });
    const buttonText = this.i18n.t('email.LOGIN_BUTTON', { lang });
    const title = this.i18n.t('email.LOGIN_TITLE', { lang });
    const expiry = this.i18n.t('email.LINK_EXPIRY', { lang });

    const templatePath = join(__dirname, 'templates', 'login-template.html');

    let html = readFileSync(templatePath, 'utf-8');

    html = html
      .replace(/\{\{TITLE\}\}/g, title)
      .replace(/\{\{BODY\}\}/g, body)
      .replace(/\{\{LINK\}\}/g, link)
      .replace(/\{\{BUTTON_TEXT\}\}/g, buttonText)
      .replace(/\{\{EXPIRY\}\}/g, expiry);

    await this.transporter.sendMail({
      from: this.config.get('SMTP_FROM', '"Aura" <noreply@aura.app>'),
      to: email,
      subject,
      html,
    });
  }

  async sendSubscriptionActivated(
    userId: number,
    email: string,
    lang = 'en',
  ): Promise<void> {
    const subject = this.i18n.t('email.SUB_ACTIVATED_SUBJECT', { lang });
    const body = this.i18n.t('email.SUB_ACTIVATED_BODY', { lang });
    const title = this.i18n.t('email.SUB_ACTIVATED_TITLE', { lang });
    const buttonText = this.i18n.t('email.SUB_ACTIVATED_BUTTON', { lang });

    const token = randomBytes(64).toString('hex');

    const expiresAt = new Date(
      Date.now() + this.tokenExpiryMinutes * 60 * 1000,
    );

    await this.prismaService.loginLink.create({
      data: { token, expiresAt, userId },
    });

    const frontendUrl = this.config.get<string>('FRONTEND_URL');

    const loginLink = `${frontendUrl}/${lang}/auth/verify?token=${token}`;

    const templatePath = join(
      __dirname,
      'templates',
      'sub-activated-template.html',
    );

    let html = readFileSync(templatePath, 'utf-8');

    html = html
      .replace(/\{\{TITLE\}\}/g, title)
      .replace(/\{\{BODY\}\}/g, body)
      .replace(/\{\{LINK\}\}/g, loginLink)
      .replace(/\{\{BUTTON_TEXT\}\}/g, buttonText);

    await this.transporter.sendMail({
      from: this.config.get('SMTP_FROM', '"Aura" <noreply@aura.app>'),
      to: email,
      subject,
      html,
    });
  }
}
