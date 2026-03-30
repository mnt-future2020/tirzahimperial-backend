const express = require("express");
const router = express.Router();
const {
  getInvoiceSettings,
  updateInvoiceSettings,
  generateInvoiceNumber,
} = require("../../controllers/finance/invoiceSettingsController");

// Invoice settings routes
router.get("/", getInvoiceSettings);
router.put("/", updateInvoiceSettings);
router.post("/generate-number", generateInvoiceNumber);

module.exports = router;
