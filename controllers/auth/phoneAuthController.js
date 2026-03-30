const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { prisma } = require("../../config/database");
const admin = require('firebase-admin');
const { getFirebaseAdmin } = require('../../utils/firebase/firebaseAdmin');
const sessionManager = require("../../utils/auth/sessionManager");
const { sendNewUserRegistrationAlert, sendWelcomeNotification } = require("../../utils/notification/sendNotification");
const { sendEmail: sendSMTPEmail, sendEmailWithEnv } = require("../../config/connectSMTP");
const { getWelcomeEmailTemplate } = require("../../utils/email/templates/welcomeEmailTemplate");

// Initialize Firebase Admin
getFirebaseAdmin();

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
 * Register user with phone verification (Firebase)
 * POST /api/auth/mobile/phone-register
 */
const phoneRegister = async (req, res) => {
  try {
    console.log("📱 Phone registration request received");
    const { name, email, phoneNumber, password, firebaseToken } = req.body;

    // Validation
    if (!name || !email || !phoneNumber || !password || !firebaseToken) {
      return res.status(400).json({
        success: false,
        error: "All fields are required including Firebase token",
      });
    }

    // Verify Firebase token
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(firebaseToken);
      console.log("✅ Firebase token verified:", decodedToken.phone_number);
    } catch (error) {
      console.error("❌ Firebase token verification failed:", error);
      return res.status(401).json({
        success: false,
        error: "Invalid Firebase token. Please verify your phone number again.",
      });
    }

    // Check if phone number matches
    if (decodedToken.phone_number !== phoneNumber) {
      return res.status(401).json({
        success: false,
        error: "Phone number mismatch. Please try again.",
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
    const phoneRegex = /^\+91[6-9]\d{9}$/;
    if (!phoneRegex.test(phoneNumber)) {
      return res.status(400).json({
        success: false,
        error: "Invalid phone number format. Use +91XXXXXXXXXX",
      });
    }

    console.log("✅ Validation passed");

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email },
          { phoneNumber },
          { firebaseUid: decodedToken.uid }
        ]
      }
    });

    const existingAdmin = await prisma.admin.findFirst({
      where: {
        OR: [
          { email },
          { phoneNumber },
          { firebaseUid: decodedToken.uid }
        ]
      }
    });

    if (existingUser || existingAdmin) {
      return res.status(400).json({
        success: false,
        error: "Account already exists with this email or phone number. Please sign in.",
      });
    }

    console.log("✅ User does not exist, proceeding...");

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user with phone verified
    const userData = {
      email,
      password: hashedPassword,
      name,
      phoneNumber,
      isVerified: true, // Phone verified by Firebase
      isActive: true,
      provider: 'phone',
      firebaseUid: decodedToken.uid,
    };

    const user = await prisma.user.create({ data: userData });
    console.log("✅ User created:", user.id);

    // Create customer record
    let customerId = null;
    try {
      const existingCustomer = await prisma.customer.findFirst({
        where: {
          OR: [
            { email: user.email },
            { phoneNumber: user.phoneNumber }
          ]
        }
      });

      if (existingCustomer) {
        const updatedCustomer = await prisma.customer.update({
          where: { id: existingCustomer.id },
          data: {
            userId: user.id,
            isVerified: true,
          }
        });
        customerId = updatedCustomer.id;
      } else {
        const customer = await prisma.customer.create({
          data: {
            userId: user.id,
            email: user.email,
            name: user.name,
            phoneNumber: user.phoneNumber,
            isVerified: true,
            provider: 'phone',
          },
        });
        customerId = customer.id;
      }
      console.log("✅ Customer record created/updated:", customerId);
    } catch (customerError) {
      console.error("❌ Failed to handle customer record:", customerError);
    }

    await awardSignupBonus(user.id);

    // Generate JWT token
    const token = generateToken(user.id);

    // Track active session
    await sessionManager.addSession(user.id, token);

    // Send response
    res.status(201).json({
      success: true,
      message: "Registration successful",
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          phoneNumber: user.phoneNumber,
          role: "user",
          isVerified: true,
        },
      },
    });

    // Send notifications (non-blocking)
    setImmediate(async () => {
      try {
        await sendNewUserRegistrationAlert(user.name, user.email, customerId);
        await sendWelcomeNotification(user.id, user.name);
        console.log("✅ Notifications sent");

        // Send welcome email (non-blocking)
        const emailData = await getWelcomeEmailTemplate({
          email: user.email,
          name: user.name
        });
        
        await sendEmail({
          to: user.email,
          subject: emailData.subject,
          html: emailData.html
        });
        console.log("✅ Welcome email sent");
      } catch (notifError) {
        console.error("⚠️ Failed to send notifications or email:", notifError.message);
      }
    });
  } catch (error) {
    console.error("Phone registration error:", error);
    res.status(500).json({
      success: false,
      error: "Registration failed. Please try again.",
    });
  }
};

/**
 * Login with phone verification (Firebase)
 * POST /api/auth/mobile/phone-login
 */
const phoneLogin = async (req, res) => {
  try {
    console.log("📱 Phone login request received");
    const { phoneNumber, firebaseToken, fcmToken } = req.body;

    // Validation
    if (!phoneNumber || !firebaseToken) {
      return res.status(400).json({
        success: false,
        error: "Phone number and Firebase token are required",
      });
    }

    // Verify Firebase token
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(firebaseToken);
      console.log("✅ Firebase token verified:", decodedToken.phone_number);
    } catch (error) {
      console.error("❌ Firebase token verification failed:", error);
      return res.status(401).json({
        success: false,
        error: "Invalid Firebase token. Please verify your phone number again.",
      });
    }

    // Check if phone number matches
    if (decodedToken.phone_number !== phoneNumber) {
      return res.status(401).json({
        success: false,
        error: "Phone number mismatch. Please try again.",
      });
    }

    // Find user
    let user = await prisma.user.findFirst({
      where: { phoneNumber }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "Account not found. Please register first.",
        needsRegistration: true,
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        error: "Account is deactivated. Please contact administrator.",
      });
    }

    // Update last login and FCM token
    const updateData = { 
      lastLogin: new Date(),
      firebaseUid: decodedToken.uid, // Update Firebase UID
    };

    if (fcmToken) {
      const existingTokens = Array.isArray(user.fcmTokens) ? user.fcmTokens : [];
      const device = req.headers['user-agent'] || 'Mobile App';
      const now = new Date();

      const filteredTokens = existingTokens.filter(t => t.token !== fcmToken);
      filteredTokens.unshift({
        token: fcmToken,
        device: device,
        lastUsed: now.toISOString(),
      });

      updateData.fcmTokens = filteredTokens.slice(0, 10);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: updateData,
    });

    // Generate JWT token
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
          role: "user",
          image: user.image,
          isVerified: user.isVerified,
          phoneNumber: user.phoneNumber,
          address: user.address,
          city: user.city,
          state: user.state,
          zipCode: user.zipCode,
          country: user.country,
          dateOfBirth: user.dateOfBirth,
        },
      },
    });
  } catch (error) {
    console.error("Phone login error:", error);
    res.status(500).json({
      success: false,
      error: "Login failed. Please try again.",
    });
  }
};

module.exports = {
  phoneRegister,
  phoneLogin,
};
