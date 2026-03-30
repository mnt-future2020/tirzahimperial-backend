const { prisma } = require('../../config/database');
const { getProxyImageUrl } = require('../../utils/common/imageProxy');

/**
 * Add item to wishlist
 * POST /api/online/wishlist
 */
const addToWishlist = async (req, res) => { 
  try {
    const { userId, productId, productData } = req.body;

    if (!userId || !productId || !productData) {
      return res.status(400).json({
        success: false,
        error: "User ID, product ID, and product data are required",
      });
    }

    // Find customer
    const customer = await prisma.customer.findUnique({
      where: { userId },
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: "Customer not found. Please ensure user is registered.",
      });
    }

    // Check if item already exists
    const existingItem = await prisma.wishlistItem.findFirst({
      where: {
        customerId: customer.id,
        productId,
      },
    });

    if (existingItem) {
      return res.status(409).json({
        success: false,
        error: "Product already in wishlist",
        data: {
          wishlistItemId: existingItem.id,
          addedAt: existingItem.addedAt,
          ...existingItem.productData,
        },
      });
    }

    // Add to wishlist
    const wishlistItem = await prisma.wishlistItem.create({
      data: {
        customerId: customer.id,
        productId,
        productData,
      },
    });

    res.status(201).json({
      success: true,
      message: "Product added to wishlist",
      data: {
        wishlistItemId: wishlistItem.id,
        addedAt: wishlistItem.addedAt,
        ...wishlistItem.productData,
      },
    });
  } catch (error) {
    console.error("Add to wishlist error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to add to wishlist",
      message: error.message,
    });
  }
};

/**
 * Remove item from wishlist
 * DELETE /api/online/wishlist/:productId
 */
const removeFromWishlist = async (req, res) => {
  try {
    const { productId } = req.params;
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "User ID is required",
      });
    }

    // Find customer
    const customer = await prisma.customer.findUnique({
      where: { userId },
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: "Customer not found",
      });
    }

    // Remove from wishlist
    const result = await prisma.wishlistItem.deleteMany({
      where: {
        customerId: customer.id,
        productId,
      },
    });

    if (result.count === 0) {
      return res.status(404).json({
        success: false,
        error: "Product not found in wishlist",
      });
    }

    res.json({
      success: true,
      message: "Product removed from wishlist",
    });
  } catch (error) {
    console.error("Remove from wishlist error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to remove from wishlist",
      message: error.message,
    });
  }
};

/**
 * Clear entire wishlist
 * DELETE /api/online/wishlist
 */
const clearWishlist = async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "User ID is required",
      });
    }

    // Find customer
    const customer = await prisma.customer.findUnique({
      where: { userId },
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: "Customer not found",
      });
    }

    // Clear wishlist
    const result = await prisma.wishlistItem.deleteMany({
      where: {
        customerId: customer.id,
      },
    });

    res.json({
      success: true,
      message: "Wishlist cleared successfully",
      data: {
        removedCount: result.count,
      },
    });
  } catch (error) {
    console.error("Clear wishlist error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to clear wishlist",
      message: error.message,
    });
  }
};

/**
 * Get wishlist
 * GET /api/online/wishlist
 */
const getWishlist = async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "User ID is required",
      });
    }

    // Find customer
    const customer = await prisma.customer.findUnique({
      where: { userId },
      include: {
        wishlistItems: {
          orderBy: { addedAt: "desc" },
        },
      },
    });

    if (!customer) {
      return res.json({
        success: true,
        data: [],
      });
    }

    // ✅ FIX: Fetch fresh product data and update wishlist items with current stock
    const wishlistProducts = await Promise.all(
      customer.wishlistItems.map(async (item) => {
        try {
          // Get current product data from OnlineProduct
          const currentProduct = await prisma.onlineProduct.findUnique({
            where: { id: item.productId },
          });

          if (!currentProduct) {
            // Product no longer exists, return cached data with formatted images
            return {
              wishlistItemId: item.id,
              addedAt: item.addedAt,
              ...item.productData,
              defaultProductImage: item.productData?.defaultProductImage 
                ? getProxyImageUrl(item.productData.defaultProductImage)
                : null,
              variants: (item.productData?.variants || []).map(variant => ({
                ...variant,
                variantImages: (variant.variantImages || [])
                  .map(img => getProxyImageUrl(img))
                  .filter(Boolean),
              })),
            };
          }

          // Get the variant index from stored productData
          const variantIndex = item.productData?.variantIndex || 0;
          const currentVariant = currentProduct.variants?.[variantIndex];

          if (!currentVariant) {
            // Variant no longer exists, return cached data with formatted images
            return {
              wishlistItemId: item.id,
              addedAt: item.addedAt,
              ...item.productData,
              defaultProductImage: item.productData?.defaultProductImage 
                ? getProxyImageUrl(item.productData.defaultProductImage)
                : null,
              variants: (item.productData?.variants || []).map(variant => ({
                ...variant,
                variantImages: (variant.variantImages || [])
                  .map(img => getProxyImageUrl(img))
                  .filter(Boolean),
              })),
            };
          }

          // ✅ New Logic: Update ALL variants with fresh stock from Inventory
          // This ensures that even if the user switches variants in the UI, they see correct stock
          const updatedVariants = await Promise.all(
            (currentProduct.variants || []).map(async (variant) => {
              if (variant.inventoryProductId) {
                try {
                  const inventoryItem = await prisma.item.findUnique({
                    where: { id: variant.inventoryProductId },
                    select: { 
                      quantity: true, 
                      lowStockAlertLevel: true 
                    }
                  });
                  
                  if (inventoryItem) {
                    const quantity = inventoryItem.quantity;
                    const alertLevel = variant.variantLowStockAlert || inventoryItem.lowStockAlertLevel || 10;
                    
                    let status;
                    if (quantity === 0) {
                      status = 'out-of-stock';
                    } else if (quantity <= alertLevel) {
                      status = 'low-stock';
                    } else {
                      status = 'in-stock';
                    }
                    
                    return {
                      ...variant,
                      variantStockQuantity: quantity,
                      variantStockStatus: status,
                    };
                  }
                } catch (invError) {
                  console.error(`Failed to fetch inventory for variant ${variant.variantName}:`, invError);
                }
              }
              return variant; // Return original if no inventory link or error
            })
          );

          // Get the specific variant we originally added (for top-level fields compatibility)
          const updatedCurrentVariant = updatedVariants[variantIndex] || updatedVariants[0] || {};
          
          const updatedProductData = {
            ...item.productData,
            variants: updatedVariants, // ✅ Important: Pass updated variants to frontend
            variantStockQuantity: updatedCurrentVariant.variantStockQuantity || 0,
            variantStockStatus: updatedCurrentVariant.variantStockStatus || 'out-of-stock',
            variantSellingPrice: updatedCurrentVariant.variantSellingPrice,
            variantMRP: updatedCurrentVariant.variantMRP,
          };

          // ✅ Update the wishlist item in database with fresh data
          await prisma.wishlistItem.update({
            where: { id: item.id },
            data: {
              productData: updatedProductData,
            },
          });

          // ✅ Format images for frontend response
          const formattedProductData = {
            ...updatedProductData,
            defaultProductImage: updatedProductData.defaultProductImage 
              ? getProxyImageUrl(updatedProductData.defaultProductImage) 
              : null,
            variants: (updatedVariants || []).map(variant => ({
              ...variant,
              variantImages: (variant.variantImages || [])
                .map(img => getProxyImageUrl(img))
                .filter(Boolean),
            })),
          };

          return {
            wishlistItemId: item.id,
            addedAt: item.addedAt,
            ...formattedProductData,
          };
        } catch (error) {
          console.error(`Error updating wishlist item ${item.id}:`, error);
          // Return cached data if update fails, but format images
          return {
            wishlistItemId: item.id,
            addedAt: item.addedAt,
            ...item.productData,
            defaultProductImage: item.productData?.defaultProductImage 
              ? getProxyImageUrl(item.productData.defaultProductImage)
              : null,
            variants: (item.productData?.variants || []).map(variant => ({
              ...variant,
              variantImages: (variant.variantImages || [])
                .map(img => getProxyImageUrl(img))
                .filter(Boolean),
            })),
          };
        }
      })
    );

    res.json({
      success: true,
      data: wishlistProducts,
    });
  } catch (error) {
    console.error("Get wishlist error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get wishlist",
      message: error.message,
    });
  }
};

/**
 * Check if product is in wishlist
 * GET /api/online/wishlist/check/:productId
 */
const checkWishlistItem = async (req, res) => {
  try {
    const { productId } = req.params;
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "User ID is required",
      });
    }

    // Find customer
    const customer = await prisma.customer.findUnique({
      where: { userId },
    });

    if (!customer) {
      return res.json({
        success: true,
        data: {
          isInWishlist: false,
        },
      });
    }

    // Check if item exists
    const item = await prisma.wishlistItem.findFirst({
      where: {
        customerId: customer.id,
        productId,
      },
    });

    res.json({
      success: true,
      data: {
        isInWishlist: !!item,
        wishlistItemId: item?.id,
      },
    });
  } catch (error) {
    console.error("Check wishlist item error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to check wishlist item",
      message: error.message,
    });
  }
};

module.exports = {
  addToWishlist,
  removeFromWishlist,
  clearWishlist,
  getWishlist,
  checkWishlistItem,
};
