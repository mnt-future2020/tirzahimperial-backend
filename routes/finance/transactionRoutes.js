const express = require("express");
const router = express.Router();
const {
  getAllTransactions,
  getTransactionById,
} = require("../../controllers/finance/transactionController");

// Transaction routes
router.get("/", getAllTransactions);
router.get("/:transactionId", getTransactionById);

module.exports = router;
