const { prisma } = require("../../../config/database");
const { getPresignedUrl } = require("../../../utils/online/uploadS3");

/**
 * Get all categories for frontend display
 * GET /api/online/frontend/categories
 */
const getCategories = async (req, res) => {
  try {
    console.log("[Frontend Categories] Fetching all active categories");

    // Fetch only active categories with active subcategories
    // Filter: Only show categories that have BOTH name AND image
    const categories = await prisma.category.findMany({
      where: {
        isActive: true,
        image: { not: null }, // Must have image
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
      orderBy: {
        sortOrder: "asc",
      },
    });

    console.log(`[Frontend Categories] Found ${categories.length} active categories with images`);

    // Generate pre-signed URLs for images
    const categoriesWithUrls = await Promise.all(
      categories.map(async (category) => ({
        id: category.id,
        name: category.name,
        image: category.image ? getPresignedUrl(category.image, 3600) : null,
        metaTitle: category.metaTitle,
        metaDescription: category.metaDescription,
        metaKeywords: category.metaKeywords,
        subcategories: await Promise.all(
          category.subcategories.map(async (sub) => ({
            id: sub.id,
            name: sub.name,
            image: sub.image ? getPresignedUrl(sub.image, 3600) : null,
            metaTitle: sub.metaTitle,
            metaDescription: sub.metaDescription,
            metaKeywords: sub.metaKeywords,
          }))
        ),
      }))
    );

    res.json({
      success: true,
      data: categoriesWithUrls,
    });
  } catch (error) {
    console.error("[Frontend Categories] Error fetching categories:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch categories",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

/**
 * Get category by name or ID
 * GET /api/online/frontend/categories/:identifier
 */
const getCategoryByIdentifier = async (req, res) => {
  try {
    const { identifier } = req.params;

    console.log(`[Frontend Categories] Fetching category: ${identifier}`);

    // Check if identifier is ObjectId format
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(identifier);

    let category;
    if (isObjectId) {
      // Fetch by ID
      category = await prisma.category.findUnique({
        where: {
          id: identifier,
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
      category = await prisma.category.findFirst({
        where: {
          name: { equals: decodeURIComponent(identifier), mode: "insensitive" },
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

    if (!category) {
      console.log(`[Frontend Categories] Category not found: ${identifier}`);
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    // Generate pre-signed URLs
    const categoryWithUrls = {
      id: category.id,
      name: category.name,
      image: category.image ? getPresignedUrl(category.image, 3600) : null,
      metaTitle: category.metaTitle,
      metaDescription: category.metaDescription,
      metaKeywords: category.metaKeywords,
      subcategories: await Promise.all(
        category.subcategories.map(async (sub) => ({
          id: sub.id,
          name: sub.name,
          image: sub.image ? getPresignedUrl(sub.image, 3600) : null,
          metaTitle: sub.metaTitle,
          metaDescription: sub.metaDescription,
          metaKeywords: sub.metaKeywords,
        }))
      ),
    };

    console.log(`[Frontend Categories] Category fetched successfully: ${identifier}`);

    res.json({
      success: true,
      data: categoryWithUrls,
    });
  } catch (error) {
    console.error("[Frontend Categories] Error fetching category:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch category",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

module.exports = {
  getCategories,
  getCategoryByIdentifier,
};
