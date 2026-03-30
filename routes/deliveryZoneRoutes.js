const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  createDeliveryZone,
  getAllDeliveryZones,
  updateDeliveryZone,
  deleteDeliveryZone,
  getAvailableCountries,
  checkPincode,
  discoverPincodesAI,
  detectLocation,
} = require('../controllers/deliveryZoneController');

// Public routes
router.get('/countries', getAvailableCountries);
router.get('/check/:pincode', checkPincode);
router.post('/detect-location', detectLocation);

// Admin routes (protected)
router.post('/', authenticateToken, requireRole('admin'), createDeliveryZone);
router.get('/', authenticateToken, requireRole('admin'), getAllDeliveryZones);
router.put('/:id', authenticateToken, requireRole('admin'), updateDeliveryZone);
router.post('/discover-ai', authenticateToken, requireRole('admin'), discoverPincodesAI);
router.delete('/:id', authenticateToken, requireRole('admin'), deleteDeliveryZone);

module.exports = router;
