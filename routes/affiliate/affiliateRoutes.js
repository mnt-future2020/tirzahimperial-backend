const express = require("express");
const router = express.Router();
const {
  applyAffiliate,
  listApplications,
  approveApplication,
  rejectApplication,
  getAffiliateMe,
  requestWithdrawal,
} = require("../../controllers/affiliate/affiliateController");
const {
  listAffiliates,
  getAffiliateDetail,
  updateAffiliate,
  setAffiliateStatus,
  expireAffiliateCode,
  listWithdrawalRequests,
  approveWithdrawalRequest,
  rejectWithdrawalRequest,
} = require("../../controllers/affiliate/affiliateAdminController");
const { authenticateToken, requireRole } = require("../../middleware/auth");

// Public application submission
router.post("/apply", applyAffiliate);

// Authenticated affiliate view
router.get("/me", authenticateToken, getAffiliateMe);
router.post("/withdraw", authenticateToken, requestWithdrawal);

// Admin review
router.get("/admin/applications", authenticateToken, requireRole("admin"), listApplications);
router.post("/admin/applications/:id/approve", authenticateToken, requireRole("admin"), approveApplication);
router.post("/admin/applications/:id/reject", authenticateToken, requireRole("admin"), rejectApplication);
router.get("/admin/affiliates", authenticateToken, requireRole("admin"), listAffiliates);
router.get("/admin/affiliates/:id", authenticateToken, requireRole("admin"), getAffiliateDetail);
router.patch("/admin/affiliates/:id", authenticateToken, requireRole("admin"), updateAffiliate);
router.post("/admin/affiliates/:id/status", authenticateToken, requireRole("admin"), setAffiliateStatus);
router.post("/admin/affiliates/:id/expire-code", authenticateToken, requireRole("admin"), expireAffiliateCode);
router.get("/admin/withdrawals", authenticateToken, requireRole("admin"), listWithdrawalRequests);
router.post("/admin/withdrawals/:id/approve", authenticateToken, requireRole("admin"), approveWithdrawalRequest);
router.post("/admin/withdrawals/:id/reject", authenticateToken, requireRole("admin"), rejectWithdrawalRequest);

module.exports = router;
