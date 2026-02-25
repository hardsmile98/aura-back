import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nService } from 'nestjs-i18n';
import * as nodemailer from 'nodemailer';
import { readFileSync } from 'fs';
import { join } from 'path';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor(
    private config: ConfigService,
    private i18n: I18nService,
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
}
