const express = require('express');
const router = express.Router();
const { prisma } = require('../../config/database');
const { getDeliveryMessaging } = require('../../utils/firebase/firebaseAdmin');

/**
 * Debug endpoint to check notification system status
 * GET /api/debug/notifications/status
 */
router.get('/status', async (req, res) => {
  try {
    const status = {
      timestamp: new Date().toISOString(),
      firebase: {
        delivery: {
          initialized: false,
          projectId: process.env.DELIVERY_FIREBASE_PROJECT_ID || 'NOT SET',
        },
      },
      partners: {
        total: 0,
        withTokens: 0,
        tokens: [],
      },
    };

    // Check Firebase initialization
    const messaging = getDeliveryMessaging();
    status.firebase.delivery.initialized = !!messaging;

    // Check partners with FCM tokens
    const partners = await prisma.deliveryPartner.findMany({
      where: {
        applicationStatus: 'approved',
        partnerStatus: 'active',
      },
      select: {
        id: true,
        partnerId: true,
        name: true,
        email: true,
        fcmTokens: true,
      },
    });

    status.partners.total = partners.length;
    status.partners.withTokens = partners.filter(
      p => Array.isArray(p.fcmTokens) && p.fcmTokens.length > 0
    ).length;

    status.partners.tokens = partners
      .filter(p => Array.isArray(p.fcmTokens) && p.fcmTokens.length > 0)
      .map(p => ({
        partnerId: p.partnerId,
        name: p.name,
        email: p.email,
        deviceCount: p.fcmTokens.length,
        devices: p.fcmTokens.map(t => ({
          device: t.device,
          tokenPreview: t.token.substring(0, 30) + '...',
          lastUsed: t.lastUsed,
        })),
      }));

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error('Error checking notification status:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Debug endpoint to send test notification to a partner
 * POST /api/debug/notifications/test/:partnerId
 */
router.post('/test/:partnerId', async (req, res) => {
  try {
    const { partnerId } = req.params;

    const partner = await prisma.deliveryPartner.findUnique({
      where: { id: partnerId },
      select: {
        id: true,
        partnerId: true,
        name: true,
        email: true,
        fcmTokens: true,
      },
    });

    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found',
      });
    }

    const tokens = Array.isArray(partner.fcmTokens) ? partner.fcmTokens : [];
    if (tokens.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Partner has no FCM tokens',
      });
    }

    const { sendToPartner } = require('../../utils/notification/sendNotification');
    const result = await sendToPartner(
      partnerId,
      {
        title: '🧪 Test Notification',
        body: `Hi ${partner.name}! This is a test notification. If you see this, notifications are working!`,
      },
      {
        type: 'TEST',
        timestamp: new Date().toISOString(),
      }
    );

    res.json({
      success: true,
      data: {
        partner: {
          id: partner.id,
          partnerId: partner.partnerId,
          name: partner.name,
          email: partner.email,
          deviceCount: tokens.length,
        },
        result,
      },
    });
  } catch (error) {
    console.error('Error sending test notification:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
