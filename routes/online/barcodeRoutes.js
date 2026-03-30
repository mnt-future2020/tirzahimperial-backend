const express = require('express');
const {
  generateBarcode,
  validateBarcodeEndpoint,
} = require('../../controllers/online/barcodeController');

const router = express.Router();

// Barcode routes
router.post('/generate', generateBarcode);
router.post('/validate', validateBarcodeEndpoint);

module.exports = router;
