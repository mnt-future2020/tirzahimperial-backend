const express = require('express');
const { upload } = require('../../utils/online/uploadS3');
const {
  getAllOnlineProducts,
  getOnlineProductById,
  createOnlineProduct,
  updateOnlineProduct,
  deleteOnlineProduct,
  getFrequentlyBoughtTogether,
  syncProductStock,
  syncAllComboStock,
} = require('../../controllers/online/onlineProductController');

const router = express.Router();

// Online Product CRUD routes
router.get('/', getAllOnlineProducts);
router.get('/:id', getOnlineProductById);
router.get('/:id/frequently-bought-together', getFrequentlyBoughtTogether);
router.post('/', upload.any(), createOnlineProduct);
router.put('/:id', upload.any(), updateOnlineProduct);
router.delete('/:id', deleteOnlineProduct);

// Manual stock sync endpoint
router.post('/:id/sync-stock', syncProductStock);

// Sync all combo products stock
router.post('/sync-all-combo-stock', syncAllComboStock);

// SEO generation route
router.post('/generate-seo', require('../../controllers/online/onlineProductController').generateProductSEO);

module.exports = router;
