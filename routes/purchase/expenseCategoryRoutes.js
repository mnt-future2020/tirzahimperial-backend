const express = require("express");
const router = express.Router();
const {
  getAllExpenseCategories,
  getExpenseCategoryById,
  createExpenseCategory,
  updateExpenseCategory,
  deleteExpenseCategory,
  getExpenseCategoryNames,
} = require("../../controllers/purchase/expenseCategoryController");

// Get all expense categories
router.get("/", getAllExpenseCategories);

// Get expense category names (for dropdowns)
router.get("/names", getExpenseCategoryNames);

// Get expense category by ID
router.get("/:id", getExpenseCategoryById);

// Create expense category
router.post("/", createExpenseCategory);

// Update expense category
router.put("/:id", updateExpenseCategory);

// Delete expense category
router.delete("/:id", deleteExpenseCategory);

module.exports = router;
