import nodemailer from 'nodemailer';

import type { AppConfig } from '../../config/env.js';

export interface AuthEmailSender {
  sendPasswordReset(input: { readonly email: string; readonly url: string }): Promise<void>;
  sendVerification(input: { readonly email: string; readonly url: string }): Promise<void>;
}

export function createAuthEmailSender(config: AppConfig): AuthEmailSender | null {
  if (!config.smtp) return null;

  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    ...(config.smtp.username && config.smtp.password
      ? { auth: { pass: config.smtp.password, user: config.smtp.username } }
      : {}),
  });

  return {
    async sendPasswordReset({ email, url }) {
      await transport.sendMail({
        from: config.smtp!.from,
        subject: 'Reset your Club password',
        text: `Reset your password: ${url}`,
        to: email,
      });
    },
    async sendVerification({ email, url }) {
      await transport.sendMail({
        from: config.smtp!.from,
        subject: 'Verify your Club email address',
        text: `Verify your email address: ${url}`,
        to: email,
      });
    },
  };
}
