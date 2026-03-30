const express = require("express");
const {
  getDailyMovementReport,
  getEODClosingStockReport,
  getPeriodAnalytics,
  getInventoryValuationReport,
  getStockAvailabilityReport,
  getInventoryMovementReport,
  getExpiryWastageReport,
  getTopSellingReport,
} = require("../../controllers/inventory/inventoryReportController");

const router = express.Router();

// GET /api/inventory/reports/daily-movement
router.get("/daily-movement", getDailyMovementReport);

// GET /api/inventory/reports/eod-closing-stock
router.get("/eod-closing-stock", getEODClosingStockReport);

// GET /api/inventory/reports/period-analytics
router.get("/period-analytics", getPeriodAnalytics);

// GET /api/inventory/reports/valuation
router.get("/valuation", getInventoryValuationReport);

// GET /api/inventory/reports/stock-availability
router.get("/stock-availability", getStockAvailabilityReport);

// GET /api/inventory/reports/inventory-movement
router.get("/inventory-movement", getInventoryMovementReport);

// GET /api/inventory/reports/expiry-wastage
router.get("/expiry-wastage", getExpiryWastageReport);

// GET /api/inventory/reports/top-selling
router.get("/top-selling", getTopSellingReport);

module.exports = router;
