const { prisma } = require("../../config/database");

/**
 * Get all brands
 * GET /api/online/brands
 */
const getAllBrands = async (req, res) => {
  try {
    const brands = await prisma.brand.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
      },
    });

    res.json({
      success: true,
      data: brands,
    });
  } catch (error) {
    console.error("Error fetching brands:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch brands",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

/**
 * Create brand
 * POST /api/online/brands
 */
const createBrand = async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Brand name is required",
      });
    }

    // Check if brand already exists
    const existingBrand = await prisma.brand.findUnique({
      where: { name: name.trim() },
    });

    if (existingBrand) {
      return res.status(400).json({
        success: false,
        message: "Brand already exists",
      });
    }

    const brand = await prisma.brand.create({
      data: {
        name: name.trim(),
      },
    });

    res.status(201).json({
      success: true,
      message: "Brand created successfully",
      data: brand,
    });
  } catch (error) {
    console.error("Error creating brand:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create brand",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

/**
 * Update brand
 * PUT /api/online/brands/:id
 */
const updateBrand = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Brand name is required",
      });
    }

    // Check if another brand with same name exists
    const existingBrand = await prisma.brand.findFirst({
      where: {
        name: name.trim(),
        id: { not: id },
      },
    });

    if (existingBrand) {
      return res.status(400).json({
        success: false,
        message: "Brand name already exists",
      });
    }

    const brand = await prisma.brand.update({
      where: { id },
      data: { name: name.trim() },
    });

    res.json({
      success: true,
      message: "Brand updated successfully",
      data: brand,
    });
  } catch (error) {
    console.error("Error updating brand:", error);
    
    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: "Brand not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to update brand",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

/**
 * Delete brand
 * DELETE /api/online/brands/:id
 */
const deleteBrand = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if brand is used in any products
    const productsUsingBrand = await prisma.onlineProduct.count({
      where: {
        brand: {
          equals: (await prisma.brand.findUnique({ where: { id } }))?.name,
        },
      },
    });

    if (productsUsingBrand > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete brand. It is used in ${productsUsingBrand} product(s)`,
      });
    }

    await prisma.brand.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: "Brand deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting brand:", error);
    
    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: "Brand not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to delete brand",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

module.exports = {
  getAllBrands,
  createBrand,
  updateBrand,
  deleteBrand,
};
