const { prisma } = require("../../config/database");

// Get all expense categories
const getAllExpenseCategories = async (req, res) => {
  try {
    const { isActive } = req.query;

    const filter = {};
    if (isActive !== undefined) {
      filter.isActive = isActive === "true";
    }

    const categories = await prisma.expenseCategory.findMany({
      where: filter,
      orderBy: { name: "asc" },
    });

    res.status(200).json({
      success: true,
      count: categories.length,
      data: categories,
    });
  } catch (error) {
    console.error("Error fetching expense categories:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch expense categories",
      message: error.message,
    });
  }
};

// Get expense category by ID
const getExpenseCategoryById = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await prisma.expenseCategory.findUnique({
      where: { id },
      include: {
        expenses: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: "Expense category not found",
      });
    }

    res.status(200).json({
      success: true,
      data: category,
    });
  } catch (error) {
    console.error("Error fetching expense category:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch expense category",
      message: error.message,
    });
  }
};

// Create expense category
const createExpenseCategory = async (req, res) => {
  try {
    const { name, description, isActive } = req.body;

    // Validation
    if (!name) {
      return res.status(400).json({
        success: false,
        error: "Category name is required",
      });
    }

    // Check if category already exists
    const existingCategory = await prisma.expenseCategory.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
    });

    if (existingCategory) {
      return res.status(400).json({
        success: false,
        error: "Expense category with this name already exists",
      });
    }

    const category = await prisma.expenseCategory.create({
      data: {
        name,
        description: description || null,
        isActive: isActive !== undefined ? isActive : true,
      },
    });

    res.status(201).json({
      success: true,
      message: "Expense category created successfully",
      data: category,
    });
  } catch (error) {
    console.error("Error creating expense category:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create expense category",
      message: error.message,
    });
  }
};

// Update expense category
const updateExpenseCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, isActive } = req.body;

    const existingCategory = await prisma.expenseCategory.findUnique({
      where: { id },
    });

    if (!existingCategory) {
      return res.status(404).json({
        success: false,
        error: "Expense category not found",
      });
    }

    // Check if new name conflicts with another category
    if (name && name !== existingCategory.name) {
      const duplicateCategory = await prisma.expenseCategory.findFirst({
        where: {
          name: { equals: name, mode: "insensitive" },
          id: { not: id },
        },
      });

      if (duplicateCategory) {
        return res.status(400).json({
          success: false,
          error: "Another expense category with this name already exists",
        });
      }
    }

    const category = await prisma.expenseCategory.update({
      where: { id },
      data: {
        name: name || existingCategory.name,
        description: description !== undefined ? description : existingCategory.description,
        isActive: isActive !== undefined ? isActive : existingCategory.isActive,
      },
    });

    res.status(200).json({
      success: true,
      message: "Expense category updated successfully",
      data: category,
    });
  } catch (error) {
    console.error("Error updating expense category:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update expense category",
      message: error.message,
    });
  }
};

// Delete expense category
const deleteExpenseCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await prisma.expenseCategory.findUnique({
      where: { id },
      include: {
        expenses: true,
      },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: "Expense category not found",
      });
    }

    // Check if category has expenses
    if (category.expenses.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Cannot delete category with existing expenses",
        message: `This category has ${category.expenses.length} expense(s). Please reassign or delete them first.`,
      });
    }

    await prisma.expenseCategory.delete({
      where: { id },
    });

    res.status(200).json({
      success: true,
      message: "Expense category deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting expense category:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete expense category",
      message: error.message,
    });
  }
};

// Get expense category names (for dropdowns)
const getExpenseCategoryNames = async (req, res) => {
  try {
    const categories = await prisma.expenseCategory.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
      },
      orderBy: { name: "asc" },
    });

    res.status(200).json({
      success: true,
      data: categories,
    });
  } catch (error) {
    console.error("Error fetching expense category names:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch expense category names",
      message: error.message,
    });
  }
};

module.exports = {
  getAllExpenseCategories,
  getExpenseCategoryById,
  createExpenseCategory,
  updateExpenseCategory,
  deleteExpenseCategory,
  getExpenseCategoryNames,
};
