const express = require('express');
const router = express.Router();
const {
  getAllOrders,
  getOrderById,
  updateOrderStatus,
  getOrderStats,
  downloadOrderInvoice,
  updateCourierTracking,
} = require('../../controllers/order/adminOrderController');

// Get order statistics
router.get('/stats', getOrderStats);

// Download order invoice PDF (must be before /:id route)
router.get('/:orderNumber/invoice/download', downloadOrderInvoice);

// Get all orders with filters
router.get('/', getAllOrders);

// Get single order by ID
router.get('/:id', getOrderById);

// Update order status
router.patch('/:id/status', updateOrderStatus);

// Update courier tracking information
router.patch('/:id/courier-tracking', updateCourierTracking);

module.exports = router;
