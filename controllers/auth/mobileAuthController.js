const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { prisma } = require("../../config/database");
const sessionManager = require("../../utils/auth/sessionManager");
const { sendEmail: sendSMTPEmail, sendEmailWithEnv } = require("../../config/connectSMTP");
const { sendNewUserRegistrationAlert, sendWelcomeNotification } = require("../../utils/notification/sendNotification");

// Email helper - uses SMTP configuration
const sendEmail = async (emailData) => {
  try {
    console.log("📧 Attempting to send email to:", emailData.to);
    
    // Get active email configuration from database
    const emailConfig = await prisma.emailConfiguration.findFirst({
      where: { isActive: true }
    });

    let result;
    
    if (emailConfig) {
      // Use database SMTP configuration
      console.log("📧 Using database SMTP configuration");
      result = await sendSMTPEmail(emailConfig, {
        to: emailData.to,
        subject: emailData.subject,
        html: emailData.html,
        text: emailData.text || emailData.html?.replace(/<[^>]*>/g, '') // Strip HTML for text version
      });
    } else {
      // Fallback to environment variables
      console.log("📧 Using environment SMTP configuration");
      result = await sendEmailWithEnv({
        to: emailData.to,
        subject: emailData.subject,
        html: emailData.html,
        text: emailData.text || emailData.html?.replace(/<[^>]*>/g, '')
      });
    }

    if (result.success) {
      console.log("✅ Email sent successfully to:", emailData.to);
    } else {
      console.error("❌ Failed to send email:", result.message);
    }
    
    return result;
  } catch (error) {
    console.error("❌ Email sending error:", error);
    return { success: false, message: error.message };
  }
};

// Generate JWT Token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "7d" });
};

// Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const awardSignupBonus = async (userId) => {
  try {
    const settings = await prisma.rewardSettings.findFirst();
    if (!settings || !settings.enabled || !settings.signupBonus || settings.signupBonus <= 0) return;

    const existing = await prisma.rewardTransaction.findFirst({
      where: { userId, type: "signup_bonus" },
    });
    if (existing) return;

    let wallet = await prisma.rewardWallet.findUnique({ where: { userId } });
    if (!wallet) {
      wallet = await prisma.rewardWallet.create({ data: { userId } });
    }

    const nextBalance = wallet.balance + settings.signupBonus;
    await prisma.rewardWallet.update({
      where: { userId },
      data: {
        balance: nextBalance,
        totalEarned: wallet.totalEarned + settings.signupBonus,
        lastEarnedAt: new Date(),
      },
    });

    await prisma.rewardTransaction.create({
      data: {
        userId,
        type: "signup_bonus",
        points: settings.signupBonus,
        balanceAfter: nextBalance,
        note: "Signup bonus",
        status: "completed",
      },
    });
  } catch (error) {
    console.error("Signup bonus error:", error);
  }
};

/**
 * Mobile App Registration with OTP
 * POST /api/auth/mobile/register
 */
const mobileRegister = async (req, res) => {
  try {
    console.log("📱 Mobile registration request received:", req.body.email);
    const { email, password, name, phoneNumber } = req.body;

    // Validation
    if (!email || !password || !name || !phoneNumber) {
      return res.status(400).json({
        success: false,
        error: "Email, password, name, and phone number are required",
      });
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: "Invalid email format",
      });
    }

    // Phone number format validation
    const phoneRegex = /^\+?[\d\s-]{10,15}$/;
    if (!phoneRegex.test(phoneNumber)) {
      return res.status(400).json({
        success: false,
        error: "Invalid phone number format",
      });
    }

    console.log("✅ Validation passed");

    // Determine if this should be an admin or user
    const adminEmails = [process.env.ADMIN_EMAIL];
    const isAdmin = adminEmails.includes(email.toLowerCase());
    console.log("👤 User type:", isAdmin ? "admin" : "user");

    // Check if user/admin already exists
    console.log("🔍 Checking for existing user...");
    const existingUser = isAdmin
      ? await prisma.admin.findUnique({ where: { email } })
      : await prisma.user.findUnique({ where: { email } });

    const existingInOtherCollection = isAdmin
      ? await prisma.user.findUnique({ where: { email } })
      : await prisma.admin.findUnique({ where: { email } });

    if (existingUser || existingInOtherCollection) {
      console.log("❌ User already exists with email");
      return res.status(400).json({
        success: false,
        error: "Account already exists. Please sign in with your email or phone number and password.",
      });
    }

    // Check if phone number already exists
    console.log("🔍 Checking for existing phone number...");
    const existingPhone = isAdmin
      ? await prisma.admin.findFirst({ where: { phoneNumber } })
      : await prisma.user.findFirst({ where: { phoneNumber } });

    const existingPhoneInOtherCollection = isAdmin
      ? await prisma.user.findFirst({ where: { phoneNumber } })
      : await prisma.admin.findFirst({ where: { phoneNumber } });

    if (existingPhone || existingPhoneInOtherCollection) {
      console.log("❌ Phone number already exists");
      return res.status(400).json({
        success: false,
        error: "Account already exists. Please sign in with your email or phone number and password.",
      });
    }

    console.log("✅ User does not exist, proceeding...");

    // Hash password
    console.log("🔐 Hashing password...");
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    console.log("✅ Password hashed");

    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Prepare user data with OTP array
    const userData = {
      email,
      password: hashedPassword,
      name,
      phoneNumber,
      emailOTPs: [
        {
          otp,
          expiresAt: otpExpiry.toISOString(),
          createdAt: new Date().toISOString(),
        }
      ],
    };

    // Create user in appropriate collection
    console.log("💾 Creating user in database...");
    const user = isAdmin
      ? await prisma.admin.create({ data: userData })
      : await prisma.user.create({ data: userData });
    console.log("✅ User created:", user.id);

    // Create or Link Customer record for non-admin users
    let customerId = null;
    if (!isAdmin) {
      try {
        console.log("📝 Checking for existing customer record for user:", user.id);
        
        const existingCustomer = await prisma.customer.findFirst({
          where: {
            OR: [
              { email: user.email },
              { phoneNumber: user.phoneNumber }
            ]
          }
        });

        if (existingCustomer) {
          console.log("🔗 Customer already exists, linking user to existing customer:", existingCustomer.id);
          const updatedCustomer = await prisma.customer.update({
            where: { id: existingCustomer.id },
            data: {
              userId: user.id,
              isVerified: existingCustomer.isVerified || false,
            }
          });
          customerId = updatedCustomer.id;
          console.log("✅ User linked to existing customer:", customerId);
        } else {
          console.log("📝 Creating new customer record for user:", user.id);
          const customer = await prisma.customer.create({
            data: {
              userId: user.id,
              email: user.email,
              name: user.name,
              phoneNumber: user.phoneNumber,
              isVerified: false,
              provider: 'local',
            },
          });
          customerId = customer.id;
          console.log("✅ Customer record created:", customer.id);
        }
      } catch (customerError) {
        console.error("❌ Failed to handle customer record:");
        console.error("Error details:", customerError);
      }
    }

    if (!isAdmin) {
      await awardSignupBonus(user.id);
    }

    // Fetch company name dynamically
    let companyName = "Our Platform";
    try {
      const companySettings = await prisma.companySettings.findFirst();
      if (companySettings && companySettings.companyName) {
        companyName = companySettings.companyName;
      }
    } catch (error) {
      console.error("Error fetching company name:", error);
    }

    // Send OTP email
    const emailData = {
      to: email,
      subject: `Verify Your Email - ${companyName}`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Email Verification</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@300;400;500;600&display=swap');
            
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            
            body {
              font-family: 'Playfair Display', serif;
              background-color: #faf7f4;
              color: #2d1f0e;
              line-height: 1.6;
            }
            
            .container {
              max-width: 600px;
              margin: 0 auto;
              background: white;
              border: 1px solid #e8ddd0;
            }
            
            .header {
              background: linear-gradient(135deg, #c49a3c 0%, #d4af47 100%);
              padding: 40px 30px;
              text-align: center;
              border-bottom: 2px solid #e8ddd0;
            }
            
            .header h1 {
              color: white;
              font-size: 28px;
              font-weight: 300;
              letter-spacing: 3px;
              text-transform: uppercase;
              margin-bottom: 8px;
            }
            
            .header p {
              color: rgba(255, 255, 255, 0.9);
              font-size: 14px;
              font-weight: 300;
              letter-spacing: 1px;
            }
            
            .content {
              padding: 40px 30px;
              background: #faf7f4;
            }
            
            .greeting {
              font-size: 18px;
              font-weight: 400;
              color: #2d1f0e;
              margin-bottom: 20px;
              letter-spacing: 1px;
            }
            
            .message {
              font-size: 16px;
              font-weight: 300;
              color: #6b5040;
              margin-bottom: 30px;
              letter-spacing: 0.5px;
              line-height: 1.7;
            }
            
            .otp-container {
              background: white;
              border: 2px solid #c49a3c;
              padding: 30px;
              text-align: center;
              margin: 40px 0;
            }
            
            .otp-label {
              font-size: 14px;
              font-weight: 300;
              color: #6b5040;
              letter-spacing: 2px;
              text-transform: uppercase;
              margin-bottom: 15px;
            }
            
            .otp-code {
              font-size: 42px;
              font-weight: 400;
              color: #c49a3c;
              letter-spacing: 8px;
              margin: 0;
              font-family: 'Playfair Display', serif;
            }
            
            .otp-note {
              font-size: 13px;
              font-weight: 300;
              color: #6b5040;
              margin-top: 15px;
              letter-spacing: 1px;
            }
            
            .warning {
              background: #fff8e1;
              border-left: 4px solid #c49a3c;
              padding: 20px;
              margin: 30px 0;
            }
            
            .warning-text {
              font-size: 14px;
              font-weight: 300;
              color: #6b5040;
              letter-spacing: 0.5px;
            }
            
            .footer {
              background: #2d1f0e;
              padding: 30px;
              text-align: center;
              border-top: 2px solid #c49a3c;
            }
            
            .footer-text {
              color: #c49a3c;
              font-size: 12px;
              font-weight: 300;
              letter-spacing: 2px;
              text-transform: uppercase;
            }
            
            .divider {
              height: 1px;
              background: linear-gradient(90deg, transparent 0%, #c49a3c 50%, transparent 100%);
              margin: 30px 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Email Verification</h1>
              <p>Secure Account Access</p>
            </div>
            
            <div class="content">
              <div class="greeting">Hello ${name},</div>
              
              <div class="message">
                Welcome to ${companyName}! To complete your registration and secure your account, 
                please verify your email address using the verification code below.
              </div>
              
              <div class="otp-container">
                <div class="otp-label">Verification Code</div>
                <div class="otp-code">${otp}</div>
                <div class="otp-note">Enter this code to verify your email</div>
              </div>
              
              <div class="divider"></div>
              
              <div class="warning">
                <div class="warning-text">
                  <strong>Security Notice:</strong> This verification code will expire in 10 minutes. 
                  If you didn't create an account with us, please ignore this email.
                </div>
              </div>
            </div>
            
            <div class="footer">
              <div class="footer-text">${companyName}</div>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    // Send response immediately
    res.status(201).json({
      success: true,
      message: "Registration successful. Please check your email for OTP to verify your account.",
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: isAdmin ? "admin" : "user",
        otpSent: true,
      },
    });

    // Send email after response (non-blocking)
    setImmediate(async () => {
      try {
        await sendEmail(emailData);
        console.log(`✅ OTP email sent to: ${email}`);
      } catch (err) {
        console.error("Failed to send OTP email:", err);
      }
    });

    // Send new user registration notification to admins (only for non-admin users)
    if (!isAdmin) {
      setImmediate(async () => {
        try {
          await sendNewUserRegistrationAlert(user.name, user.email, customerId);
          console.log(`📱 New user registration notification sent to admins`);
        } catch (notifError) {
          console.error('⚠️ Failed to send registration notification:', notifError.message);
        }
      });
    }
  } catch (error) {
    console.error("Mobile registration error:", error);
    res.status(500).json({
      success: false,
      error: "Registration failed",
    });
  }
};

/**
 * Verify OTP for Mobile App
 * POST /api/auth/mobile/verify-otp
 */
const verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    console.log("📱 OTP verification request received for:", email);

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        error: "Email and OTP are required",
      });
    }

    // Find user in both collections
    let user = await prisma.user.findUnique({ where: { email } });
    let userType = "user";

    if (!user) {
      user = await prisma.admin.findUnique({ where: { email } });
      userType = "admin";
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // Check if already verified
    if (user.isVerified) {
      return res.json({
        success: true,
        message: "Email already verified",
        alreadyVerified: true,
      });
    }

    // Get OTP array
    const otpArray = Array.isArray(user.emailOTPs) ? user.emailOTPs : [];

    if (otpArray.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No OTP found. Please request a new OTP.",
      });
    }

    // Find valid OTP (check from latest to oldest)
    const now = new Date();
    let validOTP = null;

    for (let i = otpArray.length - 1; i >= 0; i--) {
      const otpEntry = otpArray[i];
      const expiryDate = new Date(otpEntry.expiresAt);

      if (otpEntry.otp === otp && expiryDate > now) {
        validOTP = otpEntry;
        break;
      }
    }

    if (!validOTP) {
      // Check if OTP exists but expired
      const expiredOTP = otpArray.find(entry => entry.otp === otp);
      if (expiredOTP) {
        return res.status(400).json({
          success: false,
          error: "OTP has expired. Please request a new OTP.",
          expired: true,
        });
      }

      return res.status(400).json({
        success: false,
        error: "Invalid OTP. Please check and try again.",
      });
    }

    // OTP is valid - verify user
    const updateData = {
      isVerified: true,
      emailOTPs: [], // Clear all OTPs after successful verification
    };

    let verifiedUser;
    if (userType === "admin") {
      verifiedUser = await prisma.admin.update({
        where: { id: user.id },
        data: updateData,
      });
    } else {
      verifiedUser = await prisma.user.update({
        where: { id: user.id },
        data: updateData,
      });

      // Update customer verification status
      try {
        await prisma.customer.updateMany({
          where: { userId: user.id },
          data: { isVerified: true },
        });
        console.log("✅ Customer verification status updated");
      } catch (customerError) {
        console.error("⚠️ Failed to update customer verification:", customerError);
      }
    }

    console.log(`✅ Email verified successfully for: ${verifiedUser.email}`);

    // Send welcome notification (non-blocking)
    if (userType === "user") {
      setImmediate(async () => {
        try {
          await sendWelcomeNotification(user.id, user.name);
          console.log(`🎉 Welcome notification sent to user: ${user.name}`);
        } catch (notifError) {
          console.error('⚠️ Failed to send welcome notification:', notifError.message);
        }
      });
    }

    res.json({
      success: true,
      message: "Email verified successfully",
      data: {
        id: verifiedUser.id,
        email: verifiedUser.email,
        name: verifiedUser.name,
        isVerified: true,
        role: userType,
      },
    });
  } catch (error) {
    console.error("OTP verification error:", error);
    res.status(500).json({
      success: false,
      error: "OTP verification failed",
    });
  }
};

/**
 * Resend OTP for Mobile App
 * POST /api/auth/mobile/resend-otp
 */
const resendOTP = async (req, res) => {
  try {
    const { email } = req.body;

    console.log("📱 Resend OTP request received for:", email);

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      });
    }

    // Find user in both collections
    let user = await prisma.user.findUnique({ where: { email } });
    let userType = "user";

    if (!user) {
      user = await prisma.admin.findUnique({ where: { email } });
      userType = "admin";
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // Check if already verified
    if (user.isVerified) {
      return res.json({
        success: true,
        message: "Email already verified",
        alreadyVerified: true,
      });
    }

    // Generate new OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Get existing OTP array
    const existingOTPs = Array.isArray(user.emailOTPs) ? user.emailOTPs : [];

    // Add new OTP to array (keep last 5 OTPs for history)
    const updatedOTPs = [
      ...existingOTPs.slice(-4), // Keep last 4 OTPs
      {
        otp,
        expiresAt: otpExpiry.toISOString(),
        createdAt: new Date().toISOString(),
      }
    ];

    // Update user with new OTP
    if (userType === "admin") {
      await prisma.admin.update({
        where: { id: user.id },
        data: { emailOTPs: updatedOTPs },
      });
    } else {
      await prisma.user.update({
        where: { id: user.id },
        data: { emailOTPs: updatedOTPs },
      });
    }

    console.log(`✅ New OTP generated for: ${email}`);

    // Fetch company name dynamically
    let companyName = "Our Platform";
    try {
      const companySettings = await prisma.companySettings.findFirst();
      if (companySettings && companySettings.companyName) {
        companyName = companySettings.companyName;
      }
    } catch (error) {
      console.error("Error fetching company name:", error);
    }

    // Send OTP email
    const emailData = {
      to: email,
      subject: `New Verification Code - ${companyName}`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>New Verification Code</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@300;400;500;600&display=swap');
            
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            
            body {
              font-family: 'Playfair Display', serif;
              background-color: #faf7f4;
              color: #2d1f0e;
              line-height: 1.6;
            }
            
            .container {
              max-width: 600px;
              margin: 0 auto;
              background: white;
              border: 1px solid #e8ddd0;
            }
            
            .header {
              background: linear-gradient(135deg, #c49a3c 0%, #d4af47 100%);
              padding: 40px 30px;
              text-align: center;
              border-bottom: 2px solid #e8ddd0;
            }
            
            .header h1 {
              color: white;
              font-size: 28px;
              font-weight: 300;
              letter-spacing: 3px;
              text-transform: uppercase;
              margin-bottom: 8px;
            }
            
            .header p {
              color: rgba(255, 255, 255, 0.9);
              font-size: 14px;
              font-weight: 300;
              letter-spacing: 1px;
            }
            
            .content {
              padding: 40px 30px;
              background: #faf7f4;
            }
            
            .greeting {
              font-size: 18px;
              font-weight: 400;
              color: #2d1f0e;
              margin-bottom: 20px;
              letter-spacing: 1px;
            }
            
            .message {
              font-size: 16px;
              font-weight: 300;
              color: #6b5040;
              margin-bottom: 30px;
              letter-spacing: 0.5px;
              line-height: 1.7;
            }
            
            .otp-container {
              background: white;
              border: 2px solid #c49a3c;
              padding: 30px;
              text-align: center;
              margin: 40px 0;
            }
            
            .otp-label {
              font-size: 14px;
              font-weight: 300;
              color: #6b5040;
              letter-spacing: 2px;
              text-transform: uppercase;
              margin-bottom: 15px;
            }
            
            .otp-code {
              font-size: 42px;
              font-weight: 400;
              color: #c49a3c;
              letter-spacing: 8px;
              margin: 0;
              font-family: 'Playfair Display', serif;
            }
            
            .otp-note {
              font-size: 13px;
              font-weight: 300;
              color: #6b5040;
              margin-top: 15px;
              letter-spacing: 1px;
            }
            
            .warning {
              background: #fff8e1;
              border-left: 4px solid #c49a3c;
              padding: 20px;
              margin: 30px 0;
            }
            
            .warning-text {
              font-size: 14px;
              font-weight: 300;
              color: #6b5040;
              letter-spacing: 0.5px;
            }
            
            .footer {
              background: #2d1f0e;
              padding: 30px;
              text-align: center;
              border-top: 2px solid #c49a3c;
            }
            
            .footer-text {
              color: #c49a3c;
              font-size: 12px;
              font-weight: 300;
              letter-spacing: 2px;
              text-transform: uppercase;
            }
            
            .divider {
              height: 1px;
              background: linear-gradient(90deg, transparent 0%, #c49a3c 50%, transparent 100%);
              margin: 30px 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>New Verification Code</h1>
              <p>Resend Request Processed</p>
            </div>
            
            <div class="content">
              <div class="greeting">Hello ${user.name},</div>
              
              <div class="message">
                You requested a new verification code for your ${companyName} account. 
                Please use the fresh verification code below to complete your email verification.
              </div>
              
              <div class="otp-container">
                <div class="otp-label">New Verification Code</div>
                <div class="otp-code">${otp}</div>
                <div class="otp-note">Enter this code to verify your email</div>
              </div>
              
              <div class="divider"></div>
              
              <div class="warning">
                <div class="warning-text">
                  <strong>Security Notice:</strong> This new verification code will expire in 10 minutes. 
                  If you didn't request this code, please ignore this email and secure your account.
                </div>
              </div>
            </div>
            
            <div class="footer">
              <div class="footer-text">${companyName}</div>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    // Send response immediately
    res.json({
      success: true,
      message: "New OTP sent to your email",
      data: {
        email: user.email,
        otpSent: true,
      },
    });

    // Send email after response (non-blocking)
    setImmediate(async () => {
      try {
        await sendEmail(emailData);
        console.log(`✅ Resend OTP email sent to: ${email}`);
      } catch (err) {
        console.error("Failed to send resend OTP email:", err);
      }
    });
  } catch (error) {
    console.error("Resend OTP error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to resend OTP",
    });
  }
};

/**
 * Mobile App Login (same as web, but returns mobile-friendly response)
 * POST /api/auth/mobile/login
 */
const mobileLogin = async (req, res) => {
  try {
    const { email, password, fcmToken } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email or phone number and password are required",
      });
    }

    // Check if input is email or phone number
    const isEmail = /\S+@\S+\.\S+/.test(email);
    const searchField = isEmail ? "email" : "phoneNumber";

    console.log(`📱 Mobile login attempt with ${searchField}:`, email);

    // Find user in both collections
    let user = isEmail
      ? await prisma.user.findUnique({ where: { email } })
      : await prisma.user.findFirst({ where: { phoneNumber: email } });
    let userType = "user";

    if (!user) {
      user = isEmail
        ? await prisma.admin.findUnique({ where: { email } })
        : await prisma.admin.findFirst({ where: { phoneNumber: email } });
      userType = "admin";
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Invalid email/phone number or password",
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        error: "Account is deactivated. Please contact administrator.",
      });
    }

    // Check if email is verified
    if (!user.isVerified) {
      return res.status(401).json({
        success: false,
        error: "Please verify your email before signing in. Check your inbox for the OTP.",
        needsVerification: true,
      });
    }

    // For Google OAuth users without password
    if (!user.password && user.provider === "google") {
      return res.status(401).json({
        success: false,
        error: "Please sign in with Google",
        useGoogleAuth: true,
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: "Invalid email or password",
      });
    }

    // Update last login and FCM token if provided
    const updateData = { lastLogin: new Date() };

    // Handle FCM token for mobile app
    if (fcmToken) {
      const existingTokens = Array.isArray(user.fcmTokens) ? user.fcmTokens : [];
      const device = req.headers['user-agent'] || 'Mobile App';
      const now = new Date();

      // Remove existing token if present
      const filteredTokens = existingTokens.filter(t => t.token !== fcmToken);

      // Add new token
      filteredTokens.unshift({
        token: fcmToken,
        device: device,
        lastUsed: now.toISOString(),
      });

      // Keep only last 10 devices
      updateData.fcmTokens = filteredTokens.slice(0, 10);
    }

    if (userType === "admin") {
      await prisma.admin.update({
        where: { id: user.id },
        data: updateData,
      });
    } else {
      await prisma.user.update({
        where: { id: user.id },
        data: updateData,
      });
    }

    // Generate token
    const token = generateToken(user.id);

    // Track active session
    await sessionManager.addSession(user.id, token);

    res.json({
      success: true,
      message: "Login successful",
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: userType,
          image: user.image,
          isVerified: user.isVerified,
          phoneNumber: user.phoneNumber,
          address: user.address,
          city: user.city,
          state: user.state,
          zipCode: user.zipCode,
          country: user.country,
          dateOfBirth: user.dateOfBirth,
          currency: userType === "admin" ? user.currency : undefined,
          companyName: userType === "admin" ? user.companyName : undefined,
          gstNumber: userType === "admin" ? user.gstNumber : undefined,
          onboardingCompleted: userType === "admin" ? user.onboardingCompleted : undefined,
        },
      },
    });
  } catch (error) {
    console.error("Mobile login error:", error);
    res.status(500).json({
      success: false,
      error: "Login failed",
    });
  }
};

module.exports = {
  mobileRegister,
  verifyOTP,
  resendOTP,
  mobileLogin,
};
