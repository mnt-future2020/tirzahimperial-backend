const { prisma } = require("../../config/database");
const multer = require("multer");
const path = require("path");
const {
  uploadToS3,
  deleteFromS3,
  getPresignedUrl,
} = require("../../utils/inventory/s3Upload");
const {
  sendLowStockAlert,
} = require("../../utils/notification/sendNotification");
const {
  syncOnlineProductStock,
  syncPOSProductStock,
} = require("../../utils/inventory/stockUpdateService");
const {
  buildAvailableUomsArray,
} = require("../../utils/inventory/uomConverter");

// Configure multer for memory storage (for S3 upload)
const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase(),
    );
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"));
    }
  },
});

// Get all items
const getAllItems = async (req, res) => {
  try {
    const { category, warehouse, status, excludeProcessing } = req.query;

    const filter = {};
    if (category) filter.category = category;
    if (warehouse) filter.warehouseId = warehouse;
    if (status) filter.status = status;
    
    // 🆕 Exclude processing items (for online/POS product creation)
    if (excludeProcessing === 'true') {
      filter.itemType = { not: 'processing' };
    }

    const items = await prisma.item.findMany({
      where: filter,
      include: { warehouse: true },
      orderBy: { createdAt: "desc" },
    });

    // 🆕 If it's a processing item, fetch its current stock from the processing pool
    const itemsWithPoolData = await Promise.all(
      items.map(async (item) => {
        let poolStock = 0;
        if (item.itemType === "processing") {
          try {
            const poolItem = await prisma.processingPool.findFirst({
              where: {
                itemId: item.id,
                warehouseId: item.warehouseId,
              },
            });
            if (poolItem) {
              poolStock = poolItem.currentStock;
            }
          } catch (poolError) {
            console.error(
              `Error fetching pool for item ${item.id}:`,
              poolError,
            );
          }
        }

        return {
          ...item,
          quantity: item.itemType === "processing" ? poolStock : item.quantity,
          itemImage: item.itemImage
            ? getPresignedUrl(item.itemImage, 3600)
            : null,
        };
      }),
    );

    res.status(200).json({
      success: true,
      data: itemsWithPoolData,
      count: itemsWithPoolData.length,
    });
  } catch (error) {
    console.error("Error fetching items:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch items",
      message: error.message,
    });
  }
};

// Get item by ID
const getItemById = async (req, res) => {
  try {
    const { id } = req.params;

    const item = await prisma.item.findUnique({
      where: { id },
      include: { warehouse: true },
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        error: "Item not found",
      });
    }

    // 🆕 If it's a processing item, fetch its current stock from the processing pool
    let poolStock = 0;
    if (item.itemType === "processing") {
      try {
        const poolItem = await prisma.processingPool.findFirst({
          where: {
            itemId: item.id,
            warehouseId: item.warehouseId,
          },
        });
        if (poolItem) {
          poolStock = poolItem.currentStock;
        }
      } catch (poolError) {
        console.error(`Error fetching pool for item ${item.id}:`, poolError);
      }
    }

    const itemWithProxyUrl = {
      ...item,
      quantity: item.itemType === "processing" ? poolStock : item.quantity,
      itemImage: item.itemImage ? getPresignedUrl(item.itemImage, 3600) : null,
    };

    res.status(200).json({
      success: true,
      data: itemWithProxyUrl,
    });
  } catch (error) {
    console.error("Error fetching item:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch item",
      message: error.message,
    });
  }
};

// Create new item
const createItem = async (req, res) => {
  try {
    const {
      itemName, category, itemCode, uom, purchasePrice, gstRateId, gstPercentage,
      hsnCode, warehouse, openingStock, lowStockAlertLevel, status, expiryDate, description,
      itemType, requiresProcessing,
      // 🆕 Multi-UOM fields
      baseUom, selectedUoms,
    } = req.body;

    // Determine which UOM fields to use (multi-UOM or legacy)
    const useMultiUOM = baseUom && selectedUoms;
    const finalBaseUom = useMultiUOM ? baseUom : (uom || "pcs");
    
    let finalSelectedUoms = [finalBaseUom];
    if (useMultiUOM) {
      try {
        finalSelectedUoms = typeof selectedUoms === 'string' ? JSON.parse(selectedUoms) : selectedUoms;
      } catch (e) {
        console.error("Error parsing selectedUoms:", e);
        finalSelectedUoms = [finalBaseUom];
      }
    }

    if (!itemName || !category || !finalBaseUom || !purchasePrice || !warehouse || !openingStock) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
        required: ["itemName", "category", "baseUom (or uom)", "purchasePrice", "warehouse", "openingStock"],
      });
    }


    // Validate lowStockAlertLevel for regular items
    const finalItemType = itemType || "regular";
    if (finalItemType === "regular" && !lowStockAlertLevel) {
      return res.status(400).json({
        success: false,
        error: "Low stock alert level is required for regular items",
      });
    }

    // Parse requiresProcessing to boolean (comes as string from FormData)
    const finalRequiresProcessing = requiresProcessing === "true" || requiresProcessing === true || (finalItemType === "processing");

    // Check for duplicate SKU/itemCode
    if (itemCode && itemCode.trim() !== "") {
      const existingItem = await prisma.item.findFirst({
        where: { itemCode: itemCode.trim() },
      });

      if (existingItem) {
        return res.status(400).json({
          success: false,
          error: "Duplicate SKU/Item Code",
          message: `An item with SKU/Item Code "${itemCode.trim()}" already exists.`,
        });
      }
    }

    // Verify warehouse exists
    const warehouseExists = await prisma.warehouse.findUnique({
      where: { id: warehouse },
    });

    if (!warehouseExists) {
      return res.status(404).json({
        success: false,
        error: "Warehouse not found",
      });
    }

    // Handle image upload to S3
    let itemImage = null;
    if (req.file) {
      try {
        itemImage = await uploadToS3(req.file.buffer, req.file.originalname, req.file.mimetype);
      } catch (error) {
        console.error("Error uploading image to S3:", error);
        return res.status(500).json({
          success: false,
          error: "Failed to upload image",
          message: error.message,
        });
      }
    }

    const quantity = parseFloat(openingStock || 0);
    const alertLevel = finalItemType === "processing" ? 0 : parseFloat(lowStockAlertLevel || 0);
    
    // 🆕 Build availableUoms array with conversion factors
    const availableUoms = buildAvailableUomsArray(finalBaseUom, finalSelectedUoms);
    
    // Auto-calculate status based on quantity (only for regular items)
    let autoStatus;
    if (finalItemType === "processing") {
      autoStatus = "in_stock"; // Processing items don't have stock status in inventory
    } else {
      if (quantity === 0) {
        autoStatus = "out_of_stock";
      } else if (quantity <= alertLevel) {
        autoStatus = "low_stock";
      } else {
        autoStatus = "in_stock";
      }
    }

    // Use transaction to create item and processing pool if needed
    const result = await prisma.$transaction(async (tx) => {
      // Create item
      const item = await tx.item.create({
        data: {
          itemName,
          category,
          itemCode: itemCode || null,
          // 🆕 Multi-UOM fields
          baseUom: finalBaseUom,
          availableUoms,
          uomLocked: false,
          // Legacy UOM field (for backward compatibility)
          uom: finalBaseUom,
          purchasePrice: parseFloat(purchasePrice),
          gstRateId: gstRateId && gstRateId !== "nil" ? gstRateId : null,
          gstPercentage: gstPercentage ? parseFloat(gstPercentage) : 0,
          hsnCode: hsnCode || null,
          warehouseId: warehouse,
          openingStock: quantity,
          quantity: finalItemType === "processing" ? 0 : quantity, // Processing items have 0 inventory stock
          lowStockAlertLevel: alertLevel,
          status: autoStatus,
          expiryDate: expiryDate ? new Date(expiryDate) : null,
          description: description || null,
          itemImage,
          itemType: finalItemType,
          requiresProcessing: finalRequiresProcessing,
        },
        include: { warehouse: true },
      });

      // If processing item, add opening stock to processing pool
      if (finalItemType === "processing" && quantity > 0) {
        // Check if pool already exists
        let poolItem = await tx.processingPool.findFirst({
          where: {
            itemId: item.id,
            warehouseId: warehouse,
          },
        });

        if (poolItem) {
          // Update existing pool
          const newTotalValue = poolItem.totalValue + quantity * parseFloat(purchasePrice);
          const newCurrentStock = poolItem.currentStock + quantity;
          const newAvgPrice = newTotalValue / newCurrentStock;

          await tx.processingPool.update({
            where: { id: poolItem.id },
            data: {
              currentStock: newCurrentStock,
              avgPurchasePrice: newAvgPrice,
              totalValue: newTotalValue,
              totalPurchased: poolItem.totalPurchased + quantity,
            },
          });
        } else {
          // Create new pool
          await tx.processingPool.create({
            data: {
              itemId: item.id,
              itemName: item.itemName,
              category: item.category,
              itemCode: item.itemCode,
              warehouseId: warehouse,
              warehouseName: warehouseExists.name,
              currentStock: quantity,
              uom: item.baseUom, // Use baseUom for processing pool
              availableUoms: item.availableUoms,
              avgPurchasePrice: parseFloat(purchasePrice),
              totalValue: quantity * parseFloat(purchasePrice),
              totalPurchased: quantity,
              status: "active",
            },
          });
        }
      }

      return item;
    });

    // Send low stock alert if regular item is created with low stock
    if (finalItemType === "regular" && (autoStatus === "low_stock" || autoStatus === "out_of_stock")) {
      try {
        await sendLowStockAlert(result.itemName, quantity, alertLevel, result.warehouse.name);
        console.log(`📱 Low stock alert sent for: ${result.itemName}`);
      } catch (notifError) {
        console.error('⚠️ Failed to send low stock alert:', notifError.message);
      }
    }

    res.status(201).json({
      success: true,
      message: `${finalItemType === "processing" ? "Processing item" : "Item"} created successfully`,
      data: result,
    });
  } catch (error) {
    console.error("Error creating item:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create item",
      message: error.message,
    });
  }
};

// Update item
const updateItem = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      itemName,
      category,
      itemCode,
      uom,
      purchasePrice,
      gstRateId,
      gstPercentage,
      hsnCode,
      warehouse,
      openingStock,
      lowStockAlertLevel,
      status,
      expiryDate,
      description,
      // 🆕 Multi-UOM fields
      baseUom,
      selectedUoms,
    } = req.body;

    const existingItem = await prisma.item.findUnique({ where: { id } });

    if (!existingItem) {
      return res.status(404).json({
        success: false,
        error: "Item not found",
      });
    }

    // 🆕 Check if UOM is locked (prevents UOM changes after online product creation)
    const isUOMChangeAttempt = (baseUom && baseUom !== existingItem.baseUom) || 
                                (uom && uom !== existingItem.baseUom);
    
    if (existingItem.uomLocked && isUOMChangeAttempt) {
      return res.status(400).json({
        success: false,
        error: 'Cannot modify UOM. This item is used in online products.',
        message: 'UOM is locked because this item has online product variants. Delete all variants first to unlock UOM.',
        locked: true,
      });
    }

    // Determine which UOM fields to use
    const useMultiUOM = baseUom && selectedUoms;
    const finalBaseUom = useMultiUOM ? baseUom : (uom || existingItem.baseUom);
    
    let finalSelectedUoms = (existingItem.availableUoms?.map(u => u.uom) || [finalBaseUom]);
    if (useMultiUOM) {
      try {
        finalSelectedUoms = typeof selectedUoms === 'string' ? JSON.parse(selectedUoms) : selectedUoms;
      } catch (e) {
        console.error("Error parsing selectedUoms in update:", e);
      }
    }


    // Check for duplicate SKU/itemCode
    if (itemCode && itemCode.trim() !== "") {
      const duplicateItem = await prisma.item.findFirst({
        where: {
          itemCode: itemCode.trim(),
          id: { not: id },
        },
      });

      if (duplicateItem) {
        return res.status(400).json({
          success: false,
          error: "Duplicate SKU/Item Code",
          message: `An item with SKU/Item Code "${itemCode.trim()}" already exists.`,
        });
      }
    }

    // Handle image upload to S3
    let itemImage = existingItem.itemImage;
    if (req.file) {
      try {
        if (existingItem.itemImage) {
          await deleteFromS3(existingItem.itemImage);
        }
        itemImage = await uploadToS3(
          req.file.buffer,
          req.file.originalname,
          req.file.mimetype,
        );
      } catch (error) {
        console.error("Error uploading image to S3:", error);
        return res.status(500).json({
          success: false,
          error: "Failed to upload image",
          message: error.message,
        });
      }
    }

    const quantity = existingItem.quantity;
    const alertLevel = parseInt(lowStockAlertLevel || 0);

    // 🆕 Build availableUoms array if UOM is being changed
    const availableUoms = isUOMChangeAttempt ? buildAvailableUomsArray(finalBaseUom, finalSelectedUoms) : existingItem.availableUoms;

    // Auto-calculate status based on current quantity
    let autoStatus;
    if (quantity === 0) {
      autoStatus = "out_of_stock";
    } else if (quantity <= alertLevel) {
      autoStatus = "low_stock";
    } else {
      autoStatus = "in_stock";
    }

    const item = await prisma.item.update({
      where: { id },
      data: {
        itemName,
        category,
        itemCode,
        // 🆕 Multi-UOM fields (only update if changed)
        ...(isUOMChangeAttempt && {
          baseUom: finalBaseUom,
          availableUoms,
          uom: finalBaseUom, // Update legacy field too
        }),
        purchasePrice: parseFloat(purchasePrice),
        gstRateId: gstRateId && gstRateId !== "nil" ? gstRateId : null,

        gstPercentage:
          gstPercentage !== undefined
            ? parseFloat(gstPercentage)
            : existingItem.gstPercentage,
        hsnCode,
        warehouseId: warehouse,
        openingStock: parseInt(openingStock || existingItem.openingStock),
        lowStockAlertLevel: alertLevel,
        status: autoStatus,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        description,
        itemImage,
      },
      include: { warehouse: true },
    });

    // Send low stock alert if status changed to low_stock or out_of_stock
    // OR if quantity is at or below alert level (even if status didn't change)
    if (autoStatus === "low_stock" || autoStatus === "out_of_stock") {
      // Send alert if status changed OR if we're at/below alert level
      if (existingItem.status !== autoStatus || quantity <= alertLevel) {
        try {
          await sendLowStockAlert(
            item.itemName,
            quantity,
            alertLevel,
            item.warehouse.name,
          );
          console.log(
            `📱 Low stock alert sent for: ${item.itemName} (Qty: ${quantity}, Alert: ${alertLevel})`,
          );
        } catch (notifError) {
          console.error(
            "⚠️ Failed to send low stock alert:",
            notifError.message,
          );
        }
      }
    }

    // ✅ KEEP: Auto-sync POS product if exists (update stock and status only)
    // This ensures POS products stay in sync with inventory after they're created
    try {
      const posProduct = await prisma.pOSProduct.findFirst({
        where: { itemId: item.id },
      });

      if (posProduct) {
        await prisma.pOSProduct.update({
          where: { id: posProduct.id },
          data: {
            quantity: item.quantity,
            status: item.status,
            warehouse: item.warehouse.name,
            lastSyncedFromItem: new Date(),
          },
        });
        console.log(`✅ Auto-synced POS product for item: ${item.itemName}`);
      }
    } catch (posError) {
      console.error("⚠️ Failed to auto-sync POS product:", posError);
      // Don't fail the item update if POS sync fails
    }

    // 🆕 Auto-sync ProcessingPool if it's a processing item
    if (item.itemType === "processing") {
      try {
        const poolItem = await prisma.processingPool.findFirst({
          where: { itemId: item.id },
        });

        if (poolItem) {
          await prisma.processingPool.update({
            where: { id: poolItem.id },
            data: {
              itemName: item.itemName,
              category: item.category,
              itemCode: item.itemCode,
              uom: item.baseUom,
              availableUoms: item.availableUoms,
              warehouseId: item.warehouseId,
              warehouseName: item.warehouse.name,
              updatedAt: new Date(),
            },
          });
          console.log(`✅ Auto-synced ProcessingPool for item: ${item.itemName}`);
        }
      } catch (poolError) {
        console.error("⚠️ Failed to auto-sync ProcessingPool:", poolError);
      }
    }

    // Auto-sync OnlineProduct totalStockQuantity if this item is used in variants
    try {
      await syncOnlineProductStock(item.id);
    } catch (onlineError) {
      console.error("⚠️ Failed to auto-sync OnlineProduct:", onlineError);
      // Don't fail the item update if OnlineProduct sync fails
    }

    // Auto-sync combo products that use this item
    try {
      const { syncComboProductStock } = require("../../utils/inventory/stockUpdateService");
      await syncComboProductStock(item.id);
    } catch (comboError) {
      console.error("⚠️ Failed to auto-sync Combo Products:", comboError);
      // Don't fail the item update if Combo sync fails
    }

    // Auto-sync POSProduct totalStockQuantity if this item is used in POS variants
    try {
      await syncPOSProductStock(item.id);
    } catch (posError) {
      console.error("⚠️ Failed to auto-sync POSProduct:", posError);
      // Don't fail the item update if POSProduct sync fails
    }

    res.status(200).json({
      success: true,
      message: "Item updated successfully",
      data: item,
    });
  } catch (error) {
    console.error("Error updating item:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update item",
      message: error.message,
    });
  }
};

// Delete item
const deleteItem = async (req, res) => {
  try {
    const { id } = req.params;

    const existingItem = await prisma.item.findUnique({ where: { id } });

    if (!existingItem) {
      return res.status(404).json({
        success: false,
        error: "Item not found",
      });
    }

    if (existingItem.itemImage) {
      await deleteFromS3(existingItem.itemImage);
    }

    // 🆕 If processing item, also delete from processing pool
    if (existingItem.itemType === "processing") {
      try {
        const deleteResult = await prisma.processingPool.deleteMany({
          where: { itemId: id },
        });
        console.log(`✅ Deleted ${deleteResult.count} ProcessingPool entries for item: ${existingItem.itemName}`);
      } catch (poolError) {
        console.error("⚠️ Failed to delete ProcessingPool entries:", poolError);
        // Don't fail the entire operation, but log the error
      }
    }

    await prisma.item.delete({ where: { id } });

    res.status(200).json({
      success: true,
      message: "Item deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting item:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete item",
      message: error.message,
    });
  }
};

// 🆕 Lock item UOM (called when online product variant is created)
const lockItemUOM = async (itemId) => {
  try {
    await prisma.item.update({
      where: { id: itemId },
      data: { uomLocked: true }
    });
    console.log(`✅ UOM locked for item: ${itemId}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to lock UOM for item: ${itemId}`, error);
    return false;
  }
};

module.exports = {
  getAllItems,
  getItemById,
  createItem,
  updateItem,
  deleteItem,
  upload,
  lockItemUOM, // 🆕 Export for use in online product controller
};
