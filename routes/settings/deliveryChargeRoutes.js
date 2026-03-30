const express = require("express");
const router = express.Router();
const {
  getDeliveryCharge,
  createDeliveryCharge,
  updateDeliveryCharge,
  deleteDeliveryCharge,
  getActiveDeliveryCharge,
} = require("../../controllers/settings/deliveryChargeController");

// Public route - Get active delivery charge (for cart/checkout)
router.get("/active", getActiveDeliveryCharge);

// Admin routes - Protected
router.get("/", getDeliveryCharge);
router.post("/", createDeliveryCharge);
router.put("/:id", updateDeliveryCharge);
router.delete("/:id", deleteDeliveryCharge);

module.exports = router;
