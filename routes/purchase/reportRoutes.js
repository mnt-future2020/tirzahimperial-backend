const express = require("express");
const router = express.Router();
const {
  getPurchaseSummaryReport,
  exportPurchaseSummaryExcel,
  getBillsSummaryReport,
  exportBillsSummaryExcel,
  getExpensesSummaryReport,
  exportExpensesSummaryExcel,
} = require("../../controllers/purchase/reportController");

// Purchase Summary Report
router.get("/purchase-summary", getPurchaseSummaryReport);
router.get("/purchase-summary/export", exportPurchaseSummaryExcel);

// Bills Summary Report
router.get("/bills-summary", getBillsSummaryReport);
router.get("/bills-summary/export", exportBillsSummaryExcel);

// Expenses Summary Report
router.get("/expenses-summary", getExpensesSummaryReport);
router.get("/expenses-summary/export", exportExpensesSummaryExcel);

module.exports = router;
