const express = require("express");
const router = express.Router();
const { authenticateToken, requireRole } = require("../../middleware/auth");
const {
  listAdminReviews,
  updateReviewStatus,
} = require("../../controllers/online/productReviewAdminController");

router.get("/", authenticateToken, requireRole("admin"), listAdminReviews);
router.patch("/:id/status", authenticateToken, requireRole("admin"), updateReviewStatus);

module.exports = router;
