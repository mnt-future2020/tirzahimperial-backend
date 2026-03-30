const { prisma } = require("../../config/database");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { sendEmail: sendSMTPEmail, sendEmailWithEnv } = require("../../config/connectSMTP");

/**
 * Partner Login
 */
const partnerLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email or phone and password are required",
      });
    }

    // Find partner by email or phone
    const partner = await prisma.deliveryPartner.findFirst({
      where: {
        OR: [
          { email: email.toLowerCase() },
          { phone: email }, // email field can contain phone number
        ],
      },
    });

    if (!partner) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Check if partner is approved
    if (partner.applicationStatus !== "approved") {
      return res.status(403).json({
        success: false,
        message: "Your application is not yet approved",
      });
    }

    // Check if partner is suspended
    if (partner.partnerStatus === "suspended") {
      return res.status(403).json({
        success: false,
        message: "Your account has been suspended. Please contact support.",
      });
    }

    // Check if partner is inactive
    if (partner.partnerStatus === "inactive") {
      return res.status(403).json({
        success: false,
        message: "Your account is inactive. Please contact support.",
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, partner.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Check if email is verified
    if (!partner.isEmailVerified) {
      return res.status(403).json({
        success: false,
        message: "Please verify your email before logging in",
        requiresVerification: true,
      });
    }

    // Update last login and set online status
    await prisma.deliveryPartner.update({
      where: { id: partner.id },
      data: { 
        lastLogin: new Date(),
        isOnline: true,
        isAvailable: true
      },
    });

    // Generate JWT token
    const token = jwt.sign(
      {
        id: partner.id,
        userId: partner.id, // Add userId for session manager
        partnerId: partner.partnerId,
        email: partner.email,
        role: "delivery_partner",
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Create session in database
    const sessionManager = require('../../utils/auth/sessionManager');
    await sessionManager.addSession(partner.id, token);

    res.json({
      success: true,
      message: "Login successful",
      data: {
        token,
        partner: {
          id: partner.id,
          partnerId: partner.partnerId,
          name: partner.name,
          email: partner.email,
          phone: partner.phone,
          partnerStatus: partner.partnerStatus,
          isEmailVerified: partner.isEmailVerified,
          isOnline: true,
          isAvailable: true,
        },
      },
    });
  } catch (error) {
    console.error("Partner login error:", error);
    res.status(500).json({
      success: false,
      message: "Login failed",
      error: error.message,
    });
  }
};

/**
 * Verify Partner Email
 */
const verifyPartnerEmail = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Verification token is required",
      });
    }

    // Find partner with this token
    const partner = await prisma.deliveryPartner.findFirst({
      where: { emailVerificationToken: token },
    });

    if (!partner) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification token",
      });
    }

    // Update partner
    await prisma.deliveryPartner.update({
      where: { id: partner.id },
      data: {
        isEmailVerified: true,
        emailVerifiedAt: new Date(),
        emailVerificationToken: null,
      },
    });

    res.json({
      success: true,
      message: "Email verified successfully. You can now login.",
    });
  } catch (error) {
    console.error("Email verification error:", error);
    res.status(500).json({
      success: false,
      message: "Email verification failed",
      error: error.message,
    });
  }
};

/**
 * Change Partner Password
 */
const changePartnerPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const partnerId = req.user.id; // From auth middleware

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 8 characters long",
      });
    }

    // Get partner
    const partner = await prisma.deliveryPartner.findUnique({
      where: { id: partnerId },
    });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: "Partner not found",
      });
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, partner.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await prisma.deliveryPartner.update({
      where: { id: partnerId },
      data: { password: hashedPassword },
    });

    res.json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to change password",
      error: error.message,
    });
  }
};

/**
 * Get Partner Profile (Complete Data)
 */
const getPartnerProfile = async (req, res) => {
  try {
    const partnerId = req.user.id; // From auth middleware
    const { getPresignedUrl } = require("../../utils/delivery/uploadS3");

    const partner = await prisma.deliveryPartner.findUnique({
      where: { id: partnerId },
      select: {
        // Basic Info
        id: true,
        partnerId: true,
        name: true,
        email: true,
        phone: true,
        dateOfBirth: true,
        gender: true,
        alternateMobileNumber: true,
        profilePhoto: true,
        
        // Address
        address: true,
        city: true,
        state: true,
        pincode: true,
        country: true,
        
        // ID Proof & Verification
        aadharNumber: true,
        aadharDocument: true,
        licenseNumber: true,
        licenseDocument: true,
        idProofDocument: true,
        
        // Vehicle Details
        vehicleType: true,
        vehicleModel: true,
        vehicleNumber: true,
        vehicleRCDocument: true,
        insuranceValidityDate: true,
        insuranceDocument: true,
        pollutionCertificateValidity: true,
        pollutionCertDocument: true,
        
        // Emergency Contact
        emergencyContactName: true,
        emergencyRelationship: true,
        emergencyContactNumber: true,
        
        // Status & Stats
        applicationStatus: true,
        partnerStatus: true,
        isEmailVerified: true,
        isAvailable: true,
        isOnline: true,
        rating: true,
        averageRating: true,
        totalRatings: true,
        totalDeliveries: true,
        todayDeliveries: true,
        weeklyDeliveries: true,
        monthlyDeliveries: true,
        
        // Dates
        joiningDate: true,
        approvedAt: true,
        lastLogin: true,
        createdAt: true,
        updatedAt: true,
        
        // Exclude sensitive data
        password: false,
        emailVerificationToken: false,
        resetToken: false,
        resetTokenExpiry: false,
        fcmTokens: false,
      },
    });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: "Partner not found",
      });
    }

    // Generate presigned URLs for all documents
    const partnerWithUrls = {
      ...partner,
      profilePhotoUrl: partner.profilePhoto 
        ? await getPresignedUrl(partner.profilePhoto, 3600) 
        : null,
      aadharDocumentUrl: partner.aadharDocument 
        ? await getPresignedUrl(partner.aadharDocument, 3600) 
        : null,
      licenseDocumentUrl: partner.licenseDocument 
        ? await getPresignedUrl(partner.licenseDocument, 3600) 
        : null,
      vehicleRCDocumentUrl: partner.vehicleRCDocument 
        ? await getPresignedUrl(partner.vehicleRCDocument, 3600) 
        : null,
      insuranceDocumentUrl: partner.insuranceDocument 
        ? await getPresignedUrl(partner.insuranceDocument, 3600) 
        : null,
      pollutionCertDocumentUrl: partner.pollutionCertDocument 
        ? await getPresignedUrl(partner.pollutionCertDocument, 3600) 
        : null,
      idProofDocumentUrl: partner.idProofDocument 
        ? await getPresignedUrl(partner.idProofDocument, 3600) 
        : null,
    };

    res.json({
      success: true,
      data: partnerWithUrls,
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get profile",
      error: error.message,
    });
  }
};

/**
 * Request Password Reset
 */
const requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const partner = await prisma.deliveryPartner.findUnique({
      where: { email: email.toLowerCase() },
    });

    // Don't reveal if email exists (security best practice)
    if (!partner) {
      return res.json({
        success: true,
        message: "If the email exists, a password reset link has been sent",
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour

    await prisma.deliveryPartner.update({
      where: { id: partner.id },
      data: {
        resetToken,
        resetTokenExpiry,
      },
    });

    // Send password reset email
    const webResetUrl = `${process.env.FRONTEND_URL}/partner/reset-password?token=${resetToken}`;
    const mobileResetUrl = `delivery://reset-password?token=${resetToken}`;
    
    const emailData = {
      to: email,
      subject: "Reset Your Password - Delivery Partner Portal",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Password Reset Request</h2>
          <p>Hi ${partner.name},</p>
          <p>You requested to reset your password for your delivery partner account. Click the button below to reset it:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${webResetUrl}" 
               style="background-color: #DC2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Reset Password
            </a>
          </div>
          <p><strong>For Mobile App Users:</strong></p>
          <p>If you're using the mobile app, click this link instead:</p>
          <div style="text-align: center; margin: 20px 0;">
            <a href="${mobileResetUrl}" 
               style="background-color: #e63946; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Open in Mobile App
            </a>
          </div>
          <p>Or copy and paste this link in your browser:</p>
          <p style="word-break: break-all; color: #6B7280;">${webResetUrl}</p>
          <p>This link will expire in 1 hour.</p>
          <p>If you didn't request this, please ignore this email.</p>
        </div>
      `,
    };

    // Send email (non-blocking)
    setImmediate(async () => {
      try {
        // Get active email configuration from database
        const emailConfig = await prisma.emailConfiguration.findFirst({
          where: { isActive: true }
        });

        if (emailConfig) {
          await sendSMTPEmail(emailConfig, emailData);
        } else {
          await sendEmailWithEnv(emailData);
        }
        console.log(`✅ Password reset email sent to: ${email}`);
      } catch (err) {
        console.error("Failed to send password reset email:", err);
      }
    });

    res.json({
      success: true,
      message: "If the email exists, a password reset link has been sent",
    });
  } catch (error) {
    console.error("Password reset request error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process password reset request",
      error: error.message,
    });
  }
};

/**
 * Reset Password
 */
const resetPassword = async (req, res) => {
  try {
    const { token, newPassword, phone, email, otp } = req.body;

    if (!newPassword) {
      return res.status(400).json({
        success: false,
        message: "New password is required",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters long",
      });
    }

    let partner;

    // Check if it's token-based (email) or OTP-based (phone/email) reset
    if (token) {
      // Token-based reset (email link)
      partner = await prisma.deliveryPartner.findFirst({
        where: {
          resetToken: token,
          resetTokenExpiry: { gte: new Date() },
        },
      });

      if (!partner) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired reset token",
        });
      }
    } else if ((phone || email) && otp) {
      // OTP-based reset (phone or email)
      const identifier = phone || email;
      
      partner = await prisma.deliveryPartner.findFirst({
        where: {
          AND: [
            {
              OR: [
                phone ? { phone } : {},
                email ? { email: email.toLowerCase() } : {},
              ].filter(obj => Object.keys(obj).length > 0),
            },
            {
              resetToken: otp,
              resetTokenExpiry: { gte: new Date() },
            },
          ],
        },
      });

      if (!partner) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired OTP",
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        message: "Either token or phone/email+otp is required",
      });
    }
      

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and clear reset token
    await prisma.deliveryPartner.update({
      where: { id: partner.id },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    res.json({
      success: true,
      message: "Password reset successfully",
    });
  } catch (error) {
    console.error("Password reset error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reset password",
      error: error.message,
    });
  }
};

/**
 * Partner Registration
 */
const partnerRegister = async (req, res) => {
  try {
    const { name, email, phone, password, vehicleType, vehicleNumber } = req.body;

    // Validation
    if (!name || !email || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email, phone, and password are required",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters long",
      });
    }

    // Check if partner already exists
    const existingPartner = await prisma.deliveryPartner.findFirst({
      where: {
        OR: [
          { email: email.toLowerCase() },
          { phone: phone },
        ],
      },
    });

    if (existingPartner) {
      return res.status(400).json({
        success: false,
        message: "Partner with this email or phone already exists",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate partner ID
    const lastPartner = await prisma.deliveryPartner.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { partnerId: true },
    });

    let partnerIdNumber = 1;
    if (lastPartner && lastPartner.partnerId) {
      const lastNumber = parseInt(lastPartner.partnerId.replace('DP', ''));
      partnerIdNumber = lastNumber + 1;
    }
    const partnerId = `DP${String(partnerIdNumber).padStart(4, '0')}`;

    // Generate email verification token
    const emailVerificationToken = crypto.randomBytes(32).toString("hex");

    // Create partner
    const partner = await prisma.deliveryPartner.create({
      data: {
        partnerId,
        name,
        email: email.toLowerCase(),
        phone,
        password: hashedPassword,
        vehicleType: vehicleType || null,
        vehicleNumber: vehicleNumber || null,
        applicationStatus: 'pending',
        partnerStatus: 'inactive',
        isEmailVerified: false,
        emailVerificationToken,
      },
    });

    // Send verification email
    const verificationUrl = `${process.env.FRONTEND_URL}/partner/verify-email?token=${emailVerificationToken}`;
    
    const emailData = {
      to: email,
      subject: "Verify Your Email - Delivery Partner Registration",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Welcome to Our Delivery Partner Network!</h2>
          <p>Hi ${name},</p>
          <p>Thank you for registering as a delivery partner. Please verify your email address to complete your registration:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationUrl}" 
               style="background-color: #e63946; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Verify Email
            </a>
          </div>
          <p>Or copy and paste this link in your browser:</p>
          <p style="word-break: break-all; color: #6B7280;">${verificationUrl}</p>
          <p>Your Partner ID: <strong>${partnerId}</strong></p>
          <p>After verification, your application will be reviewed by our team.</p>
        </div>
      `,
    };

    // Send email (non-blocking)
    setImmediate(async () => {
      try {
        const emailConfig = await prisma.emailConfiguration.findFirst({
          where: { isActive: true }
        });

        if (emailConfig) {
          await sendSMTPEmail(emailConfig, emailData);
        } else {
          await sendEmailWithEnv(emailData);
        }
        console.log(`✅ Verification email sent to: ${email}`);
      } catch (err) {
        console.error("Failed to send verification email:", err);
      }
    });

    res.status(201).json({
      success: true,
      message: "Registration successful. Please check your email to verify your account.",
      data: {
        partnerId: partner.partnerId,
        name: partner.name,
        email: partner.email,
        phone: partner.phone,
      },
    });
  } catch (error) {
    console.error("Partner registration error:", error);
    res.status(500).json({
      success: false,
      message: "Registration failed",
      error: error.message,
    });
  }
};

/**
 * Update Partner Profile
 */
const updatePartnerProfile = async (req, res) => {
  try {
    const partnerId = req.user.id;
    const { name, email, phone, vehicleType, vehicleNumber, profilePhoto } = req.body;

    const updateData = {};
    
    if (name) updateData.name = name;
    if (email) updateData.email = email.toLowerCase();
    if (phone) updateData.phone = phone;
    if (vehicleType) updateData.vehicleType = vehicleType;
    if (vehicleNumber) updateData.vehicleNumber = vehicleNumber;
    if (profilePhoto) updateData.profilePhoto = profilePhoto;

    // Check if email or phone already exists for another partner
    if (email || phone) {
      const existingPartner = await prisma.deliveryPartner.findFirst({
        where: {
          AND: [
            { id: { not: partnerId } },
            {
              OR: [
                email ? { email: email.toLowerCase() } : {},
                phone ? { phone: phone } : {},
              ].filter(obj => Object.keys(obj).length > 0),
            },
          ],
        },
      });

      if (existingPartner) {
        return res.status(400).json({
          success: false,
          message: "Email or phone already in use by another partner",
        });
      }
    }

    const partner = await prisma.deliveryPartner.update({
      where: { id: partnerId },
      data: updateData,
      select: {
        id: true,
        partnerId: true,
        name: true,
        email: true,
        phone: true,
        vehicleType: true,
        vehicleNumber: true,
        profilePhoto: true,
        applicationStatus: true,
        partnerStatus: true,
        isEmailVerified: true,
      },
    });

    res.json({
      success: true,
      message: "Profile updated successfully",
      data: partner,
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update profile",
      error: error.message,
    });
  }
};

/**
 * Verify OTP
 */
const verifyOTP = async (req, res) => {
  try {
    const { phone, email, otp } = req.body;
    const identifier = phone || email;

    if (!identifier || !otp) {
      return res.status(400).json({
        success: false,
        message: "Phone/Email and OTP are required",
      });
    }

    // Find partner with this identifier and OTP
    const partner = await prisma.deliveryPartner.findFirst({
      where: {
        AND: [
          {
            OR: [
              phone ? { phone } : {},
              email ? { email: email.toLowerCase() } : {},
            ].filter(obj => Object.keys(obj).length > 0),
          },
          {
            resetToken: otp,
            resetTokenExpiry: { gte: new Date() },
          },
        ],
      },
    });

    if (!partner) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP",
      });
    }

    res.json({
      success: true,
      message: "OTP verified successfully",
      data: {
        identifier,
        verified: true,
      },
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify OTP",
      error: error.message,
    });
  }
};

/**
 * Resend OTP
 */
const resendOTP = async (req, res) => {
  try {
    const { phone, email } = req.body;
    const identifier = phone || email;

    if (!identifier) {
      return res.status(400).json({
        success: false,
        message: "Phone number or email is required",
      });
    }

    // Find partner by phone or email
    const partner = await prisma.deliveryPartner.findFirst({
      where: {
        OR: [
          phone ? { phone } : {},
          email ? { email: email.toLowerCase() } : {},
        ].filter(obj => Object.keys(obj).length > 0),
      },
    });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: "Partner not found",
      });
    }

    // Generate new OTP (6 digits)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 600000); // 10 minutes

    await prisma.deliveryPartner.update({
      where: { id: partner.id },
      data: {
        resetToken: otp,
        resetTokenExpiry: otpExpiry,
      },
    });

    // Send OTP via SMS or Email
    if (phone) {
      // In production, send OTP via SMS service
      console.log(`📱 OTP for ${phone}: ${otp}`);
      // TODO: Integrate SMS service (Twilio, AWS SNS, etc.)
      // await sendSMS(phone, `Your OTP is: ${otp}. Valid for 10 minutes.`);
    } else if (email) {
      // Send OTP via email
      const emailData = {
        to: email,
        subject: "Your OTP - Delivery Partner Portal",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Password Reset OTP</h2>
            <p>Hi ${partner.name},</p>
            <p>Your OTP for password reset is:</p>
            <div style="text-align: center; margin: 30px 0;">
              <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; display: inline-block;">
                <h1 style="margin: 0; color: #e63946; font-size: 36px; letter-spacing: 8px;">${otp}</h1>
              </div>
            </div>
            <p>This OTP will expire in 10 minutes.</p>
            <p>If you didn't request this, please ignore this email.</p>
          </div>
        `,
      };

      // Send email (non-blocking)
      setImmediate(async () => {
        try {
          const emailConfig = await prisma.emailConfiguration.findFirst({
            where: { isActive: true }
          });

          if (emailConfig) {
            await sendSMTPEmail(emailConfig, emailData);
          } else {
            await sendEmailWithEnv(emailData);
          }
          console.log(`✅ OTP email sent to: ${email}`);
        } catch (err) {
          console.error("Failed to send OTP email:", err);
        }
      });
    }

    res.json({
      success: true,
      message: "OTP sent successfully",
      // Remove this in production
      ...(process.env.NODE_ENV === 'development' && { otp }),
    });
  } catch (error) {
    console.error("Resend OTP error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to resend OTP",
      error: error.message,
    });
  }
};

module.exports = {
  partnerLogin,
  partnerRegister,
  verifyPartnerEmail,
  changePartnerPassword,
  getPartnerProfile,
  updatePartnerProfile,
  requestPasswordReset,
  resetPassword,
  verifyOTP,
  resendOTP,
};
