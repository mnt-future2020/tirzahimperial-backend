const express = require("express");
const router = express.Router();
const posInvoiceController = require("../../controllers/pos/posInvoiceController");

// Generate invoice number
router.post("/generate-invoice-number", posInvoiceController.generatePOSInvoiceNumber);
router.get("/generate-invoice-number", posInvoiceController.generatePOSInvoiceNumber);

// Get invoice settings
router.get("/settings", posInvoiceController.getInvoiceSettings);

// Get invoice details by order number
router.get("/details/:orderNumber", posInvoiceController.getInvoiceDetails);

// Download invoice PDF
router.get("/download/:orderNumber", posInvoiceController.downloadInvoicePDF);

// Preview invoice PDF
router.get("/preview/:orderNumber", posInvoiceController.previewInvoicePDF);

module.exports = router;
