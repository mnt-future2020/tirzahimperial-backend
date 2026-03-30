const express = require("express");
const router = express.Router();
const { getMyOrders, getOrderByNumber, downloadOrderInvoice } = require("../../controllers/order/myOrdersController");
const { rateDeliveryPartner } = require("../../controllers/order/ratingController");
const { authenticateToken } = require("../../middleware/auth");

/**
 * @route   GET /api/online/my-orders
 * @desc    Get all orders for a user
 * @access  Public
 */
router.get("/", getMyOrders);

/**
 * @route   GET /api/online/my-orders/:orderNumber/invoice/download
 * @desc    Download order invoice PDF
 * @access  Public
 */
router.get("/:orderNumber/invoice/download", downloadOrderInvoice);

/**
 * @route   POST /api/online/my-orders/:orderId/rate-partner
 * @desc    Rate delivery partner for an order
 * @access  Private (requires authentication)
 */
router.post("/:orderId/rate-partner", authenticateToken, rateDeliveryPartner);

/**
 * @route   GET /api/online/my-orders/:orderNumber
 * @desc    Get single order by order number
 * @access  Public
 */
router.get("/:orderNumber", getOrderByNumber);

module.exports = router;
