const express = require('express');
const {
  mobileRegister,
  verifyOTP,
  resendOTP,
  mobileLogin,
} = require('../../controllers/auth/mobileAuthController');

// Import Phone Auth Controller
const {
  phoneRegister,
  phoneLogin,
} = require('../../controllers/auth/phoneAuthController');

// Import Mobile Forgot Password Controller
const {
  resetPasswordWithPhone,
} = require('../../controllers/auth/mobileForgotPasswordController');

const router = express.Router();

// ============================================
// MOBILE APP SPECIFIC ROUTES
// ============================================

/**
 * Mobile App Registration with OTP
 * POST /api/auth/mobile/register
 * Body: { email, password, name, phoneNumber }
 * Response: { success, message, data: { id, email, name, role, otpSent } }
 */
router.post('/register', mobileRegister);

/**
 * Verify OTP for Mobile App
 * POST /api/auth/mobile/verify-otp
 * Body: { email, otp }
 * Response: { success, message, data: { id, email, name, isVerified, role } }
 */
router.post('/verify-otp', verifyOTP);

/**
 * Resend OTP for Mobile App
 * POST /api/auth/mobile/resend-otp
 * Body: { email }
 * Response: { success, message, data: { email, otpSent } }
 */
router.post('/resend-otp', resendOTP);

/**
 * Mobile App Login
 * POST /api/auth/mobile/login
 * Body: { email, password, fcmToken? }
 * Response: { success, message, data: { token, user } }
 */
router.post('/login', mobileLogin);

// ============================================
// PHONE AUTHENTICATION ROUTES (Firebase SMS OTP)
// ============================================

/**
 * Register with Phone Verification (Firebase SMS OTP)
 * POST /api/auth/mobile/phone-register
 * Body: { name, email, phoneNumber, password, firebaseToken }
 * Response: { success, message, data: { token, user } }
 * 
 * Note: firebaseToken is obtained after Firebase phone verification on client
 */
router.post('/phone-register', phoneRegister);

/**
 * Login with Phone Verification (Firebase SMS OTP)
 * POST /api/auth/mobile/phone-login
 * Body: { phoneNumber, firebaseToken, fcmToken? }
 * Response: { success, message, data: { token, user } }
 * 
 * Note: firebaseToken is obtained after Firebase phone verification on client
 */
router.post('/phone-login', phoneLogin);

// ============================================
// FORGOT PASSWORD ROUTES (Firebase SMS OTP)
// ============================================

/**
 * Reset Password with Phone Verification (Firebase SMS OTP)
 * POST /api/auth/mobile/reset-password-phone
 * Body: { phoneNumber, newPassword, firebaseToken }
 * Response: { success, message }
 * 
 * Note: firebaseToken is obtained after Firebase phone verification on client
 */
router.post('/reset-password-phone', resetPasswordWithPhone);

module.exports = router;
