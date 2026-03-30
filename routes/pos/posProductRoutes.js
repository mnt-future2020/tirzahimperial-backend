const express = require('express');
const {
  getAllPOSProducts,
  getPOSProductById,
  createPOSProduct,
  updatePOSProduct,
  togglePOSProductDisplay,
  syncPOSProductFromItem,
  deletePOSProduct,
} = require('../../controllers/pos/posProductController');
const { upload } = require('../../utils/pos/uploadS3');

const router = express.Router();

// Get all POS products
router.get('/', getAllPOSProducts);

// Get POS product by ID
router.get('/:id', getPOSProductById);

// Create POS product from inventory item
router.post('/', createPOSProduct);

// Update POS product (with optional image upload)
router.put('/:id', upload.single('itemImage'), updatePOSProduct);

// Toggle POS product display status
router.patch('/:id/display', togglePOSProductDisplay);

// Sync POS product from inventory item
router.post('/:id/sync', syncPOSProductFromItem);

// Delete POS product
router.delete('/:id', deletePOSProduct);

module.exports = router;
