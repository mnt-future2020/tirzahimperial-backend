const { sendEmail: sendSMTPEmail, sendEmailWithEnv } = require("../../config/connectSMTP");
const { prisma } = require("../../config/database");
const { getApprovedEmailTemplate } = require("./templates/delivery-partner/approved");
const { getRejectedEmailTemplate } = require("./templates/delivery-partner/rejected");
const { getSuspendedEmailTemplate } = require("./templates/delivery-partner/suspended");

/**
 * Send email using centralized SMTP configuration
 */
async function sendPartnerEmail(emailData) {
  try {
    // Get active email configuration from database
    const emailConfig = await prisma.emailConfiguration.findFirst({
      where: { isActive: true }
    });

    let result;
    
    if (emailConfig) {
      // Use database SMTP configuration
      result = await sendSMTPEmail(emailConfig, emailData);
    } else {
      // Fallback to environment variables
      result = await sendEmailWithEnv(emailData);
    }

    if (!result.success) {
      throw new Error(result.message || 'Failed to send email');
    }
    
    return result;
  } catch (error) {
    console.error("❌ Partner email sending error:", error);
    throw error;
  }
}

/**
 * Send welcome email to approved partner
 */
async function sendPartnerWelcomeEmail({ name, email, partnerId, password, verificationToken }) {
  const emailTemplate = await getApprovedEmailTemplate({ 
    name, 
    email, 
    partnerId, 
    password, 
    verificationToken 
  });

  return await sendPartnerEmail({
    to: email,
    subject: emailTemplate.subject,
    html: emailTemplate.html,
  });
}

/**
 * Send rejection email
 */
async function sendPartnerRejectionEmail({ name, email, reason, note }) {
  const emailTemplate = await getRejectedEmailTemplate({ 
    name, 
    email, 
    reason, 
    note 
  });

  return await sendPartnerEmail({
    to: email,
    subject: emailTemplate.subject,
    html: emailTemplate.html,
  });
}

/**
 * Send suspension email
 */
async function sendPartnerSuspensionEmail({ name, email, partnerId, reason, note }) {
  const emailTemplate = await getSuspendedEmailTemplate({ 
    name, 
    email, 
    partnerId, 
    reason, 
    note 
  });

  return await sendPartnerEmail({
    to: email,
    subject: emailTemplate.subject,
    html: emailTemplate.html,
  });
}

module.exports = {
  sendPartnerWelcomeEmail,
  sendPartnerRejectionEmail,
  sendPartnerSuspensionEmail,
};
