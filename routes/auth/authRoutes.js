const express = require('express');
const passport = require('passport');
const {
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
  getUserStats
} = require('../../controllers/auth/authController');

// Import partner auth controller
const {
  partnerLogin,
  verifyPartnerEmail,
  changePartnerPassword,
  getPartnerProfile,
  requestPasswordReset: partnerRequestPasswordReset,
  resetPassword: partnerResetPassword,
} = require('../../controllers/partner/partnerAuthController');

// Import FCM token controller
const {
  saveFCMToken,
  removeFCMToken,
} = require('../../controllers/auth/fcmTokenController');

// Import mobile auth routes
const mobileAuthRoutes = require('./mobileAuthRoutes');

const { authenticateToken } = require('../../middleware/auth');

const router = express.Router();

// ============================================
// USER & ADMIN ROUTES
// ============================================

// Mobile App Routes (OTP-based verification)
router.use('/mobile', mobileAuthRoutes);

// Public routes
router.post('/register', register);
router.post('/login', login);
router.post('/google-callback', googleCallback); // Keep for backward compatibility
router.post('/google/callback', googleCallback); // Mobile app endpoint (with slash)
router.post('/verify-email', verifyEmail);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// Google OAuth routes
router.get('/google', 
  passport.authenticate('google', { scope: ['profile', 'email'] })
);



router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/api/auth/google/failure' }),
  googleAuthSuccess
);


router.get('/google/mobile-failure', (req, res) => {
  res.redirect('ecommerce://auth/google/callback?error=auth_cancelled');
});

router.get('/google/failure', googleAuthFailure);

// Protected routes
router.get('/me', authenticateToken, getCurrentUser);
router.get('/stats', authenticateToken, getUserStats);
router.post('/logout', authenticateToken, logout);
router.put('/profile', authenticateToken, updateProfile);

// FCM Token routes
router.post('/fcm-token', saveFCMToken);
router.delete('/fcm-token', removeFCMToken);

// Address management routes
router.get('/addresses', authenticateToken, getAddresses);
router.post('/addresses', authenticateToken, addAddress);
router.put('/addresses/:id', authenticateToken, updateAddress);
router.delete('/addresses/:id', authenticateToken, deleteAddress);

// Admin specific routes (same controllers, different endpoints)
router.get('/admin/me', authenticateToken, getCurrentUser);
router.put('/admin/profile', authenticateToken, updateProfile);
router.put('/admin/onboarding', authenticateToken, completeOnboarding);

// System routes for microservice communication
router.get('/admin/settings', getAdminSettings); // Admin settings for all services

// Public routes - no authentication required
router.get('/currency', async (req, res) => {
  try {
    const admin = await require('../../config/database').prisma.admin.findFirst({
      where: {
        isActive: true,
        isVerified: true,
      },
      select: {
        currency: true,
        country: true,
      },
    });

    if (!admin) {
      return res.status(404).json({
        success: false,
        error: 'Admin settings not found',
      });
    }

    res.json({
      success: true,
      data: {
        currency: admin.currency,
        country: admin.country,
      },
    });
  } catch (error) {
    console.error('Get currency error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch currency settings',
    });
  }
});

// Public admin state endpoint for GST calculation
router.get('/admin-state', async (req, res) => {
  try {
    const admin = await require('../../config/database').prisma.admin.findFirst({
      where: {
        isActive: true,
        isVerified: true,
      },
      select: {
        state: true,
        country: true,
      },
    });

    if (!admin) {
      return res.status(404).json({
        success: false,
        error: 'Admin settings not found',
      });
    }

    res.json({
      success: true,
      data: {
        state: admin.state,
        country: admin.country,
      },
    });
  } catch (error) {
    console.error('Get admin state error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch admin state',
    });
  }
});

// ============================================
// DELIVERY PARTNER ROUTES
// ============================================

// Partner public routes
router.post('/partner/login', partnerLogin);
router.post('/partner/verify-email', verifyPartnerEmail);
router.post('/partner/forgot-password', partnerRequestPasswordReset);
router.post('/partner/reset-password', partnerResetPassword);

// Partner protected routes
router.get('/partner/me', authenticateToken, getPartnerProfile);
router.post('/partner/change-password', authenticateToken, changePartnerPassword);

module.exports = router;