const express = require("express");
const router = express.Router();
const {
  getAllCustomers,
  getCustomerById,
  searchCustomers,
  getCustomerStats,
  getCustomerOrders,
  getCustomerAnalytics,
  getCustomerOnlineOrders,
  createCustomer,
} = require("../../controllers/customer/customerController");

// Customer routes
router.get("/customers/stats", getCustomerStats);
router.get("/customers/search", searchCustomers);
router.get("/customers/:id", getCustomerById);
router.get("/customers/:id/orders", getCustomerOrders);
router.get("/customers/:id/analytics", getCustomerAnalytics);
router.get("/customers", getAllCustomers);
router.post("/customers", createCustomer); // Create customer

// Online orders for customer
router.get("/online-orders/customer/:customerId", getCustomerOnlineOrders);

module.exports = router;
