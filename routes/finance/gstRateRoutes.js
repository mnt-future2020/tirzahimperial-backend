const express = require("express");
const router = express.Router();
const {
  getAllGSTRates,
  getGSTRateById,
  createGSTRate,
  updateGSTRate,
  deleteGSTRate,
  toggleGSTRateStatus,
} = require("../../controllers/finance/gstRateController");

// GST rate routes
router.get("/", getAllGSTRates);
router.get("/:id", getGSTRateById);
router.post("/", createGSTRate);
router.put("/:id", updateGSTRate);
router.patch("/:id/status", toggleGSTRateStatus);
router.delete("/:id", deleteGSTRate);

module.exports = router;
