const express = require("express");
const router = express.Router();
const {
  getAllExpenses,
  getExpenseById,
  getNextExpenseNumber,
  createExpense,
  updateExpense,
  getExpenseStats,
  getExpensesByCategory,
} = require("../../controllers/purchase/expenseController");
const { upload } = require("../../utils/purchase/uploadsS3");

// Get all expenses
router.get("/", getAllExpenses);

// Get expense statistics
router.get("/stats", getExpenseStats);

// Get next expense number
router.get("/next-number", getNextExpenseNumber);

// Get expenses by category
router.get("/category/:categoryId", getExpensesByCategory);

// Get expense by ID
router.get("/:id", getExpenseById);

// Create expense (with receipt upload)
router.post("/", upload.single("receipt"), createExpense);

// Update expense (with receipt upload)
router.put("/:id", upload.single("receipt"), updateExpense);

module.exports = router;
