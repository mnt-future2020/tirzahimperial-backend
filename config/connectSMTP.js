const nodemailer = require("nodemailer");

// Create SMTP transporter with fallback to environment variables
const createTransporter = (config) => {
  const smtpConfig = {
    host: config?.smtpHost || process.env.SMTP_HOST,
    port: parseInt(config?.smtpPort || process.env.SMTP_PORT || "587"),
    secure: (config?.encryption || "tls") === "ssl",
    auth: {
      user: config?.smtpUsername || process.env.SMTP_USER,
      pass: config?.smtpPassword || process.env.SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: false,
    },
  };

  return nodemailer.createTransport(smtpConfig);
};

// Test SMTP connection
const testSMTPConnection = async (config) => {
  try {
    const transporter = createTransporter(config);
    await transporter.verify();
    return { success: true, message: "SMTP connection successful" };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

// Send email with fallback configuration
const sendEmail = async (config, emailData) => {
  try {
    const transporter = createTransporter(config);

    const fromEmail = config?.fromEmail || process.env.SMTP_FROM_EMAIL;
    const fromName = config?.fromName || "System";

    const mailOptions = {
      from: `${fromName} <${fromEmail}>`,
      to: emailData.to,
      subject: emailData.subject,
      text: emailData.text,
      html: emailData.html,
      attachments: emailData.attachments || [],
    };

    const result = await transporter.sendMail(mailOptions);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

// Send email using only environment variables
const sendEmailWithEnv = async (emailData) => {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: false, // Use TLS
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });

    const mailOptions = {
      from: `System <${process.env.SMTP_FROM_EMAIL}>`,
      to: emailData.to,
      subject: emailData.subject,
      text: emailData.text,
      html: emailData.html,
      attachments: emailData.attachments || [],
    };

    const result = await transporter.sendMail(mailOptions);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

module.exports = {
  createTransporter,
  testSMTPConnection,
  sendEmail,
  sendEmailWithEnv,
};
