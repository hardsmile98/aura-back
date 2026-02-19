import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nService } from 'nestjs-i18n';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor(
    private config: ConfigService,
    private i18n: I18nService,
  ) {
    this.transporter = nodemailer.createTransport({
      host: this.config.get('SMTP_HOST'),
      port: +this.config.get('SMTP_PORT'),
      secure: false,
      auth: {
        user: this.config.get('SMTP_USER'),
        pass: this.config.get('SMTP_PASS'),
      },
    });
  }

  async sendMagicLink(email: string, link: string, lang = 'en'): Promise<void> {
    const subject = this.i18n.t('email.LOGIN_SUBJECT', { lang });
    const body = this.i18n.t('email.LOGIN_BODY', { lang });
    const expiry = this.i18n.t('email.LINK_EXPIRY', { lang });

    await this.transporter.sendMail({
      from: this.config.get('SMTP_FROM', '"Aura" <noreply@aura.app>'),
      to: email,
      subject,
      html: `
        <p>${body}</p>
        <p><a href="${link}">${link}</a></p>
        <p>${expiry}</p>
      `,
    });
  }
}
