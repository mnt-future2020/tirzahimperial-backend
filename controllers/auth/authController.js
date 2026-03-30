const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { prisma } = require("../../config/database");
const sessionManager = require("../../utils/auth/sessionManager");
const { sendEmail: sendSMTPEmail, sendEmailWithEnv } = require("../../config/connectSMTP");
const { sendNewUserRegistrationAlert, sendWelcomeNotification } = require("../../utils/notification/sendNotification");
const { getWelcomeEmailTemplate } = require("../../utils/email/templates/welcomeEmailTemplate");

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

// Generate random token
const generateRandomToken = () => {
  return crypto.randomBytes(32).toString("hex");
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

// Register new user
const register = async (req, res) => {
  try {
    console.log("📝 Registration request received:", {
      email: req.body.email,
      name: req.body.name,
      phoneNumber: req.body.phoneNumber,
      hasPassword: !!req.body.password,
      bodyKeys: Object.keys(req.body)
    });
    const { email, password, name, phoneNumber } = req.body;

    // Validation
    if (!email || !password || !name || !phoneNumber) {
      console.log("❌ Registration validation failed:", {
        email: !!email,
        password: !!password,
        name: !!name,
        phoneNumber: !!phoneNumber
      });
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

    // Phone number format validation (more flexible for international formats)
    // Remove all non-digit characters except + for validation
    const phoneDigitsOnly = phoneNumber.replace(/[^\d+]/g, '');
    const phoneRegex = /^\+?\d{7,20}$/; // Allow + followed by 7-20 digits
    if (!phoneRegex.test(phoneDigitsOnly)) {
      console.log("❌ Phone validation failed:", {
        original: phoneNumber,
        digitsOnly: phoneDigitsOnly,
        length: phoneDigitsOnly.length
      });
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

    // Build search criteria for existing users
    const searchCriteria = [
      { email },
    ];
    
    // Add phone number to search if provided
    if (phoneNumber) {
      searchCriteria.push({ phoneNumber });
    }
    
    // Add firebaseUid to search if provided (from mobile registration flow)
    if (req.body.firebaseUid) {
      searchCriteria.push({ firebaseUid: req.body.firebaseUid });
    }

    // Check if user/admin already exists in respective collection
    console.log("🔍 Checking for existing user...");
    const existingUser = isAdmin
      ? await prisma.admin.findFirst({ 
          where: { OR: searchCriteria }
        })
      : await prisma.user.findFirst({ 
          where: { OR: searchCriteria }
        });

    // Also check the other collection to prevent duplicate emails
    const existingInOtherCollection = isAdmin
      ? await prisma.user.findFirst({ 
          where: { OR: searchCriteria }
        })
      : await prisma.admin.findFirst({ 
          where: { OR: searchCriteria }
        });

    console.log("🔍 Search results:", {
      searchCriteria,
      existingUser: existingUser ? {
        id: existingUser.id,
        email: existingUser.email,
        provider: existingUser.provider,
        googleId: existingUser.googleId,
        phoneNumber: existingUser.phoneNumber
      } : null,
      existingInOtherCollection: existingInOtherCollection ? {
        id: existingInOtherCollection.id,
        email: existingInOtherCollection.email,
        provider: existingInOtherCollection.provider,
        googleId: existingInOtherCollection.googleId,
        phoneNumber: existingInOtherCollection.phoneNumber
      } : null
    });

    if (existingUser || existingInOtherCollection) {
      console.log("❌ User already exists");
      
      // Check if it's a Google user trying to register with email/password
      const googleUser = existingUser || existingInOtherCollection;
      if (googleUser && googleUser.provider === 'google' && googleUser.googleId && !googleUser.googleId.startsWith('local_')) {
        return res.status(400).json({
          success: false,
          error: "An account with this email already exists via Google. Please sign in with Google instead.",
        });
      }
      
      // Check if this is a local user without a customer record (sync issue)
      if (googleUser && googleUser.provider === 'local' && !isAdmin) {
        console.log("🔍 Checking if customer record exists for local user...");
        
        try {
          const existingCustomer = await prisma.customer.findUnique({
            where: { userId: googleUser.id }
          });
          
          if (!existingCustomer) {
            console.log("📝 Creating missing customer record for existing user...");
            
            const customer = await prisma.customer.create({
              data: {
                userId: googleUser.id,
                email: googleUser.email,
                name: googleUser.name,
                phoneNumber: googleUser.phoneNumber,
                image: googleUser.image,
                isVerified: googleUser.isVerified,
                provider: googleUser.provider || 'local',
                totalOrders: 0,
                totalSpent: 0,
                syncedAt: new Date(),
              },
            });
            
            console.log("✅ Customer record created for existing user:", customer.id);
          } else {
            console.log("✅ Customer record already exists:", existingCustomer.id);
          }
        } catch (customerError) {
          console.error("❌ Failed to create customer record:", customerError);
        }
      }
      
      return res.status(400).json({
        success: false,
        error: "Account already exists. Please sign in with your email or phone number and password.",
      });
    }

    console.log("✅ User does not exist, proceeding...");

    // Hash password (reduced salt rounds for faster processing)
    console.log("🔐 Hashing password...");
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    console.log("✅ Password hashed");

    // Generate verification token
    const verificationToken = generateRandomToken();

    // Prepare user data
    const userData = {
      email,
      password: hashedPassword,
      name,
      phoneNumber,
      verificationToken,
    };

    // Create user in appropriate collection with transaction
    console.log("💾 Creating user in database...");
    let user;
    let customerId = null;
    
    try {
      // Use transaction to ensure both user and customer are created together
      const result = await prisma.$transaction(async (tx) => {
        // Create user first
        const newUser = isAdmin
          ? await tx.admin.create({
              data: userData,
            })
          : await tx.user.create({
              data: userData,
            });
        
        console.log("✅ User created:", newUser.id);
        
        // Create Customer record for non-admin users
        let customerRecord = null;
        if (!isAdmin) {
          console.log("📝 Creating customer record for user:", newUser.id);
          
          customerRecord = await tx.customer.create({
            data: {
              userId: newUser.id,
              email: newUser.email,
              name: newUser.name,
              phoneNumber: newUser.phoneNumber,
              isVerified: false,
              provider: 'local',
              totalOrders: 0,
              totalSpent: 0,
              syncedAt: new Date(),
            },
          });
          console.log("✅ Customer record created:", customerRecord.id);
        }
        
        return { user: newUser, customer: customerRecord };
      });
      
      user = result.user;
      customerId = result.customer?.id || null;

      if (!isAdmin) {
        await awardSignupBonus(user.id);
      }
      
    } catch (createError) {
      console.log("❌ Transaction failed, no data saved:", createError.message);
      
      // Handle unique constraint violations
      if (createError.code === 'P2002') {
        const field = createError.meta?.target || 'field';
        console.log(`❌ Unique constraint violation on: ${field}`);
        
        // Check if this is a googleId constraint issue
        if (field.includes('googleId')) {
          console.log("🔧 Attempting googleId constraint workaround...");
          
          try {
            // Use transaction for workaround too - all or nothing
            const workaroundResult = await prisma.$transaction(async (tx) => {
              const uniquePlaceholder = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
              
              const userDataWithPlaceholder = {
                ...userData,
                googleId: uniquePlaceholder
              };
              
              const newUser = isAdmin
                ? await tx.admin.create({
                    data: userDataWithPlaceholder,
                  })
                : await tx.user.create({
                    data: userDataWithPlaceholder,
                  });
                  
              console.log("✅ User created with placeholder googleId:", newUser.id);
              
              // Create Customer record for non-admin users
              let customerRecord = null;
              if (!isAdmin) {
                customerRecord = await tx.customer.create({
                  data: {
                    userId: newUser.id,
                    email: newUser.email,
                    name: newUser.name,
                    phoneNumber: newUser.phoneNumber,
                    isVerified: false,
                    provider: 'local',
                    totalOrders: 0,
                    totalSpent: 0,
                    syncedAt: new Date(),
                  },
                });
                console.log("✅ Customer record created with workaround:", customerRecord.id);
              }
              
              return { user: newUser, customer: customerRecord };
            });
            
            user = workaroundResult.user;
            customerId = workaroundResult.customer?.id || null;
            
          } catch (workaroundError) {
            console.log("❌ Workaround transaction failed:", workaroundError.message);
            return res.status(400).json({
              success: false,
              error: "Registration failed due to database constraints. Please try again or contact support.",
            });
          }
        } else {
          // Handle other constraint violations
          if (field.includes('email')) {
            return res.status(400).json({
              success: false,
              error: "An account with this email already exists. Please sign in instead.",
            });
          } else if (field.includes('phoneNumber')) {
            return res.status(400).json({
              success: false,
              error: "An account with this phone number already exists. Please sign in instead.",
            });
          } else {
            return res.status(400).json({
              success: false,
              error: "An account with these credentials already exists. Please sign in instead.",
            });
          }
        }
      } else {
        // Other database errors
        console.error("❌ Database error during registration:", createError);
        return res.status(500).json({
          success: false,
          error: "Registration failed due to a database error. Please try again.",
        });
      }
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

    // Send verification email via Kafka (non-blocking)
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
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
            
            .button-container {
              text-align: center;
              margin: 40px 0;
            }
            
            .verify-button {
              display: inline-block;
              background: linear-gradient(135deg, #c49a3c 0%, #d4af47 100%);
              color: white;
              padding: 16px 32px;
              text-decoration: none;
              font-size: 16px;
              font-weight: 400;
              letter-spacing: 2px;
              text-transform: uppercase;
              border: none;
              transition: all 0.3s ease;
            }
            
            .verify-button:hover {
              background: linear-gradient(135deg, #b8903a 0%, #c49a3c 100%);
              transform: translateY(-2px);
            }
            
            .link-section {
              background: white;
              padding: 20px;
              border: 1px solid #e8ddd0;
              margin: 30px 0;
            }
            
            .link-label {
              font-size: 14px;
              font-weight: 300;
              color: #6b5040;
              margin-bottom: 10px;
              letter-spacing: 1px;
            }
            
            .verify-link {
              word-break: break-all;
              color: #c49a3c;
              font-size: 13px;
              font-weight: 300;
              text-decoration: none;
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
              <h1>Welcome to ${companyName}</h1>
              <p>Email Verification Required</p>
            </div>
            
            <div class="content">
              <div class="greeting">Hello ${name},</div>
              
              <div class="message">
                Welcome to ${companyName}! We're thrilled to have you join our community. 
                To complete your registration and unlock access to your account, please verify your email address.
              </div>
              
              <div class="button-container">
                <a href="${verificationUrl}" class="verify-button">Verify Email Address</a>
              </div>
              
              <div class="divider"></div>
              
              <div class="link-section">
                <div class="link-label">Or copy and paste this link in your browser:</div>
                <a href="${verificationUrl}" class="verify-link">${verificationUrl}</a>
              </div>
              
              <div class="warning">
                <div class="warning-text">
                  <strong>Security Notice:</strong> This verification link will expire in 24 hours. 
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
      message:
        "User registered successfully. Please check your email to verify your account.",
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: isAdmin ? "admin" : "user",
      },
    });

    // Send email after response (non-blocking)
    setImmediate(async () => {
      try {
        await sendEmail(emailData);
        console.log(`✅ Verification email sent to: ${email}`);
      } catch (err) {
        console.error("Failed to send email:", err);
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

      // Send welcome notification to the new user (non-blocking)
      setImmediate(async () => {
        try {
          await sendWelcomeNotification(user.id, user.name);
          console.log(`🎉 Welcome notification sent to user: ${user.name}`);
        } catch (notifError) {
          console.error('⚠️ Failed to send welcome notification:', notifError.message);
        }
      });
    }
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({
      success: false,
      error: "Registration failed",
    });
  }
};

// Login user
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

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

    console.log(`🔍 Login attempt with ${searchField}:`, email);

    // Find user in both collections by email or phone
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

    // Check if email is verified (except for admins)
    if (userType !== "admin" && !user.isVerified) {
      return res.status(401).json({
        success: false,
        error: "Please verify your email before signing in. Check your inbox for the verification link.",
      });
    }

    // For Google OAuth users without password
    if (!user.password && user.provider === "google") {
      return res.status(401).json({
        success: false,
        error: "Please sign in with Google",
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

    // Update last login
    const updateData = { lastLogin: new Date() };

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

    // Set httpOnly cookie
    res.cookie('token', token, {
      httpOnly: true,           // JavaScript-ல் access செய்ய முடியாது
      secure: process.env.NODE_ENV === 'production', // HTTPS-ல் மட்டும் (production)
      sameSite: 'lax',          // CSRF protection
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/'
    });

    // Login event removed - not needed for customer sync

    res.json({
      success: true,
      message: "Login successful",
      data: {
        token, // Still send in response for backward compatibility
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
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      error: "Login failed",
    });
  }
};

// Google OAuth callback
const googleCallback = async (req, res) => {
  try {
    const { googleId, email, name, image, fcmToken } = req.body;

    if (!googleId || !email || !name) {
      return res.status(400).json({
        success: false,
        error: "Missing required Google OAuth data",
      });
    }

    // Determine if this should be an admin or user
    const adminEmails = [process.env.ADMIN_EMAIL];
    const isAdmin = adminEmails.includes(email.toLowerCase());

    // Check if user exists in appropriate collection
    let user = isAdmin
      ? await prisma.admin.findFirst({
          where: {
            OR: [
              { email }, 
              { googleId: googleId } // Only match actual Google IDs, not local placeholders
            ],
          },
        })
      : await prisma.user.findFirst({
          where: {
            OR: [
              { email }, 
              { googleId: googleId } // Only match actual Google IDs, not local placeholders
            ],
          },
        });

    if (user) {
      // Existing user found
      console.log(`👤 Existing user found: ${email} (Provider: ${user.provider}, Verified: ${user.isVerified})`);

      // SECURITY CHECK: If user registered with email/password but NOT verified
      // Don't allow Google login to bypass email verification
      if (user.provider === "local" && !user.isVerified) {
        console.log("⚠️ User registered but email not verified - blocking Google login");
        return res.status(403).json({
          success: false,
          error: "Please verify your email first. Check your inbox for the verification link before signing in with Google.",
        });
      }

      // User is either:
      // 1. Already verified (local provider)
      // 2. Was a Google user before
      // 3. Admin (admins can bypass)
      // Update user with Google credentials (preserve existing name and custom image)
      const updateData = {
        googleId,
        provider: "google",
        isVerified: true, // Safe to set true (already verified or Google user)
        lastLogin: new Date(),
      };
      
      // Handle FCM token if provided (for mobile app)
      if (fcmToken) {
        const device = req.headers['user-agent'] || 'Mobile App';
        const now = new Date();
        
        // Get existing tokens array
        let tokens = Array.isArray(user.fcmTokens) ? user.fcmTokens : [];
        
        // Remove the exact same token if it exists
        tokens = tokens.filter(t => t.token !== fcmToken);
        
        // Add new token to the beginning
        tokens.unshift({
          token: fcmToken,
          device: device,
          lastUsed: now.toISOString(),
        });
        
        // Keep only last 10 devices
        if (tokens.length > 10) {
          tokens = tokens.slice(0, 10);
        }
        
        updateData.fcmTokens = tokens;
        console.log(`📱 FCM token saved for user: ${email} - Total devices: ${tokens.length}`);
      }
      
      // Only update name if user was previously a Google user (not local registration)
      // This preserves the name user chose during registration
      if (user.provider === "google") {
        updateData.name = name;
      }
      
      // Only update image if:
      // 1. User has no image (null) OR
      // 2. User's current image is from Google (contains 'googleusercontent.com' or 'google.com') OR
      // 3. User was previously a Google user
      // This preserves custom uploaded images
      const isGoogleImage = user.image && (
        user.image.includes('googleusercontent.com') || 
        user.image.includes('google.com') ||
        user.image.includes('lh3.googleusercontent.com')
      );
      
      if (!user.image || isGoogleImage || user.provider === "google") {
        updateData.image = image;
      }
      
      user = isAdmin
        ? await prisma.admin.update({
            where: { id: user.id },
            data: updateData,
          })
        : await prisma.user.update({
            where: { id: user.id },
            data: updateData,
          });
      console.log("✅ Existing user updated with Google credentials (name preserved)");
    } else {
      // Create new user in appropriate collection (auto-register)
      console.log("🆕 Auto-registering new Google user:", email);
      
      const createData = {
        email,
        googleId,
        name,
        image,
        provider: "google",
        isVerified: true, // Google users are auto-verified
        lastLogin: new Date(),
      };
      
      // Handle FCM token if provided (for mobile app)
      if (fcmToken) {
        const device = req.headers['user-agent'] || 'Mobile App';
        const now = new Date();
        
        createData.fcmTokens = [{
          token: fcmToken,
          device: device,
          lastUsed: now.toISOString(),
        }];
        console.log(`📱 FCM token saved for new Google user: ${email}`);
      }
      
      user = isAdmin
        ? await prisma.admin.create({ data: createData })
        : await prisma.user.create({ data: createData });
      console.log("✅ Google user auto-registered:", user.id);

      // Create or Link Customer record for non-admin users
      let customerId = null;
      if (!isAdmin) {
        try {
          console.log("📝 Checking for existing customer record for Google user:", user.id);
          
          const existingCustomer = await prisma.customer.findUnique({
             where: { email: user.email }
          });

          if (existingCustomer) {
             console.log("🔗 Customer already exists, linking Google user to existing customer:", existingCustomer.id);
             const updatedCustomer = await prisma.customer.update({
                where: { id: existingCustomer.id },
                data: {
                   userId: user.id,
                   image: user.image || existingCustomer.image, // Update image if available
                   isVerified: true, // Google users are verified
                   provider: existingCustomer.provider === 'local' ? 'google' : existingCustomer.provider // Update provider if upgrading
                }
             });
             customerId = updatedCustomer.id;
             console.log("✅ Google user linked to existing customer:", customerId);
          } else {
             console.log("📝 Creating customer record for Google user:", user.id);
             const customer = await prisma.customer.create({
              data: {
                userId: user.id,
                email: user.email,
                name: user.name,
                image: user.image,
                isVerified: true,
                provider: 'google',
              },
            });
            customerId = customer.id;
            console.log("✅ Customer record created for Google user:", customer.id);
          }
        } catch (customerError) {
          console.error("❌ Failed to handle customer record for Google user:");
          console.error("Error details:", customerError);
          console.error("User data:", { userId: user.id, email: user.email, name: user.name });
          // Don't fail authentication if customer creation fails
        }

        await awardSignupBonus(user.id);

        // Send new user registration notification to admins (non-blocking)
        setImmediate(async () => {
          try {
            await sendNewUserRegistrationAlert(user.name, user.email, customerId);
            console.log(`📱 New Google user registration notification sent to admins`);
          } catch (notifError) {
            console.error('⚠️ Failed to send registration notification:', notifError.message);
          }
        });

        // Send welcome notification to the new Google user (non-blocking)
        setImmediate(async () => {
          try {
            await sendWelcomeNotification(user.id, user.name);
            console.log(`🎉 Welcome notification sent to Google user: ${user.name}`);

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
            console.log(`📧 Welcome email sent to Google user: ${user.email}`);
          } catch (notifError) {
            console.error('⚠️ Failed to send welcome notification:', notifError.message);
          }
        });
      }
    }

    // Generate token
    const token = generateToken(user.id);

    // Track active session
    await sessionManager.addSession(user.id, token);

    // Set httpOnly cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });

    res.json({
      success: true,
      message: "Google authentication successful",
      data: {
        token, // Still send for backward compatibility
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: isAdmin ? "admin" : "user",
          image: user.image,
          isVerified: user.isVerified,
          phoneNumber: user.phoneNumber,
          address: user.address,
          city: user.city,
          state: user.state,
          zipCode: user.zipCode,
          country: user.country,
          dateOfBirth: user.dateOfBirth,
          currency: isAdmin ? user.currency : undefined,
          companyName: isAdmin ? user.companyName : undefined,
          gstNumber: isAdmin ? user.gstNumber : undefined,
          onboardingCompleted: isAdmin ? user.onboardingCompleted : undefined,
        },
      },
    });
  } catch (error) {
    console.error("Google OAuth error:", error);
    res.status(500).json({
      success: false,
      error: "Google authentication failed",
    });
  }
};

// Verify email
const verifyEmail = async (req, res) => {
  try {
    const { token } = req.body;

    console.log("📧 Email verification request received");

    if (!token) {
      console.log("❌ No token provided");
      return res.status(400).json({
        success: false,
        error: "Verification token is required",
      });
    }

    console.log("🔍 Searching for user with verification token...");

    // Find user with verification token in both collections
    let user = await prisma.user.findFirst({
      where: { verificationToken: token },
    });
    let userType = "user";

    if (!user) {
      user = await prisma.admin.findFirst({
        where: { verificationToken: token },
      });
      userType = "admin";
    }

    if (!user) {
      console.log("❌ No user found with this token");
      
      // Token not found - could mean already verified or invalid token
      // Return a generic message that's user-friendly
      console.log("ℹ️ Token not found - likely already verified or expired");
      return res.status(200).json({
        success: true,
        message: "Email already verified. You can sign in now.",
        alreadyVerified: true
      });
    }

    console.log(`✅ User found: ${user.email} (${userType})`);

    // Check if already verified
    if (user.isVerified) {
      console.log("ℹ️ User already verified");
      return res.json({
        success: true,
        message: "Email already verified. You can sign in now.",
        alreadyVerified: true
      });
    }

    // Update user as verified in appropriate collection
    let verifiedUser;
    if (userType === "admin") {
      verifiedUser = await prisma.admin.update({
        where: { id: user.id },
        data: {
          isVerified: true,
          verificationToken: null,
        },
      });
    } else {
      verifiedUser = await prisma.user.update({
        where: { id: user.id },
        data: {
          isVerified: true,
          verificationToken: null,
        },
      });
    }

    console.log(`✅ Email verified successfully for: ${verifiedUser.email}`);

    // Send welcome email (non-blocking)
    setImmediate(async () => {
      try {
        const emailData = await getWelcomeEmailTemplate({
          email: verifiedUser.email,
          name: verifiedUser.name
        });
        
        await sendEmail({
          to: verifiedUser.email,
          subject: emailData.subject,
          html: emailData.html
        });
        console.log("✅ Welcome email sent");
      } catch (emailError) {
        console.error("⚠️ Failed to send welcome email:", emailError.message);
      }
    });

    res.json({
      success: true,
      message: "Email verified successfully",
    });
  } catch (error) {
    console.error("Email verification error:", error);
    res.status(500).json({
      success: false,
      error: "Email verification failed. Please try again.",
    });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      });
    }

    // Find user in both collections
    let user = await prisma.user.findUnique({
      where: { email },
    });
    let userType = "user";

    if (!user) {
      user = await prisma.admin.findUnique({
        where: { email },
      });
      userType = "admin";
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found with this email",
      });
    }

    // Generate reset token
    const resetToken = generateRandomToken();
    const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour

    // Update user with reset token in appropriate collection
    if (userType === "admin") {
      await prisma.admin.update({
        where: { id: user.id },
        data: {
          resetToken,
          resetTokenExpiry,
        },
      });
    } else {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetToken,
          resetTokenExpiry,
        },
      });
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

    // Send reset email
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    const emailData = {
      to: email,
      subject: `Reset Your Password - ${companyName}`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Password Reset Request</title>
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
            
            .button-container {
              text-align: center;
              margin: 40px 0;
            }
            
            .reset-button {
              display: inline-block;
              background: linear-gradient(135deg, #c49a3c 0%, #d4af47 100%);
              color: white;
              padding: 16px 32px;
              text-decoration: none;
              font-size: 16px;
              font-weight: 400;
              letter-spacing: 2px;
              text-transform: uppercase;
              border: none;
              transition: all 0.3s ease;
            }
            
            .reset-button:hover {
              background: linear-gradient(135deg, #b8903a 0%, #c49a3c 100%);
              transform: translateY(-2px);
            }
            
            .link-section {
              background: white;
              padding: 20px;
              border: 1px solid #e8ddd0;
              margin: 30px 0;
            }
            
            .link-label {
              font-size: 14px;
              font-weight: 300;
              color: #6b5040;
              margin-bottom: 10px;
              letter-spacing: 1px;
            }
            
            .reset-link {
              word-break: break-all;
              color: #c49a3c;
              font-size: 13px;
              font-weight: 300;
              text-decoration: none;
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
              <h1>Password Reset</h1>
              <p>Secure Account Recovery</p>
            </div>
            
            <div class="content">
              <div class="greeting">Hello ${user.name},</div>
              
              <div class="message">
                We received a request to reset your password for your ${companyName} account. 
                To proceed with resetting your password, please click the button below.
              </div>
              
              <div class="button-container">
                <a href="${resetUrl}" class="reset-button">Reset Password</a>
              </div>
              
              <div class="divider"></div>
              
              <div class="link-section">
                <div class="link-label">Or copy and paste this link in your browser:</div>
                <a href="${resetUrl}" class="reset-link">${resetUrl}</a>
              </div>
              
              <div class="warning">
                <div class="warning-text">
                  <strong>Security Notice:</strong> This link will expire in 1 hour for your security. 
                  If you didn't request this password reset, please ignore this email and your password will remain unchanged.
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

    // Send password reset email
    await sendEmail(emailData).catch((err) => {
      console.error("Failed to send password reset email:", err);
    });

    res.json({
      success: true,
      message: "Password reset email sent successfully",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to send password reset email",
    });
  }
};

// Reset password
const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        error: "Token and password are required",
      });
    }

    // Find user with valid reset token in both collections
    let user = await prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExpiry: {
          gt: new Date(),
        },
      },
    });
    let userType = "user";

    if (!user) {
      user = await prisma.admin.findFirst({
        where: {
          resetToken: token,
          resetTokenExpiry: {
            gt: new Date(),
          },
        },
      });
      userType = "admin";
    }

    if (!user) {
      return res.status(400).json({
        success: false,
        error: "Invalid or expired reset token",
      });
    }

    // Hash new password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Update user password in appropriate collection
    if (userType === "admin") {
      await prisma.admin.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          resetToken: null,
          resetTokenExpiry: null,
        },
      });
    } else {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          resetToken: null,
          resetTokenExpiry: null,
        },
      });
    }

    res.json({
      success: true,
      message: "Password reset successfully",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({
      success: false,
      error: "Password reset failed",
    });
  }
};

// Get current user
const getCurrentUser = async (req, res) => {
  try {
    // Try to find user in users collection first
    let user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        isVerified: true,
        isActive: true,
        lastLogin: true,
        createdAt: true,
        phoneNumber: true,
        address: true,
        city: true,
        state: true,
        zipCode: true,
        country: true,
        dateOfBirth: true,
      },
    });
    let userType = "user";

    // If not found in users, try admins collection
    if (!user) {
      user = await prisma.admin.findUnique({
        where: { id: req.userId },
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          isVerified: true,
          isActive: true,
          lastLogin: true,
          createdAt: true,
          phoneNumber: true,
          address: true,
          city: true,
          state: true,
          zipCode: true,
          country: true,
          dateOfBirth: true,
          currency: true,
          companyName: true,
          gstNumber: true,
          onboardingCompleted: true,
          // TEMPORARILY HIDDEN - timezone and dateFormat
          // timezone: true,
          // dateFormat: true,
          workingHours: {
            orderBy: {
              day: "asc",
            },
          },
        },
      });
      userType = "admin";
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    res.json({
      success: true,
      data: {
        ...user,
        role: userType,
      },
    });
  } catch (error) {
    console.error("Get current user error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get user data",
    });
  }
};

// Logout user
const logout = async (req, res) => {
  try {
    const userId = req.userId;
    const token = req.headers.authorization?.replace("Bearer ", "");
    const { fcmToken } = req.body; // Get FCM token from request body

    // Get user info before logout
    let user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, fcmTokens: true },
    });
    let userType = "user";

    if (!user) {
      user = await prisma.admin.findUnique({
        where: { id: userId },
        select: { email: true, name: true, fcmTokens: true },
      });
      userType = "admin";
    }

    // ✅ FIX: Remove FCM token from database on logout
    if (fcmToken && user) {
      try {
        const tokens = Array.isArray(user.fcmTokens) ? user.fcmTokens : [];
        const updatedTokens = tokens.filter(t => t.token !== fcmToken);

        if (userType === 'user') {
          await prisma.user.update({
            where: { id: userId },
            data: { fcmTokens: updatedTokens },
          });
        } else {
          await prisma.admin.update({
            where: { id: userId },
            data: { fcmTokens: updatedTokens },
          });
        }

        console.log(`✅ FCM token removed on logout for ${userType}: ${user.name} - Remaining devices: ${updatedTokens.length}`);
      } catch (fcmError) {
        console.error('⚠️ Failed to remove FCM token on logout:', fcmError.message);
        // Continue with logout even if FCM removal fails
      }
    }

    // Remove session from tracking
    if (token) {
      await sessionManager.removeSession(userId, token);
    }

    // Clear httpOnly cookie
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/'
    });

    // Destroy Express session if it exists
    if (req.session) {
      req.session.destroy((err) => {
        if (err) {
          console.error("Session destruction error:", err);
        }
      });
    }

    res.json({
      success: true,
      message: "Logged out successfully",
    });

  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      success: false,
      error: "Logout failed",
    });
  }
};

// Update user profile
const updateProfile = async (req, res) => {
  try {
    const {
      name,
      image,
      phoneNumber,
      address,
      city,
      state,
      zipCode,
      country,
      dateOfBirth,
      currency,
      companyName,
      gstNumber,
      workingHours,
    } = req.body;
    const userId = req.userId;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: "Name is required",
      });
    }

    // Prepare update data
    const updateData = {
      name,
      ...(image !== undefined && { image }),
      ...(phoneNumber !== undefined && { phoneNumber }),
      ...(address !== undefined && { address }),
      ...(city !== undefined && { city }),
      ...(state !== undefined && { state }),
      ...(zipCode !== undefined && { zipCode }),
      ...(country !== undefined && { country }),
      ...(dateOfBirth && { dateOfBirth: new Date(dateOfBirth) }),
      ...(currency !== undefined && { currency }),
      ...(companyName !== undefined && { companyName }),
      ...(gstNumber !== undefined && { gstNumber }),
    };

    // Try to update in users collection first
    let updatedUser;
    let userType = "user";

    try {
      updatedUser = await prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          isVerified: true,
          isActive: true,
          provider: true,
          phoneNumber: true,
          address: true,
          city: true,
          state: true,
          zipCode: true,
          country: true,
          dateOfBirth: true,
          createdAt: true,
        },
      });

      // Sync profile information to Customer collection for regular users
      try {
        console.log("🔄 Syncing user profile to customer collection...");
        
        // Check if customer record exists
        const existingCustomer = await prisma.customer.findUnique({
          where: { userId },
        });

        if (existingCustomer) {
          // Update existing customer record
          await prisma.customer.update({
            where: { userId },
            data: {
              name: updatedUser.name,
              image: updatedUser.image,
              phoneNumber: updatedUser.phoneNumber,
              address: updatedUser.address,
              city: updatedUser.city,
              state: updatedUser.state,
              zipCode: updatedUser.zipCode,
              country: updatedUser.country,
              dateOfBirth: updatedUser.dateOfBirth,
              syncedAt: new Date(),
            },
          });
          console.log("✅ Customer profile updated successfully");
        } else {
          // Create new customer record if it doesn't exist
          await prisma.customer.create({
            data: {
              userId: updatedUser.id,
              email: updatedUser.email,
              name: updatedUser.name,
              image: updatedUser.image,
              phoneNumber: updatedUser.phoneNumber,
              address: updatedUser.address,
              city: updatedUser.city,
              state: updatedUser.state,
              zipCode: updatedUser.zipCode,
              country: updatedUser.country,
              dateOfBirth: updatedUser.dateOfBirth,
              isVerified: updatedUser.isVerified,
              provider: updatedUser.provider || 'local',
              totalOrders: 0,
              totalSpent: 0,
              syncedAt: new Date(),
            },
          });
          console.log("✅ Customer record created successfully");
        }
      } catch (customerSyncError) {
        console.error("⚠️ Failed to sync customer profile:", customerSyncError);
        // Don't fail the main update if customer sync fails
      }

    } catch (error) {
      // If not found in users, try admins collection
      // Handle working hours for admin users
      if (workingHours && Array.isArray(workingHours)) {
        // First, delete existing working hours
        await prisma.workingHour.deleteMany({
          where: { adminId: userId },
        });

        // Create new working hours
        const workingHoursData = workingHours.map((wh) => ({
          adminId: userId,
          day: wh.day,
          enabled: wh.enabled,
          startTime: wh.startTime,
          endTime: wh.endTime,
        }));

        await prisma.workingHour.createMany({
          data: workingHoursData,
        });
      }

      // Check if trying to update immutable fields after onboarding
      const admin = await prisma.admin.findUnique({
        where: { id: userId },
        select: { onboardingCompleted: true },
      });

      if (admin?.onboardingCompleted) {
        // Prevent updates to immutable fields
        if (currency !== undefined || country !== undefined) {
          return res.status(400).json({
            success: false,
            error: "Currency and country cannot be changed after onboarding completion",
          });
        }
      }

      updatedUser = await prisma.admin.update({
        where: { id: userId },
        data: updateData,
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          isVerified: true,
          isActive: true,
          phoneNumber: true,
          address: true,
          city: true,
          state: true,
          zipCode: true,
          country: true,
          dateOfBirth: true,
          currency: true,
          companyName: true,
          gstNumber: true,
          onboardingCompleted: true,
          // TEMPORARILY HIDDEN - timezone and dateFormat
          // timezone: true,
          // dateFormat: true,
          workingHours: {
            orderBy: {
              day: "asc",
            },
          },
        },
      });
      userType = "admin";
    }

    res.json({
      success: true,
      message: "Profile updated successfully",
      data: {
        ...updatedUser,
        role: userType,
      },
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update profile",
    });
  }
};

// Google OAuth Success Handler
const googleAuthSuccess = async (req, res) => {
  try {
    if (!req.user) {
      return res.redirect(
        `${process.env.FRONTEND_URL}/signin?error=auth_failed`
      );
    }

    // Generate JWT token
    const token = generateToken(req.user.id);

    // Track active session
    await sessionManager.addSession(req.user.id, token);

    // Set httpOnly cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });

    // Redirect to frontend with token (for backward compatibility)
    const redirectUrl = `${
      process.env.FRONTEND_URL
    }/auth/google/success?token=${token}&user=${encodeURIComponent(
      JSON.stringify({
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        role: req.user.role,
        image: req.user.image,
        isVerified: req.user.isVerified,
      })
    )}`;

    res.redirect(redirectUrl);
  } catch (error) {
    console.error("Google auth success error:", error);
    res.redirect(`${process.env.FRONTEND_URL}/signin?error=auth_failed`);
  }
};

// Google OAuth Failure Handler
const googleAuthFailure = (req, res) => {
  // Check if there's a specific error message in the session or query
  const errorType = req.query.error || req.session?.passport?.error;
  
  let errorMessage = "auth_cancelled";
  
  // Handle specific error types
  if (errorType === "EMAIL_NOT_VERIFIED" || (req.session?.passport?.error && req.session.passport.error.includes("EMAIL_NOT_VERIFIED"))) {
    errorMessage = "email_not_verified";
  }
  
  console.log("🔄 Google OAuth failure redirect:", errorMessage);
  res.redirect(`${process.env.FRONTEND_URL}/signin?error=${errorMessage}`);
};

// Get user addresses
const getAddresses = async (req, res) => {
  try {
    const userId = req.userId;

    // Find user in both collections to determine user type
    let user = await prisma.user.findUnique({
      where: { id: userId },
    });
    let userType = "user";

    if (!user) {
      user = await prisma.admin.findUnique({
        where: { id: userId },
      });
      userType = "admin";
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // Get addresses for the user
    const addresses = await prisma.address.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    res.json({
      success: true,
      data: addresses,
    });
  } catch (error) {
    console.error("Get addresses error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get addresses",
    });
  }
};

// Add new address
const addAddress = async (req, res) => {
  try {
    const userId = req.userId;
    const {
      label,
      fullName,
      phoneNumber,
      addressLine1,
      addressLine2,
      city,
      district,
      state,
      zipCode,
      country,
    } = req.body;

    // Validation
    if (
      !label ||
      !fullName ||
      !phoneNumber ||
      !addressLine1 ||
      !city ||
      !state ||
      !zipCode ||
      !country
    ) {
      return res.status(400).json({
        success: false,
        error: "All required fields must be provided",
      });
    }

    // Find user to ensure they exist
    let user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      user = await prisma.admin.findUnique({
        where: { id: userId },
      });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // Create new address
    const newAddress = await prisma.address.create({
      data: {
        userId,
        label,
        fullName,
        phoneNumber,
        addressLine1,
        addressLine2: addressLine2 || "",
        city,
        district: district || "",
        state,
        zipCode,
        country,
      },
    });

    res.status(201).json({
      success: true,
      message: "Address added successfully",
      data: newAddress,
    });
  } catch (error) {
    console.error("Add address error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to add address",
    });
  }
};

// Update existing address
const updateAddress = async (req, res) => {
  try {
    const userId = req.userId;
    const addressId = req.params.id;
    const {
      label,
      fullName,
      phoneNumber,
      addressLine1,
      addressLine2,
      city,
      district,
      state,
      zipCode,
      country,
    } = req.body;

    // Validation
    if (
      !label ||
      !fullName ||
      !phoneNumber ||
      !addressLine1 ||
      !city ||
      !state ||
      !zipCode ||
      !country
    ) {
      return res.status(400).json({
        success: false,
        error: "All required fields must be provided",
      });
    }

    // Check if address exists and belongs to user
    const existingAddress = await prisma.address.findFirst({
      where: {
        id: addressId,
        userId,
      },
    });

    if (!existingAddress) {
      return res.status(404).json({
        success: false,
        error: "Address not found or access denied",
      });
    }

    // Update address
    const updatedAddress = await prisma.address.update({
      where: { id: addressId },
      data: {
        label,
        fullName,
        phoneNumber,
        addressLine1,
        addressLine2: addressLine2 || "",
        city,
        district: district || "",
        state,
        zipCode,
        country,
      },
    });

    res.json({
      success: true,
      message: "Address updated successfully",
      data: updatedAddress,
    });
  } catch (error) {
    console.error("Update address error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update address",
    });
  }
};

// Delete address
const deleteAddress = async (req, res) => {
  try {
    const userId = req.userId;
    const addressId = req.params.id;

    // Check if address exists and belongs to user
    const existingAddress = await prisma.address.findFirst({
      where: {
        id: addressId,
        userId,
      },
    });

    if (!existingAddress) {
      return res.status(404).json({
        success: false,
        error: "Address not found or access denied",
      });
    }

    // Delete address
    await prisma.address.delete({
      where: { id: addressId },
    });

    res.json({
      success: true,
      message: "Address deleted successfully",
    });
  } catch (error) {
    console.error("Delete address error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete address",
    });
  }
};

// Complete admin onboarding (one-time setup)
const completeOnboarding = async (req, res) => {
  try {
    const userId = req.userId;
    const {
      name,
      phoneNumber,
      companyName,
      gstNumber,
      address,
      city,
      state,
      zipCode,
      country,
      currency,
      timezone,
      dateFormat,
    } = req.body;

    // Validation - Required fields
    // TEMPORARILY HIDDEN - timezone and dateFormat validation
    // if (!name || !phoneNumber || !companyName || !address || !state || !country || !currency || !timezone || !dateFormat) {
    if (!name || !phoneNumber || !companyName || !address || !state || !country || !currency) {
      return res.status(400).json({
        success: false,
        error: "All required onboarding fields must be provided",
      });
    }

    // Find admin
    const admin = await prisma.admin.findUnique({
      where: { id: userId },
    });

    if (!admin) {
      return res.status(404).json({
        success: false,
        error: "Admin not found",
      });
    }

    // Check if onboarding already completed
    if (admin.onboardingCompleted) {
      return res.status(400).json({
        success: false,
        error: "Onboarding already completed. Immutable settings cannot be changed.",
      });
    }

    // Update admin with onboarding data
    const updatedAdmin = await prisma.admin.update({
      where: { id: userId },
      data: {
        name,
        phoneNumber,
        companyName,
        gstNumber: gstNumber || null,
        address,
        city: city || null,
        state,
        zipCode: zipCode || null,
        country,
        currency,
        // TEMPORARILY HIDDEN - timezone and dateFormat
        // timezone,
        // dateFormat,
        onboardingCompleted: true,
      },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        isVerified: true,
        isActive: true,
        phoneNumber: true,
        address: true,
        city: true,
        state: true,
        zipCode: true,
        country: true,
        dateOfBirth: true,
        currency: true,
        companyName: true,
        gstNumber: true,
        onboardingCompleted: true,
        // TEMPORARILY HIDDEN - timezone and dateFormat
        // timezone: true,
        // dateFormat: true,
        workingHours: {
          orderBy: {
            day: "asc",
          },
        },
      },
    });

    res.json({
      success: true,
      message: "Onboarding completed successfully",
      data: {
        ...updatedAdmin,
        role: "admin",
      },
    });
  } catch (error) {
    console.error("Complete onboarding error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to complete onboarding",
    });
  }
};

// Get admin settings for other services
const getAdminSettings = async (req, res) => {
  try {
    // Get first active admin
    const admin = await prisma.admin.findFirst({
      where: {
        isActive: true,
        isVerified: true,
      },
      select: {
        currency: true,
        companyName: true,
        gstNumber: true,
        address: true,
        city: true,
        state: true,
        zipCode: true,
        country: true,
        phoneNumber: true,
        email: true,
      },
    });

    if (!admin) {
      return res.status(404).json({
        success: false,
        error: "Admin not found",
      });
    }

    // Format billing address
    const billingAddress = [
      admin.address,
      admin.city,
      admin.state,
      admin.zipCode,
      admin.country,
    ]
      .filter(Boolean)
      .join(", ");

    res.json({
      success: true,
      data: {
        currency: admin.currency || "INR",
        companyName: admin.companyName || "",
        gstNumber: admin.gstNumber || "",
        address: admin.address || "",
        city: admin.city || "",
        state: admin.state || "",
        zipCode: admin.zipCode || "",
        country: admin.country || "",
        phoneNumber: admin.phoneNumber || "",
        email: admin.email || "",
        billingAddress,
      },
    });
  } catch (error) {
    console.error("Get admin settings error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get admin settings",
    });
  }
};

// Get user statistics
const getUserStats = async (req, res) => {
  try {
    const userId = req.userId;

    // Find user in both collections to determine user type
    let user = await prisma.user.findUnique({
      where: { id: userId },
    });
    let userType = "user";

    if (!user) {
      user = await prisma.admin.findUnique({
        where: { id: userId },
      });
      userType = "admin";
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // For admin users, return basic stats
    if (userType === "admin") {
      return res.json({
        success: true,
        data: {
          accountType: "admin",
          memberSince: user.createdAt,
          lastLogin: user.lastLogin,
          isVerified: user.isVerified,
        },
      });
    }

    // For regular users, get comprehensive stats
    try {
      // Get customer record for order stats
      const customer = await prisma.customer.findUnique({
        where: { userId },
      });

      // Get online orders
      const onlineOrders = await prisma.onlineOrder.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });

      // Get POS orders if customer exists
      let posOrders = [];
      if (customer) {
        posOrders = await prisma.pOSOrder.findMany({
          where: { customerId: customer.id },
          orderBy: { createdAt: "desc" },
        });
      }

      // Calculate comprehensive stats
      const allOrders = [...onlineOrders, ...posOrders];
      const totalOrders = allOrders.length;
      const totalSpent = allOrders.reduce((sum, order) => sum + order.total, 0);
      const completedOrders = allOrders.filter(order => 
        order.orderStatus === 'delivered' || order.orderStatus === 'completed'
      ).length;
      const pendingOrders = allOrders.filter(order => 
        ['pending', 'confirmed', 'processing', 'shipped'].includes(order.orderStatus)
      ).length;
      const cancelledOrders = allOrders.filter(order => 
        order.orderStatus === 'cancelled'
      ).length;
      const averageOrderValue = totalOrders > 0 ? totalSpent / totalOrders : 0;
      const lastOrderDate = allOrders.length > 0 ? allOrders[0].createdAt : null;

      // Get recent orders (last 5)
      const recentOrders = allOrders.slice(0, 5).map(order => ({
        id: order.id,
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        total: order.total,
        orderStatus: order.orderStatus,
        createdAt: order.createdAt,
        itemCount: Array.isArray(order.items) ? order.items.length : 0,
      }));

      const stats = {
        accountType: "user",
        memberSince: user.createdAt,
        lastLogin: user.lastLogin,
        isVerified: user.isVerified,
        totalOrders,
        totalSpent,
        completedOrders,
        pendingOrders,
        cancelledOrders,
        averageOrderValue,
        lastOrderDate,
        recentOrders,
        // Wishlist and cart stats
        wishlistItems: customer ? await prisma.wishlistItem.count({
          where: { customerId: customer.id }
        }) : 0,
        cartItems: customer ? await prisma.cart.count({
          where: { customerId: customer.id }
        }) : 0,
      };

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      console.error("Error calculating user stats:", error);
      // Return basic stats if detailed calculation fails
      res.json({
        success: true,
        data: {
          accountType: "user",
          memberSince: user.createdAt,
          lastLogin: user.lastLogin,
          isVerified: user.isVerified,
          totalOrders: 0,
          totalSpent: 0,
          completedOrders: 0,
          pendingOrders: 0,
          cancelledOrders: 0,
          averageOrderValue: 0,
          lastOrderDate: null,
          recentOrders: [],
          wishlistItems: 0,
          cartItems: 0,
        },
      });
    }
  } catch (error) {
    console.error("Get user stats error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get user statistics",
    });
  }
};

module.exports = {
  register,
  login,
  googleCallback,
  verifyEmail,
  forgotPassword,
  resetPassword,
  getCurrentUser,
  logout,
  updateProfile,
  googleAuthSuccess,
  googleAuthFailure,
  completeOnboarding,
  getAdminSettings,
  getAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
  getUserStats,
};
