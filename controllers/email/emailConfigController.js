const { prisma } = require('../../config/database');
const { testSMTPConnection, sendEmail, sendEmailWithEnv } = require('../../config/connectSMTP');

// Get email configuration
const getEmail = async (req, res) => {
  try {
    const emailConfig = await prisma.emailConfiguration.findFirst({
      where: { isActive: true },
      select: {
        id: true,
        smtpHost: true,
        smtpPort: true,
        smtpUsername: true,
        fromEmail: true,
        fromName: true,
        encryption: true,
        isActive: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!emailConfig) {
      return res.status(404).json({
        success: false,
        message: 'Email configuration not found'
      });
    }

    res.status(200).json({
      success: true,
      data: emailConfig
    });
  } catch (error) {
    console.error('Get email config error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Create/Update email configuration
const postEmail = async (req, res) => {
  try {
    const {
      smtpHost,
      smtpPort,
      smtpUsername,
      smtpPassword,
      fromEmail,
      fromName,
      encryption = 'tls'
    } = req.body;

    // Validate required fields
    if (!smtpHost || !smtpPort || !smtpUsername || !smtpPassword || !fromEmail) {
      return res.status(400).json({
        success: false,
        message: 'All required fields must be provided'
      });
    }

    // Test SMTP connection before saving (optional - log error but don't block)
    try {
      const testResult = await testSMTPConnection({
        smtpHost,
        smtpPort,
        smtpUsername,
        smtpPassword,
        fromEmail,
        fromName,
        encryption
      });

      if (!testResult.success) {
        console.warn('SMTP connection test failed:', testResult.message);
        // Don't block saving - user can test later
      }
    } catch (testError) {
      console.warn('SMTP connection test error:', testError.message);
      // Continue with saving
    }

    // Deactivate existing configurations
    await prisma.emailConfiguration.updateMany({
      where: { isActive: true },
      data: { isActive: false }
    });

    // Create new configuration
    const emailConfig = await prisma.emailConfiguration.create({
      data: {
        smtpHost,
        smtpPort,
        smtpUsername,
        smtpPassword,
        fromEmail,
        fromName: fromName || 'System',
        encryption,
        isActive: true
      }
    });

    res.status(201).json({
      success: true,
      message: 'Email configuration saved successfully',
      data: {
        id: emailConfig.id,
        smtpHost: emailConfig.smtpHost,
        smtpPort: emailConfig.smtpPort,
        smtpUsername: emailConfig.smtpUsername,
        fromEmail: emailConfig.fromEmail,
        fromName: emailConfig.fromName,
        encryption: emailConfig.encryption,
        isActive: emailConfig.isActive
      }
    });
  } catch (error) {
    console.error('Post email config error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update email configuration
const putEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      smtpHost,
      smtpPort,
      smtpUsername,
      smtpPassword,
      fromEmail,
      fromName,
      encryption
    } = req.body;

    // Check if configuration exists
    const existingConfig = await prisma.emailConfiguration.findUnique({
      where: { id }
    });

    if (!existingConfig) {
      return res.status(404).json({
        success: false,
        message: 'Email configuration not found'
      });
    }

    // Test SMTP connection if credentials are provided
    if (smtpHost && smtpPort && smtpUsername && smtpPassword) {
      const testResult = await testSMTPConnection({
        smtpHost,
        smtpPort,
        smtpUsername,
        smtpPassword,
        fromEmail: fromEmail || existingConfig.fromEmail,
        fromName: fromName || existingConfig.fromName,
        encryption: encryption || existingConfig.encryption
      });

      if (!testResult.success) {
        return res.status(400).json({
          success: false,
          message: `SMTP connection failed: ${testResult.message}`
        });
      }
    }

    // Update configuration
    const updatedConfig = await prisma.emailConfiguration.update({
      where: { id },
      data: {
        ...(smtpHost && { smtpHost }),
        ...(smtpPort && { smtpPort }),
        ...(smtpUsername && { smtpUsername }),
        ...(smtpPassword && { smtpPassword }),
        ...(fromEmail && { fromEmail }),
        ...(fromName && { fromName }),
        ...(encryption && { encryption })
      }
    });

    res.status(200).json({
      success: true,
      message: 'Email configuration updated successfully',
      data: {
        id: updatedConfig.id,
        smtpHost: updatedConfig.smtpHost,
        smtpPort: updatedConfig.smtpPort,
        smtpUsername: updatedConfig.smtpUsername,
        fromEmail: updatedConfig.fromEmail,
        fromName: updatedConfig.fromName,
        encryption: updatedConfig.encryption,
        isActive: updatedConfig.isActive
      }
    });
  } catch (error) {
    console.error('Put email config error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Test email sending
const testEmail = async (req, res) => {
  try {
    const { to, subject, message } = req.body;

    if (!to || !subject || !message) {
      return res.status(400).json({
        success: false,
        message: 'To, subject, and message are required'
      });
    }

    // Get active email configuration
    const emailConfig = await prisma.emailConfiguration.findFirst({
      where: { isActive: true }
    });

    let result;

    if (emailConfig) {
      // Use database configuration
      result = await sendEmail(emailConfig, {
        to,
        subject,
        text: message,
        html: `<p>${message}</p>`
      });
    } else {
      // Fallback to environment variables
      result = await sendEmailWithEnv({
        to,
        subject,
        text: message,
        html: `<p>${message}</p>`
      });
    }

    if (result.success) {
      res.status(200).json({
        success: true,
        message: 'Test email sent successfully',
        messageId: result.messageId,
        source: emailConfig ? 'database' : 'environment'
      });
    } else {
      res.status(400).json({
        success: false,
        message: `Failed to send email: ${result.message}`
      });
    }
  } catch (error) {
    console.error('Test email error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports = {
  getEmail,
  postEmail,
  putEmail,
  testEmail
};
