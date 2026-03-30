const { prisma } = require("../../config/database");

// Get all categories
const getAllCategories = async (req, res) => {
  try {
    const { isActive } = req.query;

    const filter = {};
    if (isActive !== undefined) {
      filter.isActive = isActive === "true";
    }

    const categories = await prisma.inventoryCategory.findMany({
      where: filter,
      orderBy: { name: "asc" },
    });

    res.status(200).json({
      success: true,
      data: categories,
      count: categories.length,
    });
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch categories",
      message: error.message,
    });
  }
};

// Get category by ID
const getCategoryById = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await prisma.inventoryCategory.findUnique({
      where: { id },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: "Category not found",
      });
    }

    res.status(200).json({
      success: true,
      data: category,
    });
  } catch (error) {
    console.error("Error fetching category:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch category",
      message: error.message,
    });
  }
};

// Create new category
const createCategory = async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: "Category name is required",
      });
    }

    // Check if category already exists
    const existingCategory = await prisma.inventoryCategory.findUnique({
      where: { name: name.trim() },
    });

    if (existingCategory) {
      return res.status(409).json({
        success: false,
        error: "Category already exists",
      });
    }

    const category = await prisma.inventoryCategory.create({
      data: {
        name: name.trim(),
      },
    });

    res.status(201).json({
      success: true,
      message: "Category created successfully",
      data: category,
    });
  } catch (error) {
    console.error("Error creating category:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create category",
      message: error.message,
    });
  }
};

// Update category
const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, isActive } = req.body;

    const existingCategory = await prisma.inventoryCategory.findUnique({
      where: { id },
    });

    if (!existingCategory) {
      return res.status(404).json({
        success: false,
        error: "Category not found",
      });
    }

    // Check if new name already exists (excluding current category)
    if (name && name.trim() !== existingCategory.name) {
      const duplicateCategory = await prisma.inventoryCategory.findUnique({
        where: { name: name.trim() },
      });

      if (duplicateCategory) {
        return res.status(409).json({
          success: false,
          error: "Category name already exists",
        });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (isActive !== undefined) updateData.isActive = isActive;

    const category = await prisma.inventoryCategory.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json({
      success: true,
      message: "Category updated successfully",
      data: category,
    });
  } catch (error) {
    console.error("Error updating category:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update category",
      message: error.message,
    });
  }
};

// Delete category
const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const existingCategory = await prisma.inventoryCategory.findUnique({
      where: { id },
    });

    if (!existingCategory) {
      return res.status(404).json({
        success: false,
        error: "Category not found",
      });
    }

    // Check if category is being used by any items
    const itemsUsingCategory = await prisma.item.findFirst({
      where: { category: existingCategory.name },
    });

    if (itemsUsingCategory) {
      return res.status(400).json({
        success: false,
        error: "Cannot delete category that is being used by items",
      });
    }

    await prisma.inventoryCategory.delete({
      where: { id },
    });

    res.status(200).json({
      success: true,
      message: "Category deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting category:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete category",
      message: error.message,
    });
  }
};

module.exports = {
  getAllCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
};
