const express = require("express");
const router = express.Router();
const {
  createCateringServiceEnquiry,
  getAllCateringServiceEnquiries,
  getCateringServiceEnquiryById,
  updateCateringServiceEnquiryStatus,
  deleteCateringServiceEnquiry,
} = require("../../controllers/enquiry/cateringServiceEnquiryController");

// Public route - no authentication required
router.post("/", createCateringServiceEnquiry);

// Admin routes - authentication required
router.get("/", getAllCateringServiceEnquiries);
router.get("/:id", getCateringServiceEnquiryById);
router.patch("/:id", updateCateringServiceEnquiryStatus);
router.delete("/:id", deleteCateringServiceEnquiry);

module.exports = router;
