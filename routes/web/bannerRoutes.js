const express = require("express");
const router = express.Router();
const { upload } = require("../../utils/web/uploadsS3");
const {
  getBanners,
  getBanner,
  createBanner,
  updateBanner,
  deleteBanner,
} = require("../../controllers/web/bannerController");

// Get all banners
router.get("/", getBanners);

// Get single banner
router.get("/:id", getBanner);

// Create banner (with image upload)
router.post("/", upload.single("image"), createBanner);

// Update banner (with optional image upload)
router.put("/:id", upload.single("image"), updateBanner);

// Delete banner
router.delete("/:id", deleteBanner);

module.exports = router;
