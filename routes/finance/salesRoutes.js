const express = require("express");
const router = express.Router();
const {
  getAllSales,
  getSalesSummary,
  getSalesByFinancialYear,
  getOrderDetails,
} = require("../../controllers/finance/salesController");

// Sales routes
router.get("/", getAllSales);
router.get("/summary", getSalesSummary);
router.get("/by-year", getSalesByFinancialYear);
router.get("/:type/:id", getOrderDetails);

module.exports = router;
