const express = require("express");
const router = express.Router();
const {
  getProcessingPool,
  getProcessingPoolItem,
  getProcessingRecipe,
} = require("../../controllers/inventory/processingPoolController");
const {
  createProcessingTransaction,
  getProcessingTransactions,
  getProcessingTransaction,
} = require("../../controllers/inventory/processingTransactionController");

// Processing Pool Routes
router.get("/processing-pool", getProcessingPool);
router.get("/processing-pool/:id", getProcessingPoolItem);
router.get("/processing-pool/:poolId/recipe", getProcessingRecipe);

// Processing Transaction Routes
router.post("/processing-transactions", createProcessingTransaction);
router.get("/processing-transactions", getProcessingTransactions);
router.get("/processing-transactions/:id", getProcessingTransaction);

module.exports = router;
