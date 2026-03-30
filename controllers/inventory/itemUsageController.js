const { prisma } = require("../../config/database");

/**
 * Check if an inventory item is used in POS or Online products
 * GET /api/inventory/items/:id/usage
 */
const checkItemUsage = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if item exists
    const item = await prisma.item.findUnique({
      where: { id },
      select: { id: true, itemName: true },
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        error: "Item not found",
      });
    }

    // Check POS products
    const posProducts = await prisma.pOSProduct.findMany({
      where: { itemId: id },
      select: { id: true, itemName: true, display: true },
    });

    const isUsedInPOS = posProducts.length > 0;

    // Check Online products
    const onlineProducts = await prisma.onlineProduct.findMany({});
    
    const usedInOnlineProducts = onlineProducts.filter((product) => {
      if (!product.variants || !Array.isArray(product.variants)) return false;
      return product.variants.some((variant) => variant.inventoryProductId === id);
    });

    const isUsedInOnline = usedInOnlineProducts.length > 0;

    // Prepare usage details
    const usageDetails = {
      isUsedInPOS,
      isUsedInOnline,
      canEdit: !isUsedInPOS && !isUsedInOnline,
      canDelete: !isUsedInPOS && !isUsedInOnline,
      posProducts: posProducts.map((p) => ({
        id: p.id,
        name: p.itemName,
        display: p.display,
      })),
      onlineProducts: usedInOnlineProducts.map((p) => ({
        id: p.id,
        shortDescription: p.shortDescription,
        brand: p.brand,
        category: p.category,
        variantCount: p.variants.filter((v) => v.inventoryProductId === id).length,
      })),
    };

    res.status(200).json({
      success: true,
      data: usageDetails,
    });
  } catch (error) {
    console.error("Error checking item usage:", error);
    res.status(500).json({
      success: false,
      error: "Failed to check item usage",
      message: error.message,
    });
  }
};

/**
 * Bulk check item usage for multiple items
 * POST /api/inventory/items/usage/bulk
 * Body: { itemIds: string[] }
 */
const checkBulkItemUsage = async (req, res) => {
  try {
    const { itemIds } = req.body;

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "itemIds array is required",
      });
    }

    // Fetch all POS products
    const posProducts = await prisma.pOSProduct.findMany({
      where: { itemId: { in: itemIds } },
      select: { itemId: true },
    });

    const posItemIds = new Set(posProducts.map((p) => p.itemId));

    // Fetch all Online products
    const onlineProducts = await prisma.onlineProduct.findMany({});

    const onlineItemIds = new Set();
    onlineProducts.forEach((product) => {
      if (product.variants && Array.isArray(product.variants)) {
        product.variants.forEach((variant) => {
          if (variant.inventoryProductId && itemIds.includes(variant.inventoryProductId)) {
            onlineItemIds.add(variant.inventoryProductId);
          }
        });
      }
    });

    // Build usage map
    const usageMap = {};
    itemIds.forEach((itemId) => {
      const isUsedInPOS = posItemIds.has(itemId);
      const isUsedInOnline = onlineItemIds.has(itemId);
      
      usageMap[itemId] = {
        isUsedInPOS,
        isUsedInOnline,
        canEdit: !isUsedInPOS && !isUsedInOnline,
        canDelete: !isUsedInPOS && !isUsedInOnline,
      };
    });

    res.status(200).json({
      success: true,
      data: usageMap,
    });
  } catch (error) {
    console.error("Error checking bulk item usage:", error);
    res.status(500).json({
      success: false,
      error: "Failed to check bulk item usage",
      message: error.message,
    });
  }
};

module.exports = {
  checkItemUsage,
  checkBulkItemUsage,
};
