const { sendEmail: sendSMTPEmail, sendEmailWithEnv } = require("../../config/connectSMTP");

const sendAffiliateApprovalEmail = async ({
  to,
  name,
  affiliateCode,
  discountType,
  discountValue,
  commissionRate,
  maxUsageCount,
  validFrom,
  validUntil,
  loginUrl,
  supportEmail,
  companyName,
}) => {
  const subject = `Your Affiliate Access Code - ${companyName || "Affiliate Program"}`;
  const discountLabel = discountType
    ? discountType === "percentage"
      ? `${discountValue}% off`
      : `Rs. ${discountValue} off`
    : null;
  const commissionLabel = commissionRate !== undefined && commissionRate !== null
    ? `${commissionRate}% commission`
    : null;
  const usageLabel =
    maxUsageCount ? `Usage limit: <strong>${maxUsageCount} uses</strong>` : null;
  const validFromLabel = validFrom ? new Date(validFrom).toDateString() : null;
  const validUntilLabel = validUntil ? new Date(validUntil).toDateString() : null;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #111827;">
      <h2 style="font-weight: 600;">Welcome to the Affiliate Program</h2>
      <p>Hi ${name || "there"},</p>
      <p>Your application has been approved. Here is your unique affiliate code:</p>
      <div style="padding: 16px; background: #f5f1ea; border: 1px solid #e8ddd0; font-size: 20px; letter-spacing: 2px; text-align: center;">
        <strong>${affiliateCode}</strong>
      </div>
      ${discountLabel ? `<p style="margin-top: 12px;">Customer discount: <strong>${discountLabel}</strong></p>` : ""}
      ${commissionLabel ? `<p style="margin-top: 6px;">Your commission: <strong>${commissionLabel}</strong></p>` : ""}
      ${usageLabel ? `<p style="margin-top: 6px;">${usageLabel}</p>` : ""}
      ${validFromLabel ? `<p style="margin-top: 6px;">Valid from: <strong>${validFromLabel}</strong></p>` : ""}
      ${validUntilLabel ? `<p style="margin-top: 6px;">Valid until: <strong>${validUntilLabel}</strong></p>` : ""}
      <p style="margin-top: 16px;">Share this code with your audience for discounts.</p>
      <p style="margin-top: 16px;">Login to your account to view performance:</p>
      <p><a href="${loginUrl}" style="color: #b8860b;">${loginUrl}</a></p>
      <p style="margin-top: 24px; font-size: 12px; color: #6b7280;">If you didn\'t request this, contact us at ${supportEmail || "support"}.</p>
    </div>
  `;

  const emailConfig = await require("../../config/database").prisma.emailConfiguration.findFirst({
    where: { isActive: true },
  });

  if (emailConfig) {
    return sendSMTPEmail(emailConfig, { to, subject, html, text: html.replace(/<[^>]*>/g, "") });
  }

  return sendEmailWithEnv({ to, subject, html, text: html.replace(/<[^>]*>/g, "") });
};

module.exports = {
  sendAffiliateApprovalEmail,
  sendAffiliateRejectionEmail: async ({ to, name, reason, supportEmail, companyName }) => {
    const subject = `Affiliate Application Update - ${companyName || "Affiliate Program"}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #111827;">
        <h2 style="font-weight: 600;">Affiliate Application Update</h2>
        <p>Hi ${name || "there"},</p>
        <p>Thanks for your interest in our affiliate program. Unfortunately, we are unable to approve your application at this time.</p>
        ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}
        <p style="margin-top: 16px;">If you have questions, contact us at ${supportEmail || "support"}.</p>
      </div>
    `;

    const emailConfig = await require("../../config/database").prisma.emailConfiguration.findFirst({
      where: { isActive: true },
    });

    if (emailConfig) {
      return sendSMTPEmail(emailConfig, { to, subject, html, text: html.replace(/<[^>]*>/g, "") });
    }

    return sendEmailWithEnv({ to, subject, html, text: html.replace(/<[^>]*>/g, "") });
  },
  sendAffiliateStatusEmail: async ({ to, name, status, reason, supportEmail, companyName }) => {
    const subject = `${companyName || "Affiliate Program"} - Account ${status === "inactive" ? "Disabled" : "Enabled"}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #111827;">
        <h2 style="font-weight: 600;">Affiliate Account Update</h2>
        <p>Hi ${name || "there"},</p>
        ${
          status === "inactive"
            ? `<p>Your affiliate account has been disabled.</p>`
            : `<p>Your affiliate account has been enabled.</p>`
        }
        ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}
        <p style="margin-top: 16px;">If you have questions, contact us at ${supportEmail || "support"}.</p>
      </div>
    `;

    const emailConfig = await require("../../config/database").prisma.emailConfiguration.findFirst({
      where: { isActive: true },
    });

    if (emailConfig) {
      return sendSMTPEmail(emailConfig, { to, subject, html, text: html.replace(/<[^>]*>/g, "") });
    }

    return sendEmailWithEnv({ to, subject, html, text: html.replace(/<[^>]*>/g, "") });
  },
};
