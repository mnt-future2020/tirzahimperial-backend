const express = require("express");
const router = express.Router();
const {
  getAllBills,
  getBillById,
  getNextGRNNumber,
  createBill,
  updateBill,
  updatePaymentStatus,
  getBillStats,
  getBillsBySupplier,
  getBillsByWarehouse,
  getBillsByPurchaseOrder,
} = require("../../controllers/purchase/billController");
const { upload } = require("../../utils/purchase/uploadsS3");

// Get all bills
router.get("/", getAllBills);

// Get bill statistics
router.get("/stats", getBillStats);

// Get next GRN number
router.get("/next-grn-number", getNextGRNNumber);

// Get bills by supplier
router.get("/supplier/:supplierId", getBillsBySupplier);

// Get bills by warehouse
router.get("/warehouse/:warehouseId", getBillsByWarehouse);

// Get bills by purchase order
router.get("/purchase-order/:poId", getBillsByPurchaseOrder);

// Get bill by ID
router.get("/:id", getBillById);

// Create bill (with invoice copy upload)
router.post("/", upload.single("invoiceCopy"), createBill);

// Update bill (with invoice copy upload)
router.put("/:id", upload.single("invoiceCopy"), updateBill);

// Update payment status
router.patch("/:id/payment-status", updatePaymentStatus);

module.exports = router;
