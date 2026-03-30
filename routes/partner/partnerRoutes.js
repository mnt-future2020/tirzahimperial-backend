const express = require("express");
const router = express.Router();
const {
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
} = require("../../controllers/partner/partnerAuthController");
const {
  getAssignedDeliveries,
  getDeliveryDetails,
  updateDeliveryStatus,
  updatePartnerLocation,
  getPartnerStats,
  getNewRequests,
  getPartnerNotifications,
  markNotificationRead,
  toggleAvailability,
  getAvailablePartners,
  assignDeliveryPartner,
} = require("../../controllers/partner/deliveryController");
const {
  getPartnerReports,
} = require("../../controllers/partner/partnerReportsController");
const { authenticateToken } = require("../../middleware/auth");

// Public routes
router.post("/auth/login", partnerLogin);
router.post("/auth/register", partnerRegister);
router.post("/auth/verify-email", verifyPartnerEmail);
router.post("/auth/verify-otp", verifyOTP);
router.post("/auth/resend-otp", resendOTP);
router.post("/auth/forgot-password", requestPasswordReset);
router.post("/auth/reset-password", resetPassword);

// Protected routes - Partner APIs
router.get("/auth/profile", authenticateToken, getPartnerProfile);
router.put("/auth/profile", authenticateToken, updatePartnerProfile);
router.put("/auth/change-password", authenticateToken, changePartnerPassword);

// Delivery APIs
router.get("/deliveries", authenticateToken, getAssignedDeliveries);
router.get("/deliveries/new-requests", authenticateToken, getNewRequests);
router.get("/deliveries/:id", authenticateToken, getDeliveryDetails);
router.put("/deliveries/:id/status", authenticateToken, updateDeliveryStatus);
router.put("/location", authenticateToken, updatePartnerLocation);

// Stats
router.get("/stats", authenticateToken, getPartnerStats);

// Reports & Analytics
router.get("/reports", authenticateToken, getPartnerReports);

// Notifications
router.get("/notifications", authenticateToken, getPartnerNotifications);
router.put("/notifications/:id/read", authenticateToken, markNotificationRead);

// Availability
router.put("/availability", authenticateToken, toggleAvailability);

// Admin routes - Get available partners
router.get("/available", authenticateToken, getAvailablePartners);

// Admin routes - Assign delivery partner to order
router.put("/assign/:orderId", authenticateToken, assignDeliveryPartner);

module.exports = router;
