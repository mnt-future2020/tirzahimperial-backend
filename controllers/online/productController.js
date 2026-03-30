const { prisma } = require("../../config/database");
const { getPresignedUrl } = require("../../utils/online/uploadS3");

/**
 * Get all products for dropdown selection (inventory items for online use)
 */
const getProducts = async (req, res) => {
  try {
    const { search, limit = 50, excludeProductId } = req.query;

    console.log(`[Product Controller] Fetching products - search: ${search}, limit: ${limit}, excludeProductId: ${excludeProductId}`);

    // Build where clause for search
    const where = {};
    if (search && search.trim() !== "") {
      where.OR = [
        { itemName: { contains: search.trim(), mode: "insensitive" } },
        { itemCode: { contains: search.trim(), mode: "insensitive" } },
      ];
    }
    
    // 🚫 Exclude processing items from online product creation
    where.itemType = { not: 'processing' };

    // Fetch inventory items (these are synced inventory products)
    const products = await prisma.item.findMany({
      where,
      select: {
        id: true,
        itemName: true,
        itemCode: true,
        category: true,
        uom: true,
        baseUom: true,
        availableUoms: true,
        purchasePrice: true,
        gstPercentage: true,
        hsnCode: true,
        warehouseId: true,
        warehouse: {
          select: {
            id: true,
            name: true,
          }
        },
        quantity: true,
        openingStock: true,
        lowStockAlertLevel: true,
        status: true,
        expiryDate: true,
        description: true,
        itemImage: true,
        createdAt: true,
        updatedAt: true,
      },
      take: parseInt(limit) || 50,
      orderBy: {
        itemName: "asc",
      },
    });

    console.log(`[Product Controller] Found ${products.length} products`);

    // Get all online products to check which inventory items are already used
    const onlineProducts = await prisma.onlineProduct.findMany({
      select: {
        id: true,
        variants: true,
      },
    });

    // Build a Set of used inventory product IDs (primary check)
    // Also build a Set of used SKUs as fallback for legacy data
    // 🆕 Only mark as "used" if used in OTHER products (not current product being edited)
    const usedInventoryProductIds = new Set();
    const usedSKUs = new Set();
    
    onlineProducts.forEach((onlineProduct) => {
      // Skip current product if we're editing - allow same item in multiple variants of SAME product
      if (excludeProductId && onlineProduct.id === excludeProductId) {
        return;
      }
      
      // Extract inventory product IDs and SKUs from variants
      if (Array.isArray(onlineProduct.variants)) {
        onlineProduct.variants.forEach((variant) => {
          // Primary: Check by inventoryProductId (reliable, unique)
          if (variant.inventoryProductId) {
            usedInventoryProductIds.add(variant.inventoryProductId);
          }
          // Fallback: Also track SKUs for legacy data
          if (variant.variantSKU) {
            usedSKUs.add(variant.variantSKU);
          }
        });
      }
    });

    console.log(`[Product Controller] Found ${usedInventoryProductIds.size} used inventory product IDs (in other products)`);
    console.log(`[Product Controller] Found ${usedSKUs.size} used SKUs (fallback)`);
    console.log(`[Product Controller] Excluding product ID: ${excludeProductId || 'none (new product)'}`);

    // Generate pre-signed URLs for item images and mark used items
    const productsWithPresignedUrls = await Promise.all(
      products.map(async (product) => {
        // Check if this inventory product is already used in ANOTHER online product
        // Primary check: by inventory product ID (most reliable)
        // Fallback check: by SKU (for legacy data where inventoryProductId might not be set)
        const isUsedById = usedInventoryProductIds.has(product.id);
        const isUsedBySKU = product.itemCode ? usedSKUs.has(product.itemCode) : false;
        const isUsedInOnlineProduct = isUsedById || isUsedBySKU;
        
        // Log expiry date for debugging
        if (product.expiryDate) {
          console.log(`[Product Controller] Product ${product.itemName} has expiryDate:`, product.expiryDate, typeof product.expiryDate);
        }
        
        return {
          ...product,
          // Explicitly serialize expiryDate to ISO string for JSON response
          expiryDate: product.expiryDate ? product.expiryDate.toISOString() : null,
          itemImage: product.itemImage ? getPresignedUrl(product.itemImage, 3600) : null,
          itemImageKey: product.itemImage || null, // Raw S3 key for storage
          isUsedInOnlineProduct,
          syncedAt: product.createdAt, // Use createdAt as syncedAt for compatibility
        };
      })
    );

    res.json({
      success: true,
      data: productsWithPresignedUrls,
      usedInventoryProductIds: Array.from(usedInventoryProductIds), // Send list of used IDs for frontend reference
      usedSKUs: Array.from(usedSKUs), // Send list of used SKUs for frontend reference (legacy)
    });
  } catch (error) {
    console.error("[Product Controller] Error fetching products:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch products",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

/**
 * Get product by ID
 */
const getProductById = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await prisma.item.findUnique({
      where: { id },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Generate pre-signed URL for item image
    const productWithProxyUrl = {
      ...product,
      itemImage: product.itemImage ? getPresignedUrl(product.itemImage, 3600) : null,
      itemImageKey: product.itemImage || null, // Raw S3 key for storage
      syncedAt: product.createdAt, // Use createdAt as syncedAt for compatibility
    };

    res.json({
      success: true,
      data: productWithProxyUrl,
    });
  } catch (error) {
    console.error("Error fetching product:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch product",
      error: error.message,
    });
  }
};

module.exports = {
  getProducts,
  getProductById,
};
