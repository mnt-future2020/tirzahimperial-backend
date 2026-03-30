const { sendEmail, sendEmailWithEnv } = require("../../config/connectSMTP");
const { prisma } = require("../../config/database");

// Handle contact form submission
const submitContactForm = async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: "Name is required",
      });
    }

    if (!email || !email.trim()) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: "Message is required",
      });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: "Invalid email format",
      });
    }

    console.log("Processing contact form submission...");

    // Get company settings to get admin email
    const companySettings = await prisma.companySettings.findFirst();
    const adminEmail = companySettings?.email || process.env.ADMIN_EMAIL;

    if (!adminEmail) {
      console.error("Admin email not configured");
      return res.status(500).json({
        success: false,
        error: "Contact form is not configured properly. Please try again later.",
      });
    }

    // Prepare email content
    const emailSubject = `New Contact Form Submission from ${name}`;
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>New Contact Form Submission</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Inter:wght@300;400;500&display=swap');
        </style>
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Inter', Arial, sans-serif; background: linear-gradient(135deg, #faf7f4 0%, #f5f1eb 100%); min-height: 100vh;">
        <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          
          <!-- Luxury Header -->
          <div style="background: linear-gradient(135deg, #2d1f0e 0%, #1a1209 100%); position: relative; overflow: hidden;">
            <!-- Gold accent border -->
            <div style="height: 4px; background: linear-gradient(90deg, #c49a3c 0%, #d4af47 50%, #c49a3c 100%);"></div>
            
            <!-- Header Content -->
            <div style="padding: 40px; text-align: center; position: relative;">
              <!-- Decorative elements -->
              <div style="position: absolute; top: 15px; left: 15px; width: 40px; height: 40px; border: 1px solid #c49a3c; opacity: 0.3; transform: rotate(45deg);"></div>
              <div style="position: absolute; bottom: 15px; right: 15px; width: 30px; height: 30px; border: 1px solid #c49a3c; opacity: 0.2; transform: rotate(45deg);"></div>
              
              <div style="display: inline-block; background: rgba(196, 154, 60, 0.15); padding: 15px; margin-bottom: 20px; border: 1px solid rgba(196, 154, 60, 0.3);">
                <div style="color: #c49a3c; font-size: 32px;">📧</div>
              </div>
              
              <h1 style="font-family: 'Playfair Display', serif; color: #c49a3c; margin: 0 0 10px 0; font-size: 28px; font-weight: 700; letter-spacing: 1.5px; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">
                NEW INQUIRY
              </h1>
              <p style="color: #faf7f4; font-size: 16px; font-weight: 300; letter-spacing: 0.8px; margin: 0; opacity: 0.9;">
                Contact Form Submission
              </p>
            </div>
          </div>

          <!-- Main Content -->
          <div style="background: #faf7f4; padding: 40px; border-left: 4px solid #c49a3c; border-right: 4px solid #c49a3c;">
            
            <!-- Introduction -->
            <div style="text-align: center; margin-bottom: 35px;">
              <div style="width: 60px; height: 2px; background: #c49a3c; margin: 0 auto 25px auto;"></div>
              <p style="color: #2d1f0e; font-size: 18px; font-weight: 400; letter-spacing: 0.5px; margin: 0 0 15px 0;">
                New Contact Form Submission
              </p>
              <p style="color: #6b5040; font-size: 14px; font-weight: 300; letter-spacing: 0.3px; margin: 0; line-height: 1.6;">
                Received on ${new Date().toLocaleString('en-US', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </p>
            </div>

            <!-- Contact Details Card -->
            <div style="background: rgba(255, 255, 255, 0.8); border: 2px solid rgba(196, 154, 60, 0.2); padding: 30px; margin: 30px 0; position: relative;">
              <!-- Decorative corners -->
              <div style="position: absolute; top: -1px; left: -1px; width: 20px; height: 20px; background: #c49a3c;"></div>
              <div style="position: absolute; bottom: -1px; right: -1px; width: 20px; height: 20px; background: #c49a3c;"></div>
              
              <h3 style="font-family: 'Playfair Display', serif; color: #2d1f0e; font-size: 20px; font-weight: 600; margin: 0 0 25px 0; letter-spacing: 1px; text-align: center;">
                Contact Information
              </h3>
              
              <!-- Customer Name -->
              <div style="margin-bottom: 25px; padding: 20px; background: rgba(196, 154, 60, 0.05); border-left: 3px solid #c49a3c;">
                <div style="color: #6b5040; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">
                  Customer Name
                </div>
                <div style="color: #2d1f0e; font-size: 16px; font-weight: 500; letter-spacing: 0.3px;">
                  ${name}
                </div>
              </div>

              <!-- Email Address -->
              <div style="margin-bottom: 25px; padding: 20px; background: rgba(196, 154, 60, 0.05); border-left: 3px solid #c49a3c;">
                <div style="color: #6b5040; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">
                  Email Address
                </div>
                <div style="color: #2d1f0e; font-size: 16px; font-weight: 500; letter-spacing: 0.3px;">
                  <a href="mailto:${email}" style="color: #c49a3c; text-decoration: none;">${email}</a>
                </div>
              </div>

              ${phone ? `
              <!-- Phone Number -->
              <div style="margin-bottom: 25px; padding: 20px; background: rgba(196, 154, 60, 0.05); border-left: 3px solid #c49a3c;">
                <div style="color: #6b5040; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">
                  Phone Number
                </div>
                <div style="color: #2d1f0e; font-size: 16px; font-weight: 500; letter-spacing: 0.3px;">
                  <a href="tel:${phone}" style="color: #c49a3c; text-decoration: none;">${phone}</a>
                </div>
              </div>
              ` : ''}

              <!-- Message -->
              <div style="padding: 20px; background: rgba(196, 154, 60, 0.05); border-left: 3px solid #c49a3c;">
                <div style="color: #6b5040; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px;">
                  Message
                </div>
                <div style="color: #2d1f0e; font-size: 15px; font-weight: 400; letter-spacing: 0.2px; line-height: 1.7; white-space: pre-wrap;">
                  ${message.replace(/\n/g, '\n')}
                </div>
              </div>
            </div>

            <!-- Action Required -->
            <div style="text-align: center; margin: 40px 0; padding: 25px; background: rgba(196, 154, 60, 0.1); border: 2px solid rgba(196, 154, 60, 0.3);">
              <div style="color: #c49a3c; font-size: 24px; margin-bottom: 15px;">⏰</div>
              <p style="color: #2d1f0e; font-size: 16px; font-weight: 500; margin: 0 0 10px 0; letter-spacing: 0.5px;">
                Action Required
              </p>
              <p style="color: #6b5040; font-size: 14px; font-weight: 300; margin: 0; letter-spacing: 0.3px; line-height: 1.6;">
                Please respond to this customer inquiry within 24 hours to maintain our luxury service standards.
              </p>
            </div>

            <!-- Quick Actions -->
            <div style="text-align: center; margin: 35px 0;">
              <div style="width: 60px; height: 2px; background: #c49a3c; margin: 0 auto 25px auto;"></div>
              <p style="color: #2d1f0e; font-size: 16px; font-weight: 400; margin: 0 0 20px 0; letter-spacing: 0.5px;">
                Quick Actions
              </p>
              <div style="margin: 20px 0;">
                <a href="mailto:${email}?subject=Re: Your Inquiry - Luxury Beauty" 
                   style="display: inline-block; background: linear-gradient(135deg, #c49a3c 0%, #d4af47 100%); color: #2d1f0e; padding: 12px 25px; text-decoration: none; font-weight: 500; font-size: 14px; letter-spacing: 0.8px; text-transform: uppercase; margin: 0 10px 10px 0; box-shadow: 0 4px 15px rgba(196, 154, 60, 0.3);">
                  Reply via Email
                </a>
                ${phone ? `
                <a href="tel:${phone}" 
                   style="display: inline-block; background: transparent; color: #c49a3c; padding: 12px 25px; text-decoration: none; font-weight: 500; font-size: 14px; letter-spacing: 0.8px; text-transform: uppercase; border: 2px solid #c49a3c; margin: 0 10px 10px 0;">
                  Call Customer
                </a>
                ` : ''}
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div style="background: #2d1f0e; padding: 25px 40px; text-align: center;">
            <div style="height: 2px; background: linear-gradient(90deg, transparent 0%, #c49a3c 50%, transparent 100%); margin-bottom: 15px;"></div>
            <p style="color: #6b5040; font-size: 12px; font-weight: 300; margin: 0; letter-spacing: 0.5px; opacity: 0.8;">
              This email was automatically generated from your website's contact form.
            </p>
            <p style="color: #c49a3c; font-size: 11px; font-weight: 400; margin: 10px 0 0 0; letter-spacing: 1px; text-transform: uppercase;">
              Customer Service Excellence
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    const emailText = `
New Contact Form Submission

Name: ${name}
Email: ${email}
${phone ? `Phone: ${phone}` : ''}

Message:
${message}

---
Received on ${new Date().toLocaleString()}
    `;

    // Try to send email with SMTP configuration
    let emailResult;
    try {
      // First try with company email configuration if available
      const emailConfig = await prisma.emailConfiguration.findFirst();
      
      if (emailConfig && emailConfig.smtpHost) {
        emailResult = await sendEmail(emailConfig, {
          to: adminEmail,
          subject: emailSubject,
          text: emailText,
          html: emailHtml,
        });
      } else {
        // Fallback to environment variables
        emailResult = await sendEmailWithEnv({
          to: adminEmail,
          subject: emailSubject,
          text: emailText,
          html: emailHtml,
        });
      }

      if (!emailResult.success) {
        console.error("Failed to send email:", emailResult.message);
        return res.status(500).json({
          success: false,
          error: "Failed to send your message. Please try again later.",
        });
      }

      console.log("Contact form email sent successfully");

      res.status(200).json({
        success: true,
        message: "Your message has been sent successfully! We'll get back to you soon.",
      });
    } catch (emailError) {
      console.error("Error sending contact form email:", emailError);
      return res.status(500).json({
        success: false,
        error: "Failed to send your message. Please try again later.",
      });
    }
  } catch (error) {
    console.error("Error processing contact form:", error);
    res.status(500).json({
      success: false,
      error: "An error occurred while processing your request",
      message: error.message,
    });
  }
};

module.exports = {
  submitContactForm,
};
