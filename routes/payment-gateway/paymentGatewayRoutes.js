const express = require("express");
const router = express.Router();
const {
  getGateways,
  updateGateway,
  toggleGateway,
  getActiveGateways,
} = require("../../controllers/payment-gateway/paymentGatewayController");
const {
  handleRazorpayWebhook,
  handleStripeWebhook,
  verifyRazorpayPayment,
} = require("../../controllers/payment-gateway/webhookController");

// Get all payment gateways (admin)
router.get("/", getGateways);

// Get active payment gateways (public - for checkout)
router.get("/active", getActiveGateways);

// Update payment gateway configuration (admin)
router.put("/:gatewayName", updateGateway);

// Toggle payment gateway active status (admin)
router.put("/:gatewayName/toggle", toggleGateway);

// Payment verification endpoint (public - for frontend after payment)
router.post("/verify", verifyRazorpayPayment);

// Webhook endpoints (public - for payment providers)
router.post("/webhook/razorpay", handleRazorpayWebhook);
router.post("/webhook/stripe", handleStripeWebhook);

module.exports = router;
