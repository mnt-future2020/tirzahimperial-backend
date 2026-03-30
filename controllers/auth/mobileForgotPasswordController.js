const bcrypt = require("bcrypt");
const { prisma } = require("../../config/database");
const admin = require('firebase-admin');
const { getFirebaseAdmin } = require('../../utils/firebase/firebaseAdmin');

// Initialize Firebase Admin
getFirebaseAdmin();

/**
 * Reset Password with Phone Verification (Firebase SMS OTP)
 * POST /api/auth/mobile/reset-password-phone
 * Body: { phoneNumber, newPassword, firebaseToken }
 */
const resetPasswordWithPhone = async (req, res) => {
  try {
    console.log("📱 Reset password with phone request received");
    const { phoneNumber, newPassword, firebaseToken } = req.body;

    // Validation
    if (!phoneNumber || !newPassword || !firebaseToken) {
      return res.status(400).json({
        success: false,
        error: "Phone number, new password, and Firebase token are required",
      });
    }

    // Password validation
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: "Password must be at least 6 characters",
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

    // Find user by phone number
    let user = await prisma.user.findFirst({
      where: { phoneNumber }
    });

    let userType = "user";

    if (!user) {
      user = await prisma.admin.findFirst({
        where: { phoneNumber }
      });
      userType = "admin";
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "Account not found with this phone number",
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        error: "Account is deactivated. Please contact administrator.",
      });
    }

    // Hash new password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password
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

    console.log(`✅ Password reset successful for: ${phoneNumber}`);

    res.json({
      success: true,
      message: "Password reset successful. You can now sign in with your new password.",
    });
  } catch (error) {
    console.error("Reset password with phone error:", error);
    res.status(500).json({
      success: false,
      error: "Password reset failed. Please try again.",
    });
  }
};

module.exports = {
  resetPasswordWithPhone,
};
