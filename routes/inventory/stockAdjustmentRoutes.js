const express = require("express");
const router = express.Router();
const {
  getAllStockAdjustments,
  getStockAdjustmentById,
  createStockAdjustment,
  getItemAdjustmentHistory,
  getAdjustmentSummary,
} = require("../../controllers/inventory/stockAdjustmentController");

// Stock adjustment routes
router.get("/", getAllStockAdjustments);
router.get("/summary", getAdjustmentSummary);
router.get("/:id", getStockAdjustmentById);
router.get("/item/:itemId/history", getItemAdjustmentHistory);
router.post("/", createStockAdjustment);

module.exports = router;
