import nodemailer from 'nodemailer'
import { getEnvVar } from '@user-service/shared'
import { logger } from '../lib/logger'

interface EmailTemplate {
  subject: string
  html: string
  text: string
}

export class EmailService {
  private static instance: EmailService
  private transporter: nodemailer.Transporter
  
  private constructor() {
    // Configure transporter based on environment
    if (process.env.NODE_ENV === 'development') {
      // Use Mailhog in development
      this.transporter = nodemailer.createTransport({
        host: getEnvVar('SMTP_HOST', 'localhost'),
        port: parseInt(getEnvVar('SMTP_PORT', '1025')),
        secure: false,
      })
    } else {
      // Production configuration
      this.transporter = nodemailer.createTransporter({
        host: getEnvVar('SMTP_HOST'),
        port: parseInt(getEnvVar('SMTP_PORT')),
        secure: getEnvVar('SMTP_PORT') === '465',
        auth: {
          user: getEnvVar('SMTP_USER'),
          pass: getEnvVar('SMTP_PASS'),
        },
      })
    }
    
    // Verify connection
    this.transporter.verify((error, success) => {
      if (error) {
        logger.error({ error }, 'Email service connection failed')
      } else {
        logger.info('Email service connected')
      }
    })
  }
  
  static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService()
    }
    return EmailService.instance
  }
  
  async sendEmail(to: string, template: EmailTemplate) {
    try {
      const info = await this.transporter.sendMail({
        from: getEnvVar('SMTP_FROM', 'noreply@userservice.com'),
        to,
        subject: template.subject,
        text: template.text,
        html: template.html,
      })
      
      logger.info({ messageId: info.messageId, to }, 'Email sent')
      return info
    } catch (error) {
      logger.error({ error, to }, 'Failed to send email')
      throw error
    }
  }
  
  // Email templates
  async sendVerificationEmail(email: string, data: {
    name?: string
    verificationUrl: string
  }) {
    const template = this.getVerificationEmailTemplate(data)
    return this.sendEmail(email, template)
  }
  
  async sendMagicLinkEmail(email: string, data: {
    token: string
    expiresIn: string
    loginUrl: string
  }) {
    const template = this.getMagicLinkTemplate(data)
    return this.sendEmail(email, template)
  }
  
  async sendInvitationEmail(email: string, data: {
    inviterName: string
    organizationName: string
    invitationUrl: string
    message?: string
  }) {
    const template = this.getInvitationTemplate(data)
    return this.sendEmail(email, template)
  }
  
  async sendPasswordResetEmail(email: string, data: {
    name?: string
    resetUrl: string
    expiresIn: string
  }) {
    const template = this.getPasswordResetTemplate(data)
    return this.sendEmail(email, template)
  }
  
  async sendWelcomeEmail(email: string, data: {
    name?: string
    loginUrl: string
  }) {
    const template = this.getWelcomeTemplate(data)
    return this.sendEmail(email, template)
  }
  
  // Template generators
  private getVerificationEmailTemplate(data: {
    name?: string
    verificationUrl: string
  }): EmailTemplate {
    const greeting = data.name ? `Hi ${data.name},` : 'Hi,'
    
    return {
      subject: 'Verify your email address',
      text: `${greeting}

Please verify your email address by clicking the link below:

${data.verificationUrl}

This link will expire in 24 hours.

If you didn't create an account, you can safely ignore this email.

Best regards,
The User Service Team`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .button { display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px; }
    .footer { margin-top: 40px; font-size: 14px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Verify your email address</h2>
    <p>${greeting}</p>
    <p>Please verify your email address by clicking the button below:</p>
    <p><a href="${data.verificationUrl}" class="button">Verify Email</a></p>
    <p>Or copy and paste this link into your browser:</p>
    <p>${data.verificationUrl}</p>
    <p>This link will expire in 24 hours.</p>
    <div class="footer">
      <p>If you didn't create an account, you can safely ignore this email.</p>
      <p>Best regards,<br>The User Service Team</p>
    </div>
  </div>
</body>
</html>
      `,
    }
  }
  
  private getMagicLinkTemplate(data: {
    token: string
    expiresIn: string
    loginUrl: string
  }): EmailTemplate {
    return {
      subject: 'Your magic link to sign in',
      text: `Sign in to your account

Click the link below to sign in to your account:

${data.loginUrl}

This link will expire in ${data.expiresIn}.

If you didn't request this, you can safely ignore this email.

Best regards,
The User Service Team`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .button { display: inline-block; padding: 12px 24px; background-color: #28a745; color: white; text-decoration: none; border-radius: 4px; }
    .footer { margin-top: 40px; font-size: 14px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Sign in to your account</h2>
    <p>Click the button below to sign in to your account:</p>
    <p><a href="${data.loginUrl}" class="button">Sign In</a></p>
    <p>Or copy and paste this link into your browser:</p>
    <p style="word-break: break-all;">${data.loginUrl}</p>
    <p>This link will expire in ${data.expiresIn}.</p>
    <div class="footer">
      <p>If you didn't request this, you can safely ignore this email.</p>
      <p>Best regards,<br>The User Service Team</p>
    </div>
  </div>
</body>
</html>
      `,
    }
  }
  
  private getInvitationTemplate(data: {
    inviterName: string
    organizationName: string
    invitationUrl: string
    message?: string
  }): EmailTemplate {
    return {
      subject: `You've been invited to join ${data.organizationName}`,
      text: `You've been invited!

${data.inviterName} has invited you to join ${data.organizationName}.

${data.message ? `Message from ${data.inviterName}:\n${data.message}\n\n` : ''}Click the link below to accept the invitation:

${data.invitationUrl}

This invitation will expire in 7 days.

Best regards,
The User Service Team`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .button { display: inline-block; padding: 12px 24px; background-color: #17a2b8; color: white; text-decoration: none; border-radius: 4px; }
    .message { background-color: #f8f9fa; padding: 16px; border-radius: 4px; margin: 20px 0; }
    .footer { margin-top: 40px; font-size: 14px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <h2>You've been invited!</h2>
    <p><strong>${data.inviterName}</strong> has invited you to join <strong>${data.organizationName}</strong>.</p>
    ${data.message ? `
    <div class="message">
      <p><strong>Message from ${data.inviterName}:</strong></p>
      <p>${data.message}</p>
    </div>
    ` : ''}
    <p><a href="${data.invitationUrl}" class="button">Accept Invitation</a></p>
    <p>Or copy and paste this link into your browser:</p>
    <p style="word-break: break-all;">${data.invitationUrl}</p>
    <p>This invitation will expire in 7 days.</p>
    <div class="footer">
      <p>Best regards,<br>The User Service Team</p>
    </div>
  </div>
</body>
</html>
      `,
    }
  }
  
  private getPasswordResetTemplate(data: {
    name?: string
    resetUrl: string
    expiresIn: string
  }): EmailTemplate {
    const greeting = data.name ? `Hi ${data.name},` : 'Hi,'
    
    return {
      subject: 'Reset your password',
      text: `${greeting}

We received a request to reset your password. Click the link below to create a new password:

${data.resetUrl}

This link will expire in ${data.expiresIn}.

If you didn't request this, you can safely ignore this email. Your password won't be changed.

Best regards,
The User Service Team`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .button { display: inline-block; padding: 12px 24px; background-color: #dc3545; color: white; text-decoration: none; border-radius: 4px; }
    .footer { margin-top: 40px; font-size: 14px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Reset your password</h2>
    <p>${greeting}</p>
    <p>We received a request to reset your password. Click the button below to create a new password:</p>
    <p><a href="${data.resetUrl}" class="button">Reset Password</a></p>
    <p>Or copy and paste this link into your browser:</p>
    <p style="word-break: break-all;">${data.resetUrl}</p>
    <p>This link will expire in ${data.expiresIn}.</p>
    <div class="footer">
      <p>If you didn't request this, you can safely ignore this email. Your password won't be changed.</p>
      <p>Best regards,<br>The User Service Team</p>
    </div>
  </div>
</body>
</html>
      `,
    }
  }
  
  private getWelcomeTemplate(data: {
    name?: string
    loginUrl: string
  }): EmailTemplate {
    const greeting = data.name ? `Hi ${data.name},` : 'Hi,'
    
    return {
      subject: 'Welcome to User Service!',
      text: `${greeting}

Welcome to User Service! We're excited to have you on board.

Get started by logging in to your account:
${data.loginUrl}

If you have any questions, feel free to reach out to our support team.

Best regards,
The User Service Team`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .button { display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px; }
    .footer { margin-top: 40px; font-size: 14px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Welcome to User Service!</h2>
    <p>${greeting}</p>
    <p>We're excited to have you on board.</p>
    <p>Get started by logging in to your account:</p>
    <p><a href="${data.loginUrl}" class="button">Login to Your Account</a></p>
    <div class="footer">
      <p>If you have any questions, feel free to reach out to our support team.</p>
      <p>Best regards,<br>The User Service Team</p>
    </div>
  </div>
</body>
</html>
      `,
    }
  }
}

// Add nodemailer to dependencies
// This would be added to package.json dependencies:
// "nodemailer": "^6.9.8",
// "@types/nodemailer": "^6.4.14"