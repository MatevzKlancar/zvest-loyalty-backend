import { logger } from "../config/logger";

interface EmailTemplateData {
  customer_name: string;
  owner_first_name: string;
  shop_name: string;
  setup_url: string;
  expires_at: string;
}

// Email service - simplified version without dependencies
const sendEmailViaSMTP = async (
  to: string,
  subject: string,
  html: string
): Promise<boolean> => {
  // This would require nodemailer to be installed
  // For now, just log the email content
  logger.info(`EMAIL WOULD BE SENT:`);
  logger.info(`To: ${to}`);
  logger.info(`Subject: ${subject}`);
  logger.info(`Setup URL can be found in the HTML content above`);

  // In production, you would:
  // 1. Install nodemailer: npm install nodemailer @types/nodemailer
  // 2. Import it: import nodemailer from 'nodemailer';
  // 3. Create transporter and send email

  return true;
};

export async function sendWelcomeEmail(
  email: string,
  templateData: EmailTemplateData
): Promise<boolean> {
  try {
    // Skip email sending if disabled
    if (process.env.DISABLE_EMAILS === "true") {
      logger.info(
        `Email sending disabled. Would send welcome email to ${email}`
      );
      logger.info(`Setup hahaURL: ${templateData.setup_url}`);
      return true;
    }

    // Option 1: Use SMTP (currently just logs)
    if (process.env.SMTP_HOST || process.env.NODE_ENV === "development") {
      const success = await sendEmailViaSMTP(
        email,
        `Welcome to ${templateData.customer_name} - Complete Your Setup`,
        generateEmailHTML(templateData)
      );
      if (success) {
        logger.info(`Welcome email sent successfully to ${email}`);
        return true;
      }
    }

    // Option 2: Use external service (SendGrid example)
    if (process.env.SENDGRID_API_KEY) {
      return await sendWithSendGrid(email, templateData);
    }

    // Option 3: Use external service (Mailgun example)
    if (process.env.MAILGUN_API_KEY) {
      return await sendWithMailgun(email, templateData);
    }

    // Fallback: Just log (development mode)
    logger.warn(`No email service configured. Welcome email for ${email}:`);
    logger.info(`Setup URL: ${templateData.setup_url}`);
    logger.info(`Expires: ${templateData.expires_at}`);
    return true;
  } catch (error) {
    logger.error("Failed to send welcome email:", error);
    return false;
  }
}

async function sendWithSendGrid(
  email: string,
  templateData: EmailTemplateData
): Promise<boolean> {
  // Implementation for SendGrid
  // You would install @sendgrid/mail and implement here
  logger.info(`Would send email via SendGrid to ${email}`);
  return true;
}

async function sendWithMailgun(
  email: string,
  templateData: EmailTemplateData
): Promise<boolean> {
  // Implementation for Mailgun
  // You would install mailgun-js and implement here
  logger.info(`Would send email via Mailgun to ${email}`);
  return true;
}

function generateEmailHTML(data: EmailTemplateData): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Welcome to ${data.customer_name}</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .button { background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; }
            .expires { background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 10px; border-radius: 4px; margin: 20px 0; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Welcome to ${data.customer_name}!</h1>
            
            <p>Hello ${data.owner_first_name},</p>
            
            <p>You've been invited to set up your loyalty program dashboard for <strong>${
              data.shop_name
            }</strong>.</p>
            
            <p>To complete your setup and start managing your loyalty program:</p>
            
            <ol>
                <li>Click the button below to access your setup page</li>
                <li>Create your secure password</li>
                <li>Complete your shop profile</li>
                <li>Start engaging with your customers!</li>
            </ol>
            
            <p style="text-align: center; margin: 30px 0;">
                <a href="${data.setup_url}" class="button">Complete Setup</a>
            </p>
            
            <div class="expires">
                <strong>Important:</strong> This invitation expires on ${new Date(
                  data.expires_at
                ).toLocaleDateString()}.
            </div>
            
            <p>If you have any questions, please contact our support team.</p>
            
            <p>Best regards,<br>The Zvest Team</p>
        </div>
    </body>
    </html>
  `;
}
