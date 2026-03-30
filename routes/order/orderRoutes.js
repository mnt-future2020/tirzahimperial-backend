const express = require("express");
const router = express.Router();
const { createOrder, confirmOrder } = require("../../controllers/order/orderController");
const { checkCODAvailability } = require("../../controllers/online/codCheckController");

/**
 * @route   POST /api/online/orders
 * @desc    Create new order (COD or prepare for online payment)
 * @access  Public
 */
router.post("/", createOrder);

/**
 * @route   POST /api/online/orders/confirm
 * @desc    Confirm order after payment verification
 * @access  Public
 */
router.post("/confirm", confirmOrder);

/**
 * @route   GET /api/online/orders/check-cod-availability
 * @desc    Check if COD is available for cart items
 * @access  Public
 */
router.get("/check-cod-availability", checkCODAvailability);

module.exports = router;
