const express = require("express");
const router = express.Router();
const {
  createBulkOrderEnquiry,
  getAllBulkOrderEnquiries,
  getBulkOrderEnquiryById,
  updateBulkOrderEnquiryStatus,
  deleteBulkOrderEnquiry,
} = require("../../controllers/enquiry/bulkOrderEnquiryController");

// Public route - no authentication required
router.post("/", createBulkOrderEnquiry);

// Admin routes - authentication required
router.get("/", getAllBulkOrderEnquiries);
router.get("/:id", getBulkOrderEnquiryById);
router.patch("/:id", updateBulkOrderEnquiryStatus);
router.delete("/:id", deleteBulkOrderEnquiry);

module.exports = router;
