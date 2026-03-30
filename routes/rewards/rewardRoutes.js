const express = require("express");
const router = express.Router();
const { authenticateToken, requireRole } = require("../../middleware/auth");
const {
  getPublicRewardSettings,
  getAdminRewardSettings,
  updateAdminRewardSettings,
} = require("../../controllers/rewards/rewardSettingsController");
const {
  listRewardWallets,
  getRewardWalletByUser,
  adjustRewardBalance,
  getRewardStats,
} = require("../../controllers/rewards/rewardAdminController");
const { getMyRewards } = require("../../controllers/rewards/rewardUserController");

// Public settings
router.get("/public", getPublicRewardSettings);

// User
router.get("/me", authenticateToken, getMyRewards);

// Admin
router.get("/admin/settings", authenticateToken, requireRole("admin"), getAdminRewardSettings);
router.put("/admin/settings", authenticateToken, requireRole("admin"), updateAdminRewardSettings);
router.get("/admin/stats", authenticateToken, requireRole("admin"), getRewardStats);
router.get("/admin/wallets", authenticateToken, requireRole("admin"), listRewardWallets);
router.get("/admin/wallets/:userId", authenticateToken, requireRole("admin"), getRewardWalletByUser);
router.post("/admin/adjust", authenticateToken, requireRole("admin"), adjustRewardBalance);

module.exports = router;
