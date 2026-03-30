const express = require("express");
const router = express.Router();
const {
  getOrderSchedule,
  updateOrderSchedule,
  getPublicOrderSchedule,
} = require("../../controllers/settings/orderScheduleController");
const { authenticateToken } = require("../../middleware/auth");

// Public route — no auth needed (used by frontend/mobile)
router.get("/active", getPublicOrderSchedule);

// Admin routes — auth required
router.get("/", authenticateToken, getOrderSchedule);
router.put("/", authenticateToken, updateOrderSchedule);

module.exports = router;
