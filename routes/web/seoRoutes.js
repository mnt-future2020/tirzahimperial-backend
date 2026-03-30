const express = require("express");
const router = express.Router();
const { upload } = require("../../utils/web/uploadsS3");
const {
  getAllPageSEO,
  getPageSEOByPath,
  savePageSEO,
  deletePageSEO,
  generatePageSEO,
} = require("../../controllers/web/pageSEOController");

// Get all page SEO settings
router.get("/", getAllPageSEO);

// Get single page SEO by path (encoded)
router.get("/page/:path", getPageSEOByPath);

// Generate SEO using Groq AI
router.post("/generate", generatePageSEO);

// Create or update page SEO (with optional OG image upload)
router.post("/", upload.single("ogImage"), savePageSEO);

// Delete page SEO
router.delete("/:id", deletePageSEO);

module.exports = router;
