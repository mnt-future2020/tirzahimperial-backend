const express = require("express");
const router = express.Router();
const posOrderController = require("../../controllers/pos/posOrderController");

// Create POS order
router.post("/", posOrderController.createPOSOrder);

// Get all POS orders with filters
router.get("/", posOrderController.getPOSOrders);

// Get POS order statistics (must be before /:id to avoid route conflict)
router.get("/stats/summary", posOrderController.getPOSOrderStats);

// Get POS orders by date range
router.get("/date-range", posOrderController.getPOSOrdersByDateRange);

// Get POS order by order number
router.get("/order-number/:orderNumber", posOrderController.getPOSOrderByOrderNumber);

// Get single POS order by ID
router.get("/:id", posOrderController.getPOSOrderById);

// Customer routes for POS
router.get("/customers/search", posOrderController.searchCustomers);
router.get("/customers/:id", posOrderController.getCustomerById);

module.exports = router;
