const express = require("express");
const router = express.Router();
const {
  getAllPurchaseOrders,
  getPurchaseOrderById,
  getNextPONumber,
  createPurchaseOrder,
  updatePurchaseOrder,
  deletePurchaseOrder,
  getPurchaseOrderStats,
} = require("../../controllers/purchase/purchaseOrderController");

// Get all purchase orders
router.get("/", getAllPurchaseOrders);

// Get purchase order statistics
router.get("/stats", getPurchaseOrderStats);

// Get next PO number
router.get("/next-number", getNextPONumber);

// Get purchase order by ID
router.get("/:id", getPurchaseOrderById);

// Create purchase order
router.post("/", createPurchaseOrder);

// Update purchase order
router.put("/:id", updatePurchaseOrder);

// Delete purchase order (disabled)
router.delete("/:id", deletePurchaseOrder);

module.exports = router;
