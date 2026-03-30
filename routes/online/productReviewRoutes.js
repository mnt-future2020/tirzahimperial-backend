const express = require("express");
const router = express.Router();
const { authenticateToken, optionalAuth } = require("../../middleware/auth");
const { upload } = require("../../utils/online/uploadS3");
const {
  listProductReviews,
  createProductReview,
} = require("../../controllers/online/productReviewController");

// Public list (optional auth for canReview)
router.get("/product/:productId", optionalAuth, listProductReviews);

// Create review (user only)
router.post("/", authenticateToken, upload.array("images", 5), createProductReview);

module.exports = router;
