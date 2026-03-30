const { prisma } = require('../../config/database');
const crypto = require('crypto');

/**
 * Handle payment webhook (Razorpay)
 * POST /api/payment-gateway/webhook/razorpay
 */
const handleRazorpayWebhook = async (req, res) => {
  try {
    const webhookBody = req.body;
    const webhookSignature = req.headers['x-razorpay-signature'];

    // Get active Razorpay gateway
    const gateway = await prisma.paymentGateway.findFirst({
      where: {
        name: 'razorpay',
        isActive: true
      }
    });

    if (!gateway || !gateway.webhookSecret) {
      console.error('❌ Razorpay webhook secret not configured');
      return res.status(400).json({
        success: false,
        error: 'Webhook not configured'
      });
    }

    // Verify webhook signature
    const expectedSignature = crypto
      .createHmac('sha256', gateway.webhookSecret)
      .update(JSON.stringify(webhookBody))
      .digest('hex');

    if (expectedSignature !== webhookSignature) {
      console.error('❌ Webhook signature verification failed');
      return res.status(400).json({
        success: false,
        error: 'Invalid webhook signature'
      });
    }

    const event = webhookBody.event;
    const payload = webhookBody.payload.payment.entity;

    console.log(`📥 Received Razorpay webhook event: ${event}`);

    // Handle different webhook events
    switch (event) {
      case 'payment.captured':
        await handlePaymentCaptured(payload);
        break;
      case 'payment.failed':
        await handlePaymentFailed(payload);
        break;
      default:
        console.log(`Unhandled webhook event: ${event}`);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error handling Razorpay webhook:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process webhook',
      message: error.message
    });
  }
};

/**
 * Handle payment captured event
 */
const handlePaymentCaptured = async (payload) => {
  try {
    const orderNumber = payload.notes?.orderNumber;
    const userId = payload.notes?.userId;
    
    if (!orderNumber) {
      console.error('❌ Order number not found in payment notes');
      return;
    }

    console.log(`✅ Payment captured for order ${orderNumber}: ${payload.id}`);

    // Check if order already exists
    const existingOrder = await prisma.onlineOrder.findUnique({
      where: { orderNumber }
    });

    if (existingOrder) {
      console.log(`📦 Order ${orderNumber} already exists, updating payment status`);
      
      // Update payment status if needed
      if (existingOrder.paymentStatus !== 'completed') {
        await prisma.onlineOrder.update({
          where: { orderNumber },
          data: {
            paymentStatus: 'completed',
            paymentId: payload.id,
          }
        });
        console.log(`✅ Updated payment status for order ${orderNumber}`);
      }
    } else {
      console.log(`⚠️ Order ${orderNumber} not found in database`);
      // Note: Order creation from webhook is complex and should be handled by the order service
    }
  } catch (error) {
    console.error('Error handling payment captured:', error);
  }
};

/**
 * Handle payment failed event
 */
const handlePaymentFailed = async (payload) => {
  try {
    const orderNumber = payload.notes?.orderNumber;
    
    if (!orderNumber) {
      console.error('❌ Order number not found in payment notes');
      return;
    }

    console.log(`❌ Payment failed for order ${orderNumber}: ${payload.id}`);

    // Check if order exists
    const existingOrder = await prisma.onlineOrder.findUnique({
      where: { orderNumber }
    });

    if (existingOrder) {
      // Update payment status to failed
      await prisma.onlineOrder.update({
        where: { orderNumber },
        data: {
          paymentStatus: 'failed',
          paymentId: payload.id,
        }
      });
      console.log(`✅ Updated payment status to failed for order ${orderNumber}`);
    }
  } catch (error) {
    console.error('Error handling payment failed:', error);
  }
};

/**
 * Handle Stripe webhook
 * POST /api/payment-gateway/webhook/stripe
 */
const handleStripeWebhook = async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    const webhookBody = req.body;

    // Get active Stripe gateway
    const gateway = await prisma.paymentGateway.findFirst({
      where: {
        name: 'stripe',
        isActive: true
      }
    });

    if (!gateway || !gateway.webhookSecret) {
      console.error('❌ Stripe webhook secret not configured');
      return res.status(400).json({
        success: false,
        error: 'Webhook not configured'
      });
    }

    // Note: Stripe webhook verification requires the stripe library
    // This is a placeholder for Stripe webhook handling
    console.log(`📥 Received Stripe webhook`);

    res.json({ success: true });
  } catch (error) {
    console.error('Error handling Stripe webhook:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process webhook',
      message: error.message
    });
  }
};

module.exports = {
  handleRazorpayWebhook,
  handleStripeWebhook,
};


/**
 * Verify Razorpay payment signature
 * POST /api/online/payment/verify
 */
const verifyRazorpayPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        error: 'Missing required payment verification parameters',
      });
    }

    // Get active Razorpay gateway
    const gateway = await prisma.paymentGateway.findFirst({
      where: {
        name: 'razorpay',
        isActive: true,
      },
    });

    if (!gateway || !gateway.secretKey) {
      console.error('❌ Razorpay gateway not configured');
      return res.status(400).json({
        success: false,
        error: 'Payment gateway not configured',
      });
    }

    // Verify signature
    const text = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac('sha256', gateway.secretKey)
      .update(text)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      console.error('❌ Payment signature verification failed');
      return res.status(400).json({
        success: false,
        error: 'Invalid payment signature',
      });
    }

    console.log(`✅ Payment verified: ${razorpay_payment_id}`);

    res.json({
      success: true,
      message: 'Payment verified successfully',
      data: {
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
      },
    });
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify payment',
      message: error.message,
    });
  }
};

module.exports = {
  handleRazorpayWebhook,
  handleStripeWebhook,
  verifyRazorpayPayment,
};
