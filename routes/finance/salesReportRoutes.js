const express = require("express");
const router = express.Router();
const {
  // getSalesSummaryReport,
  // getPosSalesReport,
  getOnlineSalesReport,
} = require("../../controllers/finance/salesReportController");

// Sales report routes
// router.get("/sales-summary", getSalesSummaryReport); // combined summary includes POS data; disabled for current scope
// router.get("/pos-sales", getPosSalesReport); // POS report disabled for cosmetics ecommerce scope
router.get("/online-sales", getOnlineSalesReport);

module.exports = router;
