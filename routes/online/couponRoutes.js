const express = require("express");
const router = express.Router();
const couponController = require("../../controllers/online/couponController");

// Create a new coupon
router.post("/", couponController.createCoupon);

// Get all coupons
router.get("/", couponController.getAllCoupons);

// Validate coupon
router.post("/validate", couponController.validateCoupon);

// Get available coupons for user (must be before /:id route)
router.get("/available", couponController.getAvailableCoupons);

// Get promotional coupons for header display (must be before /:id route)
router.get("/promotional", couponController.getPromotionalCoupons);

// Apply coupon (record usage)
router.post("/apply", couponController.applyCoupon);

// Get coupon statistics (must be before /:id route)
router.get("/:id/stats", couponController.getCouponStats);

// Get coupon by ID
router.get("/:id", couponController.getCouponById);

// Update coupon
router.put("/:id", couponController.updateCoupon);

// Delete coupon
router.delete("/:id", couponController.deleteCoupon);

module.exports = router;
