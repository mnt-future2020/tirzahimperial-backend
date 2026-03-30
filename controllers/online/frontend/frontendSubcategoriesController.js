const { prisma } = require("../../../config/database");
const { getPresignedUrl } = require("../../../utils/online/uploadS3");

/**
 * Get subcategories by category ID or name
 * GET /api/online/frontend/subcategories?category=:categoryIdentifier
 */
const getSubcategoriesByCategory = async (req, res) => {
  try {
    const { category } = req.query;

    if (!category) {
      return res.status(400).json({
        success: false,
        message: "Category parameter is required",
      });
    }

    console.log(`[Frontend Subcategories] Fetching subcategories for category: ${category}`);

    // Check if category is ObjectId format
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(category);

    let categoryData;
    if (isObjectId) {
      // Fetch by ID
      categoryData = await prisma.category.findUnique({
        where: {
          id: category,
          isActive: true,
        },
        include: {
          subcategories: {
            where: {
              isActive: true,
            },
            orderBy: {
              name: "asc",
            },
          },
        },
      });
    } else {
      // Fetch by name
      categoryData = await prisma.category.findFirst({
        where: {
          name: { equals: decodeURIComponent(category), mode: "insensitive" },
          isActive: true,
        },
        include: {
          subcategories: {
            where: {
              isActive: true,
            },
            orderBy: {
              name: "asc",
            },
          },
        },
      });
    }

    if (!categoryData) {
      console.log(`[Frontend Subcategories] Category not found: ${category}`);
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    console.log(`[Frontend Subcategories] Found ${categoryData.subcategories.length} subcategories`);

    // Generate pre-signed URLs for subcategory images
    const subcategoriesWithUrls = await Promise.all(
      categoryData.subcategories.map(async (sub) => ({
        id: sub.id,
        name: sub.name,
        image: sub.image ? getPresignedUrl(sub.image, 3600) : null,
        categoryId: sub.categoryId,
        categoryName: categoryData.name,
        metaTitle: sub.metaTitle,
        metaDescription: sub.metaDescription,
        metaKeywords: sub.metaKeywords,
      }))
    );

    res.json({
      success: true,
      data: subcategoriesWithUrls,
    });
  } catch (error) {
    console.error("[Frontend Subcategories] Error fetching subcategories:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch subcategories",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

/**
 * Get subcategory by ID
 * GET /api/online/frontend/subcategories/:id
 */
const getSubcategoryById = async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`[Frontend Subcategories] Fetching subcategory: ${id}`);

    const subcategory = await prisma.subcategory.findUnique({
      where: {
        id,
        isActive: true,
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
    });

    if (!subcategory) {
      console.log(`[Frontend Subcategories] Subcategory not found: ${id}`);
      return res.status(404).json({
        success: false,
        message: "Subcategory not found",
      });
    }

    // Generate pre-signed URLs
    const subcategoryWithUrls = {
      id: subcategory.id,
      name: subcategory.name,
      image: subcategory.image ? getPresignedUrl(subcategory.image, 3600) : null,
      categoryId: subcategory.categoryId,
      categoryName: subcategory.category.name,
      categoryImage: subcategory.category.image ? getPresignedUrl(subcategory.category.image, 3600) : null,
      metaTitle: subcategory.metaTitle,
      metaDescription: subcategory.metaDescription,
      metaKeywords: subcategory.metaKeywords,
    };

    console.log(`[Frontend Subcategories] Subcategory fetched successfully: ${id}`);

    res.json({
      success: true,
      data: subcategoryWithUrls,
    });
  } catch (error) {
    console.error("[Frontend Subcategories] Error fetching subcategory:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch subcategory",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

module.exports = {
  getSubcategoriesByCategory,
  getSubcategoryById,
};
