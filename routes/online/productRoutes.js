const express = require("express");
const router = express.Router();
const {
  getProducts,
  getProductById,
} = require("../../controllers/online/productController");

// Get all products (inventory products synced for online use)
router.get("/", getProducts);

// Get product by ID
router.get("/:id", getProductById);

module.exports = router;
