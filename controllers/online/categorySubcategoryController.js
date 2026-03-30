const { prisma } = require("../../config/database");
const { uploadToS3, deleteFromS3, getPresignedUrl } = require("../../utils/online/uploadS3");
const Groq = require("groq-sdk");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Get all categories with pagination and search
const getAllCategories = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      categoryStatus = "all",
      subcategoryStatus = "all",
    } = req.query;

    console.log("Pagination params:", { page: parseInt(page), limit: parseInt(limit) });

    // Build filter conditions for categories
    const categoryWhere = {};

    // Handle search - search in both category and subcategory names
    if (search) {
      categoryWhere.OR = [
        { name: { contains: search, mode: "insensitive" } },
        {
          subcategories: {
            some: {
              name: { contains: search, mode: "insensitive" },
            },
          },
        },
      ];
    }

    if (categoryStatus !== "all") {
      categoryWhere.isActive = categoryStatus === "active";
    }

    // Build subcategory filter
    const subcategoryWhere = {};
    if (subcategoryStatus !== "all") {
      subcategoryWhere.isActive = subcategoryStatus === "active";
    }

    // Get ALL categories with their subcategories (no pagination at DB level)
    const categories = await prisma.category.findMany({
      where: categoryWhere,
      include: {
        subcategories: subcategoryStatus === "all" ? {
          orderBy: { updatedAt: "desc" }
        } : {
          where: subcategoryWhere,
          orderBy: { updatedAt: "desc" }
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    console.log("Raw categories from DB:", categories.length);

    // Transform data to match frontend expectations
    const transformedData = [];
    categories.forEach((category) => {
      console.log(`Processing category: ${category.name}, subcategories: ${category.subcategories.length}`);
      
      if (category.subcategories.length === 0) {
        // Include categories without subcategories
        transformedData.push({
          id: category.id,
          categoryName: category.name,
          subcategoryName: "",
          sortOrder: category.sortOrder,
          categoryImage: category.image,
          subcategoryImage: null,
          categoryMetaTitle: category.metaTitle,
          categoryMetaDescription: category.metaDescription,
          categoryMetaKeywords: category.metaKeywords,
          subcategoryMetaTitle: "",
          subcategoryMetaDescription: "",
          subcategoryMetaKeywords: "",
          categoryIsActive: category.isActive,
          subcategoryIsActive: false,
          createdAt: category.createdAt,
          updatedAt: category.updatedAt,
        });
      } else {
        // Category with subcategories - show category-subcategory pairs
        const filteredSubcategories = subcategoryStatus === "all" 
          ? category.subcategories 
          : category.subcategories.filter(sub => 
              subcategoryStatus === "active" ? sub.isActive : !sub.isActive
            );

        // Add category-subcategory pairs
        filteredSubcategories.forEach((subcategory) => {
          transformedData.push({
            id: `${category.id}-${subcategory.id}`,
            categoryName: category.name,
            subcategoryName: subcategory.name,
            sortOrder: category.sortOrder,
            categoryImage: category.image,
            subcategoryImage: subcategory.image,
            categoryMetaTitle: category.metaTitle,
            categoryMetaDescription: category.metaDescription,
            categoryMetaKeywords: category.metaKeywords,
            subcategoryMetaTitle: subcategory.metaTitle,
            subcategoryMetaDescription: subcategory.metaDescription,
            subcategoryMetaKeywords: subcategory.metaKeywords,
            categoryIsActive: category.isActive,
            subcategoryIsActive: subcategory.isActive,
            createdAt: category.createdAt,
            updatedAt: category.updatedAt,
          });
        });
      }
    });

    console.log("Transformed data length:", transformedData.length);

    // Calculate correct pagination
    const actualTotalCount = transformedData.length;
    const totalPages = Math.ceil(actualTotalCount / parseInt(limit));
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Apply pagination to transformed data
    const paginatedTransformedData = transformedData.slice(skip, skip + parseInt(limit));

    // Generate pre-signed URLs for images
    const dataWithPresignedUrls = await Promise.all(
      paginatedTransformedData.map((item) => ({
        ...item,
        categoryImage: item.categoryImage ? getPresignedUrl(item.categoryImage, 3600) : null,
        subcategoryImage: item.subcategoryImage ? getPresignedUrl(item.subcategoryImage, 3600) : null,
      }))
    );

    res.json({
      success: true,
      data: dataWithPresignedUrls,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.max(1, totalPages),
        totalCount: actualTotalCount,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch categories",
      error: error.message,
    });
  }
};

// Get category by name
const getCategoryByName = async (req, res) => {
  try {
    const { categoryName } = req.params;

    const category = await prisma.category.findFirst({
      where: {
        name: { equals: decodeURIComponent(categoryName), mode: "insensitive" },
      },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    res.json({
      success: true,
      data: {
        id: category.id,
        categoryName: category.name,
        subcategoryName: "",
        categoryImage: category.image ? getPresignedUrl(category.image, 3600) : null,
        subcategoryImage: null,
        categoryMetaTitle: category.metaTitle,
        categoryMetaDescription: category.metaDescription,
        categoryMetaKeywords: category.metaKeywords,
        subcategoryMetaTitle: "",
        subcategoryMetaDescription: "",
        subcategoryMetaKeywords: "",
        categoryIsActive: category.isActive,
        subcategoryIsActive: false,
        createdAt: category.createdAt,
        updatedAt: category.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error fetching category by name:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch category",
      error: error.message,
    });
  }
};

// Get category by ID
const getCategoryById = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ObjectID format (MongoDB ObjectID is 24 hex characters)
    const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id) || (id.includes("-") && id.split("-").every(part => /^[0-9a-fA-F]{24}$/.test(part)));
    
    if (!isValidObjectId) {
      return res.status(400).json({
        success: false,
        message: "Invalid category ID format",
      });
    }

    // Check if it's a combined ID (category-subcategory)
    if (id.includes("-")) {
      const [categoryId, subcategoryId] = id.split("-");

      const category = await prisma.category.findUnique({
        where: { id: categoryId },
        include: {
          subcategories: {
            where: { id: subcategoryId },
          },
        },
      });

      if (!category || category.subcategories.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Category or subcategory not found",
        });
      }

      const subcategory = category.subcategories[0];

      const responseData = {
        id: `${category.id}-${subcategory.id}`,
        categoryName: category.name,
        subcategoryName: subcategory.name,
        sortOrder: category.sortOrder,
        categoryImage: category.image ? getPresignedUrl(category.image, 3600) : null,
        subcategoryImage: subcategory.image ? getPresignedUrl(subcategory.image, 3600) : null,
        categoryMetaTitle: category.metaTitle,
        categoryMetaDescription: category.metaDescription,
        categoryMetaKeywords: category.metaKeywords,
        subcategoryMetaTitle: subcategory.metaTitle,
        subcategoryMetaDescription: subcategory.metaDescription,
        subcategoryMetaKeywords: subcategory.metaKeywords,
        categoryIsActive: category.isActive,
        subcategoryIsActive: subcategory.isActive,
        createdAt: category.createdAt,
        updatedAt: category.updatedAt,
      };

      res.json({
        success: true,
        data: responseData,
      });
    } else {
      // Single category ID
      const category = await prisma.category.findUnique({
        where: { id },
      });

      if (!category) {
        return res.status(404).json({
          success: false,
          message: "Category not found",
        });
      }

      res.json({
        success: true,
        data: {
          id: category.id,
          categoryName: category.name,
          subcategoryName: "",
          sortOrder: category.sortOrder,
          categoryImage: category.image ? getPresignedUrl(category.image, 3600) : null,
          subcategoryImage: null,
          categoryMetaTitle: category.metaTitle,
          categoryMetaDescription: category.metaDescription,
          categoryMetaKeywords: category.metaKeywords,
          subcategoryMetaTitle: "",
          subcategoryMetaDescription: "",
          subcategoryMetaKeywords: "",
          categoryIsActive: category.isActive,
          subcategoryIsActive: false,
          createdAt: category.createdAt,
          updatedAt: category.updatedAt,
        },
      });
    }
  } catch (error) {
    console.error("Error fetching category:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch category",
      error: error.message,
    });
  }
};

// Create category only (without subcategory)
const createCategoryOnly = async (req, res) => {
  try {
    const { categoryName } = req.body;

    if (!categoryName) {
      return res.status(400).json({
        success: false,
        message: "Category name is required",
      });
    }

    // Check if category already exists
    const existingCategory = await prisma.category.findFirst({
      where: {
        name: { equals: categoryName, mode: "insensitive" },
      },
    });

    if (existingCategory) {
      return res.status(200).json({
        success: true,
        message: "Category already exists",
        data: {
          id: existingCategory.id,
          name: existingCategory.name,
        },
      });
    }

    // Create category
    const category = await prisma.category.create({
      data: {
        name: categoryName,
        isActive: true,
      },
    });

    res.status(201).json({
      success: true,
      message: "Category created successfully",
      data: {
        id: category.id,
        name: category.name,
      },
    });
  } catch (error) {
    console.error("Error creating category:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create category",
      error: error.message,
    });
  }
};

const createCategory = async (req, res) => {
  try {
    const {
      categoryName,
      subcategoryName,
      categoryMetaTitle,
      categoryMetaDescription,
      categoryMetaKeywords,
      subcategoryMetaTitle,
      subcategoryMetaDescription,
      subcategoryMetaKeywords,
      categoryIsActive = "true",
      subcategoryIsActive = "true",
    } = req.body;

    if (!categoryName) {
      return res.status(400).json({
        success: false,
        message: "Category name is required",
      });
    }

    // Handle uploaded images - Upload to S3
    let categoryImageKey = null;
    let subcategoryImageKey = null;

    if (req.files) {
      if (req.files.categoryImage) {
        try {
          categoryImageKey = await uploadToS3(req.files.categoryImage[0].buffer, req.files.categoryImage[0].originalname, req.files.categoryImage[0].mimetype);
        } catch (error) {
          console.error("Error uploading category image to S3:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to upload category image",
            error: error.message,
          });
        }
      }
      if (req.files.subcategoryImage) {
        try {
          subcategoryImageKey = await uploadToS3(req.files.subcategoryImage[0].buffer, req.files.subcategoryImage[0].originalname, req.files.subcategoryImage[0].mimetype);
        } catch (error) {
          console.error("Error uploading subcategory image to S3:", error);
          if (categoryImageKey) {
            await deleteFromS3(categoryImageKey);
          }
          return res.status(500).json({
            success: false,
            message: "Failed to upload subcategory image",
            error: error.message,
          });
        }
      }
    }

    // Check if category exists, if not create it
    let category = await prisma.category.findFirst({
      where: {
        name: { equals: categoryName, mode: "insensitive" },
      },
    });

    if (!category) {
      // Check if sortOrder is already in use by another category
      const sortOrderValue = req.body.sortOrder ? parseInt(req.body.sortOrder) : 0;
      const existingCategoryWithSameOrder = await prisma.category.findFirst({
        where: {
          sortOrder: sortOrderValue,
        },
      });

      if (existingCategoryWithSameOrder) {
        return res.status(400).json({
          success: false,
          message: `Sort order ${sortOrderValue} is already used by category "${existingCategoryWithSameOrder.name}". Please choose a different sort order.`,
        });
      }

      category = await prisma.category.create({
        data: {
          name: categoryName,
          image: categoryImageKey,
          metaTitle: categoryMetaTitle,
          metaDescription: categoryMetaDescription,
          metaKeywords: categoryMetaKeywords,
          isActive: categoryIsActive === "true" || categoryIsActive === true,
          sortOrder: sortOrderValue,
        },
      });
    } else {
      // Update existing category
      if (categoryImageKey && category.image) {
        await deleteFromS3(category.image);
      }
      category = await prisma.category.update({
        where: { id: category.id },
        data: {
          image: categoryImageKey || category.image,
          metaTitle: categoryMetaTitle || category.metaTitle,
          metaDescription: categoryMetaDescription || category.metaDescription,
          metaKeywords: categoryMetaKeywords || category.metaKeywords,
          isActive: categoryIsActive === "true" || categoryIsActive === true,
          sortOrder: req.body.sortOrder !== undefined ? parseInt(req.body.sortOrder) : category.sortOrder,
        },
      });
    }

    // If subcategoryName is not provided or is empty, return category-only response
    if (!subcategoryName || subcategoryName.trim() === "") {
      return res.status(201).json({
        success: true,
        message: "Category created successfully",
        data: {
          id: category.id,
          categoryName: category.name,
          subcategoryName: "",
          categoryImage: category.image,
          subcategoryImage: null,
          categoryMetaTitle: category.metaTitle,
          categoryMetaDescription: category.metaDescription,
          categoryMetaKeywords: category.metaKeywords,
          subcategoryMetaTitle: "",
          subcategoryMetaDescription: "",
          subcategoryMetaKeywords: "",
          categoryIsActive: category.isActive,
          subcategoryIsActive: false,
          sortOrder: category.sortOrder,
          createdAt: category.createdAt,
          updatedAt: category.updatedAt,
        },
      });
    }

    // Check if subcategory already exists
    const existingSubcategory = await prisma.subcategory.findFirst({
      where: {
        categoryId: category.id,
        name: { equals: subcategoryName, mode: "insensitive" },
      },
    });

    if (existingSubcategory) {
      return res.status(400).json({
        success: false,
        message: "This subcategory already exists in the selected category",
      });
    }

    // Create subcategory
    const subcategory = await prisma.subcategory.create({
      data: {
        name: subcategoryName,
        image: subcategoryImageKey,
        metaTitle: subcategoryMetaTitle,
        metaDescription: subcategoryMetaDescription,
        metaKeywords: subcategoryMetaKeywords,
        isActive: subcategoryIsActive === "true" || subcategoryIsActive === true,
        categoryId: category.id,
      },
    });

    const responseData = {
      id: `${category.id}-${subcategory.id}`,
      categoryName: category.name,
      subcategoryName: subcategory.name,
      categoryImage: category.image,
      subcategoryImage: subcategory.image,
      categoryMetaTitle: category.metaTitle,
      categoryMetaDescription: category.metaDescription,
      categoryMetaKeywords: category.metaKeywords,
      subcategoryMetaTitle: subcategory.metaTitle,
      subcategoryMetaDescription: subcategory.metaDescription,
      subcategoryMetaKeywords: subcategory.metaKeywords,
      categoryIsActive: category.isActive,
      subcategoryIsActive: subcategory.isActive,
      sortOrder: category.sortOrder,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    };

    res.status(201).json({
      success: true,
      message: "Category and subcategory created successfully",
      data: responseData,
    });
  } catch (error) {
    console.error("Error creating category:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create category",
      error: error.message,
    });
  }
};

// Update category
const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    // Handle both single ID and composite ID formats
    let categoryId, subcategoryId;
    
    if (id.includes("-")) {
      const idParts = id.split("-");
      if (idParts.length !== 2) {
        return res.status(400).json({
          success: false,
          message: "Invalid composite ID format",
        });
      }
      [categoryId, subcategoryId] = idParts;
    } else {
      const isObjectId = /^[0-9a-fA-F]{24}$/.test(id);
      
      if (isObjectId) {
        categoryId = id;
        subcategoryId = null;
      } else {
        const categoryByName = await prisma.category.findFirst({
          where: {
            name: { equals: decodeURIComponent(id), mode: "insensitive" },
          },
        });
        
        if (!categoryByName) {
          return res.status(404).json({
            success: false,
            message: "Category not found",
          });
        }
        
        categoryId = categoryByName.id;
        subcategoryId = null;
      }
    }

    // Check if category exists
    const existingCategory = await prisma.category.findUnique({
      where: { id: categoryId },
      include: { subcategories: true },
    });

    if (!existingCategory) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    // Check if subcategory exists
    let existingSubcategory = null;
    if (subcategoryId) {
      existingSubcategory = existingCategory.subcategories.find(
        (sub) => sub.id === subcategoryId
      );
      if (!existingSubcategory) {
        return res.status(404).json({
          success: false,
          message: "Subcategory not found",
        });
      }
    }

    // Check for duplicate names
    if (updateData.categoryName) {
      const duplicate = await prisma.category.findFirst({
        where: {
          id: { not: categoryId },
          name: { equals: updateData.categoryName, mode: "insensitive" },
        },
      });

      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: "Category name already exists",
        });
      }
    }

    // Check for duplicate sortOrder
    if (updateData.sortOrder !== undefined) {
      const sortOrderValue = parseInt(updateData.sortOrder);
      const existingCategoryWithSameOrder = await prisma.category.findFirst({
        where: {
          id: { not: categoryId },
          sortOrder: sortOrderValue,
        },
      });

      if (existingCategoryWithSameOrder) {
        return res.status(400).json({
          success: false,
          message: `Sort order ${sortOrderValue} is already used by category "${existingCategoryWithSameOrder.name}". Please choose a different sort order.`,
        });
      }
    }

    if (updateData.subcategoryName && subcategoryId && existingSubcategory) {
      const duplicate = await prisma.subcategory.findFirst({
        where: {
          id: { not: subcategoryId },
          categoryId: categoryId,
          name: { equals: updateData.subcategoryName, mode: "insensitive" },
        },
      });

      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: "Subcategory name already exists in this category",
        });
      }
    }

    // Prepare update data
    const categoryUpdateData = {};
    const subcategoryUpdateData = {};
    let oldCategoryImage = null;
    let oldSubcategoryImage = null;

    // Separate category and subcategory fields
    if (updateData.categoryName) categoryUpdateData.name = updateData.categoryName;
    if (updateData.sortOrder !== undefined) categoryUpdateData.sortOrder = parseInt(updateData.sortOrder);
    if (updateData.categoryMetaTitle) categoryUpdateData.metaTitle = updateData.categoryMetaTitle;
    if (updateData.categoryMetaDescription) categoryUpdateData.metaDescription = updateData.categoryMetaDescription;
    if (updateData.categoryMetaKeywords) categoryUpdateData.metaKeywords = updateData.categoryMetaKeywords;
    if (updateData.categoryIsActive !== undefined) {
      categoryUpdateData.isActive = updateData.categoryIsActive === "true" || updateData.categoryIsActive === true;
    }

    if (updateData.subcategoryName) subcategoryUpdateData.name = updateData.subcategoryName;
    if (updateData.subcategoryMetaTitle) subcategoryUpdateData.metaTitle = updateData.subcategoryMetaTitle;
    if (updateData.subcategoryMetaDescription) subcategoryUpdateData.metaDescription = updateData.subcategoryMetaDescription;
    if (updateData.subcategoryMetaKeywords) subcategoryUpdateData.metaKeywords = updateData.subcategoryMetaKeywords;
    if (updateData.subcategoryIsActive !== undefined) {
      subcategoryUpdateData.isActive = updateData.subcategoryIsActive === "true" || updateData.subcategoryIsActive === true;
    }

    // Handle image uploads
    if (req.files) {
      if (req.files.categoryImage) {
        try {
          oldCategoryImage = existingCategory.image;
          const categoryImageKey = await uploadToS3(req.files.categoryImage[0].buffer, req.files.categoryImage[0].originalname, req.files.categoryImage[0].mimetype);
          categoryUpdateData.image = categoryImageKey;
        } catch (error) {
          console.error("Error uploading category image:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to upload category image",
            error: error.message,
          });
        }
      }
      if (req.files.subcategoryImage && existingSubcategory) {
        try {
          oldSubcategoryImage = existingSubcategory.image;
          const subcategoryImageKey = await uploadToS3(req.files.subcategoryImage[0].buffer, req.files.subcategoryImage[0].originalname, req.files.subcategoryImage[0].mimetype);
          subcategoryUpdateData.image = subcategoryImageKey;
        } catch (error) {
          console.error("Error uploading subcategory image:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to upload subcategory image",
            error: error.message,
          });
        }
      }
    }

    // Update category
    let updatedCategory = existingCategory;
    if (Object.keys(categoryUpdateData).length > 0) {
      const oldCategoryName = existingCategory.name;
      const newCategoryName = categoryUpdateData.name;
      
      updatedCategory = await prisma.category.update({
        where: { id: categoryId },
        data: {
          ...categoryUpdateData,
          updatedAt: new Date(),
        },
        include: { subcategories: true },
      });

      // Update online products if category name changed
      if (newCategoryName && newCategoryName !== oldCategoryName) {
        try {
          const updateResult = await prisma.onlineProduct.updateMany({
            where: { category: oldCategoryName },
            data: { category: newCategoryName, updatedAt: new Date() }
          });
          console.log(`Updated ${updateResult.count} online products with new category name`);
        } catch (error) {
          console.error('Error updating online products category:', error);
        }
      }
    }

    // Handle subcategory
    let updatedSubcategory = existingSubcategory;
    
    if (!subcategoryId && updateData.subcategoryName && updateData.subcategoryName.trim() !== "") {
      // Create new subcategory
      const existingSubcategoryByName = await prisma.subcategory.findFirst({
        where: {
          categoryId: categoryId,
          name: { equals: updateData.subcategoryName, mode: "insensitive" },
        },
      });

      if (existingSubcategoryByName) {
        return res.status(400).json({
          success: false,
          message: "This subcategory already exists in the selected category",
        });
      }

      let subcategoryImageKey = null;
      if (req.files?.subcategoryImage) {
        try {
          subcategoryImageKey = await uploadToS3(req.files.subcategoryImage[0].buffer, req.files.subcategoryImage[0].originalname, req.files.subcategoryImage[0].mimetype);
        } catch (error) {
          console.error("Error uploading subcategory image:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to upload subcategory image",
            error: error.message,
          });
        }
      }

      updatedSubcategory = await prisma.subcategory.create({
        data: {
          name: updateData.subcategoryName,
          image: subcategoryImageKey,
          metaTitle: updateData.subcategoryMetaTitle || null,
          metaDescription: updateData.subcategoryMetaDescription || null,
          metaKeywords: updateData.subcategoryMetaKeywords || null,
          isActive: updateData.subcategoryIsActive === "true" || updateData.subcategoryIsActive === true,
          categoryId: categoryId,
        },
      });
    } else if (subcategoryId && Object.keys(subcategoryUpdateData).length > 0) {
      // Update existing subcategory
      const oldSubcategoryName = existingSubcategory.name;
      const newSubcategoryName = subcategoryUpdateData.name;
      
      updatedSubcategory = await prisma.subcategory.update({
        where: { id: subcategoryId },
        data: {
          ...subcategoryUpdateData,
          updatedAt: new Date(),
        },
      });

      // Update online products if subcategory name changed
      if (newSubcategoryName && newSubcategoryName !== oldSubcategoryName) {
        try {
          const updateResult = await prisma.onlineProduct.updateMany({
            where: {
              category: existingCategory.name,
              subCategory: oldSubcategoryName
            },
            data: {
              subCategory: newSubcategoryName,
              updatedAt: new Date()
            }
          });
          console.log(`Updated ${updateResult.count} online products with new subcategory name`);
        } catch (error) {
          console.error('Error updating online products subcategory:', error);
        }
      }
    }

    // Delete old images
    if (oldCategoryImage) await deleteFromS3(oldCategoryImage);
    if (oldSubcategoryImage) await deleteFromS3(oldSubcategoryImage);

    // Return response
    if (updatedSubcategory) {
      const responseData = {
        id: `${updatedCategory.id}-${updatedSubcategory.id}`,
        categoryName: updatedCategory.name,
        subcategoryName: updatedSubcategory.name,
        categoryImage: updatedCategory.image,
        subcategoryImage: updatedSubcategory.image,
        categoryMetaTitle: updatedCategory.metaTitle,
        categoryMetaDescription: updatedCategory.metaDescription,
        categoryMetaKeywords: updatedCategory.metaKeywords,
        subcategoryMetaTitle: updatedSubcategory.metaTitle,
        subcategoryMetaDescription: updatedSubcategory.metaDescription,
        subcategoryMetaKeywords: updatedSubcategory.metaKeywords,
        categoryIsActive: updatedCategory.isActive,
        subcategoryIsActive: updatedSubcategory.isActive,
        createdAt: updatedCategory.createdAt,
        updatedAt: new Date(),
      };

      res.json({
        success: true,
        message: subcategoryId ? "Category and subcategory updated successfully" : "Category updated and subcategory created successfully",
        data: responseData,
      });
    } else {
      const responseData = {
        id: updatedCategory.id,
        categoryName: updatedCategory.name,
        subcategoryName: "",
        categoryImage: updatedCategory.image,
        subcategoryImage: null,
        categoryMetaTitle: updatedCategory.metaTitle,
        categoryMetaDescription: updatedCategory.metaDescription,
        categoryMetaKeywords: updatedCategory.metaKeywords,
        subcategoryMetaTitle: null,
        subcategoryMetaDescription: null,
        subcategoryMetaKeywords: null,
        categoryIsActive: updatedCategory.isActive,
        subcategoryIsActive: false,
        createdAt: updatedCategory.createdAt,
        updatedAt: new Date(),
      };

      res.json({
        success: true,
        message: "Category updated successfully",
        data: responseData,
      });
    }
  } catch (error) {
    console.error("Error updating category:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update category",
      error: error.message,
    });
  }
};

// Delete category
const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await prisma.category.findUnique({
      where: { id },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    // Store image paths before deletion
    const categoryImagePath = category.image;

    await prisma.category.delete({
      where: { id },
    });

    // Delete associated images
    if (categoryImagePath) {
      await deleteFromS3(categoryImagePath);
    }

    res.json({
      success: true,
      message: "Category deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting category:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete category",
      error: error.message,
    });
  }
};

// Toggle category status
const toggleCategoryStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.body;

    let categoryId, subcategoryId;

    if (id.includes("-")) {
      const idParts = id.split("-");
      if (idParts.length !== 2) {
        return res.status(400).json({
          success: false,
          message: "Invalid composite ID format",
        });
      }
      [categoryId, subcategoryId] = idParts;
    } else {
      categoryId = id;
      subcategoryId = null;
    }

    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      include: { subcategories: true },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    let updatedCategory = category;
    let updatedSubcategory = null;

    if (type === "category") {
      updatedCategory = await prisma.category.update({
        where: { id: categoryId },
        data: { isActive: !category.isActive },
        include: { subcategories: true },
      });

      if (!subcategoryId) {
        return res.json({
          success: true,
          message: "Category status updated successfully",
          data: {
            id: updatedCategory.id,
            categoryName: updatedCategory.name,
            categoryIsActive: updatedCategory.isActive,
          },
        });
      }
    } else if (type === "subcategory") {
      if (!subcategoryId) {
        return res.status(400).json({
          success: false,
          message: "Subcategory ID required for subcategory toggle",
        });
      }

      const subcategory = category.subcategories.find((sub) => sub.id === subcategoryId);
      if (!subcategory) {
        return res.status(404).json({
          success: false,
          message: "Subcategory not found",
        });
      }

      updatedSubcategory = await prisma.subcategory.update({
        where: { id: subcategoryId },
        data: { isActive: !subcategory.isActive },
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid type. Must be "category" or "subcategory"',
      });
    }

    if (subcategoryId) {
      const subcategory = updatedSubcategory || category.subcategories.find((sub) => sub.id === subcategoryId);
      if (!subcategory) {
        return res.status(404).json({
          success: false,
          message: "Subcategory not found",
        });
      }
      updatedSubcategory = subcategory;

      const responseData = {
        id: `${updatedCategory.id}-${updatedSubcategory.id}`,
        categoryName: updatedCategory.name,
        subcategoryName: updatedSubcategory.name,
        categoryImage: updatedCategory.image,
        subcategoryImage: updatedSubcategory.image,
        categoryMetaTitle: updatedCategory.metaTitle,
        categoryMetaDescription: updatedCategory.metaDescription,
        categoryMetaKeywords: updatedCategory.metaKeywords,
        subcategoryMetaTitle: updatedSubcategory.metaTitle,
        subcategoryMetaDescription: updatedSubcategory.metaDescription,
        subcategoryMetaKeywords: updatedSubcategory.metaKeywords,
        categoryIsActive: updatedCategory.isActive,
        subcategoryIsActive: updatedSubcategory.isActive,
        createdAt: updatedCategory.createdAt,
        updatedAt: new Date(),
      };

      return res.json({
        success: true,
        message: `${type} status updated successfully`,
        data: responseData,
      });
    }
  } catch (error) {
    console.error("Error toggling status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update status",
      error: error.message,
    });
  }
};

// Get unique category names
const getCategoryNames = async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      select: {
        id: true,
        name: true,
      },
      distinct: ["name"],
      orderBy: {
        name: "asc",
      },
    });

    const categoryNames = categories.map((cat) => ({
      _id: cat.id,
      name: cat.name,
    }));

    res.json({
      success: true,
      data: categoryNames,
    });
  } catch (error) {
    console.error("Error fetching category names:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch category names",
      error: error.message,
    });
  }
};

// Get subcategories by category
const getSubcategoriesByCategory = async (req, res) => {
  try {
    const { categoryName } = req.params;

    const category = await prisma.category.findFirst({
      where: {
        name: { equals: decodeURIComponent(categoryName), mode: "insensitive" },
      },
      include: {
        subcategories: {
          where: { isActive: true },
          select: { name: true },
          orderBy: { name: "asc" },
        },
      },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
        data: [],
      });
    }

    const subcategoryNames = category.subcategories.map((sub) => sub.name);

    res.json({
      success: true,
      data: subcategoryNames,
    });
  } catch (error) {
    console.error("Error fetching subcategories:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch subcategories",
      error: error.message,
      data: [],
    });
  }
};

// Get subcategories with IDs
const getSubcategoriesWithIdsByCategory = async (req, res) => {
  try {
    const { categoryName } = req.params;

    const category = await prisma.category.findFirst({
      where: {
        name: { equals: decodeURIComponent(categoryName), mode: "insensitive" },
      },
      include: {
        subcategories: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            image: true,
          },
          orderBy: { name: "asc" },
        },
      },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
        data: [],
      });
    }

    const subcategoriesWithIds = category.subcategories.map((sub) => ({
      id: sub.id,
      name: sub.name,
      image: sub.image,
    }));

    res.json({
      success: true,
      data: subcategoriesWithIds,
    });
  } catch (error) {
    console.error("Error fetching subcategories with IDs:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch subcategories with IDs",
      error: error.message,
      data: [],
    });
  }
};

// Get unique categories
const getUniqueCategories = async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      where: {
        isActive: true,
        image: { not: null },
      },
      select: {
        id: true,
        name: true,
        image: true,
      },
      orderBy: { sortOrder: "asc" },
    });

    res.json({
      success: true,
      data: categories.map((cat) => ({
        id: cat.id,
        categoryName: cat.name,
        categoryImage: cat.image,
      })),
      message: `Found ${categories.length} unique categories`,
    });
  } catch (error) {
    console.error("Error fetching unique categories:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// Generate SEO content using GROQ API
const generateSEOContent = async (
  categoryName,
  subcategoryName = null,
  companyName = "Your Company"
) => {
  const prompt = subcategoryName
    ? `Generate high-quality, professional SEO content for an e-commerce subcategory "${subcategoryName}" under category "${categoryName}". 
       
       Requirements:
       1. Meta title: Create an engaging, keyword-rich title (max 50 characters) that ends with " | ${companyName}"
       2. Meta description: Write a compelling description (140-155 characters) that includes benefits, action words, and key features
       3. Meta keywords: Provide 8-12 highly relevant, search-optimized keywords (comma-separated)
       
       IMPORTANT: Use "${companyName}" ONLY in the meta title (after |) and meta description for branding.
       Do NOT include company name in keywords unless it's a well-known brand.
       
       Focus on:
       - Search intent and user benefits
       - Commercial keywords for e-commerce
       - Brand positioning and trust signals
       - Conversion-oriented language
       
       Format the response as JSON with keys: metaTitle, metaDescription, metaKeywords`
    : `Generate high-quality, professional SEO content for an e-commerce category "${categoryName}". 
       
       Requirements:
       1. Meta title: Create an engaging, keyword-rich title (max 50 characters) that ends with " | ${companyName}"
       2. Meta description: Write a compelling description (140-155 characters) that includes benefits, action words, and key features
       3. Meta keywords: Provide 8-12 highly relevant, search-optimized keywords (comma-separated)
       
       IMPORTANT: Use "${companyName}" ONLY in the meta title (after |) and meta description for branding.
       Do NOT include company name in keywords unless it's a well-known brand.
       
       Focus on:
       - Search intent and user benefits
       - Commercial keywords for e-commerce
       - Brand positioning and trust signals
       - Conversion-oriented language
       
       Format the response as JSON with keys: metaTitle, metaDescription, metaKeywords`;

  // List of models to try in order of preference
  const modelsToTry = [
    "llama-3.1-8b-instant",
    "llama-3.2-1b-preview",
    "llama-3.2-3b-preview",
    "llama-3.2-11b-vision-preview",
    "llama-3.2-90b-vision-preview",
    "llama3-groq-70b-8192-tool-use-preview",
    "llama3-groq-8b-8192-tool-use-preview",
  ];

  let lastError = null;

  for (const model of modelsToTry) {
    try {
      console.log(`Trying GROQ model: ${model}`);

      const completion = await groq.chat.completions.create({
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        model: model,
        temperature: 0.7,
        max_tokens: 500,
      });

      const response = completion.choices[0]?.message?.content;

      // Try to parse JSON response
      try {
        // Clean the response to extract JSON
        let cleanedResponse = response;

        // Try to find JSON in the response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          cleanedResponse = jsonMatch[0];
        }

        const seoData = JSON.parse(cleanedResponse);
        console.log(`Successfully generated SEO content using model: ${model}`);

        // Ensure title has company suffix
        let title = seoData.metaTitle || seoData.meta_title || "";
        if (title && !title.includes(`| ${companyName}`)) {
          title = title.replace(/\s*\|\s*.*$/, "") + ` | ${companyName}`;
        }

        return {
          metaTitle: title,
          metaDescription:
            seoData.metaDescription || seoData.meta_description || "",
          metaKeywords: seoData.metaKeywords || seoData.meta_keywords || "",
        };
      } catch (parseError) {
        console.warn(
          `Failed to parse GROQ response as JSON for model ${model}:`,
          response
        );

        // Fallback: try to extract content manually if JSON parsing fails
        if (response && typeof response === "string") {
          // Simple fallback extraction
          const titleMatch = response.match(
            /title["\s]*:[\s]*["']([^"']+)["']/i
          );
          const descMatch = response.match(
            /description["\s]*:[\s]*["']([^"']+)["']/i
          );
          const keywordsMatch = response.match(
            /keywords["\s]*:[\s]*["']([^"']+)["']/i
          );

          if (titleMatch || descMatch || keywordsMatch) {
            console.log(`Extracted SEO content manually from model: ${model}`);

            // Ensure title has company suffix
            let extractedTitle = titleMatch
              ? titleMatch[1]
              : `Premium ${categoryName}${
                  subcategoryName ? ` ${subcategoryName}` : ""
                } | ${companyName}`;
            if (
              extractedTitle &&
              !extractedTitle.includes(`| ${companyName}`)
            ) {
              extractedTitle =
                extractedTitle.replace(/\s*\|\s*.*$/, "") + ` | ${companyName}`;
            }

            return {
              metaTitle: extractedTitle,
              metaDescription: descMatch
                ? descMatch[1]
                : `Shop premium ${categoryName}${
                    subcategoryName ? ` ${subcategoryName}` : ""
                  } products. Top quality, competitive prices & fast delivery!`,
              metaKeywords: keywordsMatch
                ? keywordsMatch[1]
                : `${categoryName}${
                    subcategoryName ? `, ${subcategoryName}` : ""
                  }, premium ${categoryName}, buy ${categoryName}, ${categoryName} online, quality ${categoryName}, ${categoryName} store`,
            };
          }
        }

        // Try next model
        continue;
      }
    } catch (error) {
      console.warn(`Model ${model} failed:`, error.message);
      lastError = error;
      // Try next model
      continue;
    }
  }

  // If all models failed, generate high-quality SEO content as fallback
  console.warn(
    "All GROQ models failed, generating premium SEO content as fallback"
  );

  const categoryTitle =
    categoryName.charAt(0).toUpperCase() + categoryName.slice(1);
  const subcategoryTitle = subcategoryName
    ? subcategoryName.charAt(0).toUpperCase() + subcategoryName.slice(1)
    : "";

  // Generate premium SEO content with commercial intent
  const generatePremiumSEO = (
    category,
    subcategory = null,
    company = companyName
  ) => {
    if (subcategory) {
      return {
        metaTitle: `Premium ${subcategory} ${category} | ${company}`,
        metaDescription: `Discover top-quality ${subcategory} in ${category}. Premium brands, competitive prices, fast shipping & expert support. Shop now!`,
        metaKeywords: `${subcategory}, ${category}, premium ${subcategory}, buy ${subcategory}, ${subcategory} online, best ${subcategory}, ${category} products, quality ${subcategory}, ${subcategory} store, ${subcategory} deals, professional ${subcategory}, top ${subcategory}`,
      };
    } else {
      return {
        metaTitle: `Premium ${category} Collection | ${company}`,
        metaDescription: `Shop premium ${category} products online. Top brands, unbeatable prices, fast delivery & expert customer service. Browse now!`,
        metaKeywords: `${category}, premium ${category}, buy ${category}, ${category} online, best ${category}, ${category} products, quality ${category}, ${category} store, ${category} deals, professional ${category}, top ${category}, ${category} collection`,
      };
    }
  };

  return generatePremiumSEO(
    categoryTitle.toLowerCase(),
    subcategoryTitle ? subcategoryTitle.toLowerCase() : null,
    companyName
  );
};

// Function to detect company name from existing SEO titles
const detectCompanyName = async () => {
  try {
    // Try to find existing categories with SEO titles that contain company names
    const existingCategory = await prisma.category.findFirst({
      where: {
        metaTitle: {
          contains: "|",
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    if (existingCategory && existingCategory.metaTitle) {
      const titleParts = existingCategory.metaTitle.split("|");
      if (titleParts.length > 1) {
        const detectedName = titleParts[titleParts.length - 1].trim();
        if (detectedName && detectedName !== "Your Company" && detectedName !== "ECommerce") {
          return detectedName;
        }
      }
    }

    // Also check subcategories
    const existingSubcategory = await prisma.subcategory.findFirst({
      where: {
        metaTitle: {
          contains: "|",
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    if (existingSubcategory && existingSubcategory.metaTitle) {
      const titleParts = existingSubcategory.metaTitle.split("|");
      if (titleParts.length > 1) {
        const detectedName = titleParts[titleParts.length - 1].trim();
        if (detectedName && detectedName !== "Your Company" && detectedName !== "ECommerce") {
          return detectedName;
        }
      }
    }

    return "Your Company"; // Default fallback only if nothing found
  } catch (error) {
    console.error("Error detecting company name:", error);
    return "Your Company";
  }
};

// Generate enhanced SEO content for both category and subcategory
const generateEnhancedSEO = async (req, res) => {
  try {
    const { categoryName, subcategoryName, companyName } = req.body;

    console.log("SEO Generation Request:", { categoryName, subcategoryName, companyName });

    if (!categoryName) {
      return res.status(400).json({
        success: false,
        message: "Category name is required",
      });
    }

    // Use provided company name or detect from existing data
    let finalCompanyName = companyName;
    if (!finalCompanyName || finalCompanyName.trim() === "" || finalCompanyName === "Your Company") {
      finalCompanyName = await detectCompanyName();
    }
    console.log("Company name received:", companyName);
    console.log("Final company name to use:", finalCompanyName);
    
    // If still no company name, use a generic fallback
    if (!finalCompanyName || finalCompanyName.trim() === "" || finalCompanyName === "Your Company") {
      finalCompanyName = "Your Store";
    }

    // Generate enhanced SEO for both category and subcategory with company name
    const categorySEO = await generateSEOContent(
      categoryName,
      null,
      finalCompanyName
    );
    let subcategorySEO = null;

    if (subcategoryName) {
      subcategorySEO = await generateSEOContent(
        categoryName,
        subcategoryName,
        finalCompanyName
      );
    }

    // Ensure company name is properly set (fallback replacement)
    const enhancedCategorySEO = {
      ...categorySEO,
      metaTitle: categorySEO.metaTitle.replace(
        "Your Company",
        finalCompanyName
      ),
    };

    const enhancedSubcategorySEO = subcategorySEO
      ? {
          ...subcategorySEO,
          metaTitle: subcategorySEO.metaTitle.replace(
            "Your Company",
            finalCompanyName
          ),
        }
      : null;

    res.json({
      success: true,
      message: "Enhanced SEO content generated successfully",
      data: {
        category: {
          categoryMetaTitle: enhancedCategorySEO.metaTitle,
          categoryMetaDescription: enhancedCategorySEO.metaDescription,
          categoryMetaKeywords: enhancedCategorySEO.metaKeywords,
        },
        subcategory: enhancedSubcategorySEO
          ? {
              subcategoryMetaTitle: enhancedSubcategorySEO.metaTitle,
              subcategoryMetaDescription:
                enhancedSubcategorySEO.metaDescription,
              subcategoryMetaKeywords: enhancedSubcategorySEO.metaKeywords,
            }
          : null,
        detectedCompanyName: finalCompanyName, // Send back for frontend reference
      },
    });
  } catch (error) {
    console.error("Error generating enhanced SEO:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate enhanced SEO content. Please try again.",
      error: error.message,
    });
  }
};

module.exports = {
  getAllCategories,
  getCategoryById,
  getCategoryByName,
  createCategory,
  createCategoryOnly,
  updateCategory,
  deleteCategory,
  toggleCategoryStatus,
  getCategoryNames,
  getSubcategoriesByCategory,
  getSubcategoriesWithIdsByCategory,
  getUniqueCategories,
  generateEnhancedSEO,
};
