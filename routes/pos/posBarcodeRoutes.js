const express = require('express');
const router = express.Router();
const {
  generateBarcode,
  validateBarcodeEndpoint,
} = require('../../controllers/pos/posBarcodeController');

// Generate unique barcode for POS products
router.post('/generate', generateBarcode);

// Validate barcode for POS products
router.post('/validate', validateBarcodeEndpoint);

module.exports = router;
