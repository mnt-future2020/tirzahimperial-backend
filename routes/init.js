const express = require('express');
const router = express.Router();
const { initializeAdmin } = require('../utils/auth/initializeAdmin');

/**
 * Manual admin initialization endpoint
 * GET /api/init/admin
 * 
 * This endpoint can be called to manually initialize the admin user
 * if the automatic initialization on server startup fails (e.g., in Vercel)
 */
router.get('/admin', async (req, res) => {
  try {
    console.log('📞 Manual admin initialization requested');
    
    const result = await initializeAdmin();
    
    if (result.success) {
      return res.status(200).json({
        success: true,
        message: result.message,
        admin: {
          id: result.admin?.id,
          email: result.admin?.email,
          name: result.admin?.name
        }
      });
    } else {
      return res.status(500).json({
        success: false,
        message: result.message,
        error: result.error?.message
      });
    }
  } catch (error) {
    console.error('❌ Error in manual admin initialization:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to initialize admin',
      error: error.message
    });
  }
});

/**
 * Health check for initialization service
 * GET /api/init/health
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Initialization service is running',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
