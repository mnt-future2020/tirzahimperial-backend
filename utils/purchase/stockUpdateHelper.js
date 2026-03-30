const { prisma } = require("../../config/database");
const { syncOnlineProductStock } = require("../inventory/stockUpdateService");
const { convertToBaseUOM } = require("../inventory/uomConverter");

/**
 * Update stock after bill/GRN creation (Purchase Order received)
 * Replaces Kafka-based stock update from purchase-service
 * 
 * @param {Object} bill - Bill object with items
 * @param {Array} items - Array of bill items with received quantities
 * @returns {Promise<Array>} - Array of stock update results
 */
const updateStockAfterPurchase = async (bill, items) => {
  const results = [];

  try {
    console.log(`📦 [Purchase Stock Update] Processing GRN: ${bill.grnNumber}`);

    for (const item of items) {
      try {
        // Only update stock if item has an itemId (linked to inventory)
        if (!item.itemId) {
          console.warn(`⚠️ Item ${item.productName} has no itemId, skipping stock update`);
          results.push({
            itemId: null,
            itemName: item.productName,
            success: false,
            error: "No itemId linked to inventory",
          });
          continue;
        }

        // Find the inventory item
        const product = await prisma.item.findUnique({
          where: { id: item.itemId },
          include: { warehouse: true },
        });

        if (!product) {
          console.warn(`⚠️ Inventory item not found: ${item.itemId}`);
          results.push({
            itemId: item.itemId,
            itemName: item.productName,
            success: false,
            error: "Inventory item not found",
          });
          continue;
        }

        const previousQuantity = product.quantity;
        
        // 🆕 UOM Conversion for Purchase
        let quantityReceived = parseFloat(item.receivedQuantity || item.quantityReceived || 0);
        let purchaseUomInfo = { fromUom: product.baseUom, toUom: product.baseUom, conversionApplied: false };

        if (item.uom && item.uom !== product.baseUom) {
          try {
            // Purchase items might non-variant based, so we use conversionFactor from availableUoms
            const convertedQty = convertToBaseUOM(
              quantityReceived,
              item.uom,
              product.baseUom,
              product.availableUoms || []
            );
            
            if (convertedQty !== null) {
              quantityReceived = convertedQty;
              purchaseUomInfo = {
                fromUom: item.uom,
                toUom: product.baseUom,
                originalQuantity: parseFloat(item.receivedQuantity || item.quantityReceived || 0),
                convertedQuantity: convertedQty,
                conversionApplied: true
              };
            }
          } catch (error) {
            console.error(`❌ Purchase UOM conversion error for ${product.itemName}:`, error.message);
          }
        }

        const newQuantity = previousQuantity + quantityReceived;
        
        // Determine new status
        let status = "in_stock";
        if (newQuantity === 0) {
          status = "out_of_stock";
        } else if (newQuantity <= product.lowStockAlertLevel) {
          status = "low_stock";
        }

        // PROCESSING ITEM vs REGULAR ITEM handling
        let isProcessingItem = product.itemType === "processing";
        let poolPreviousQuantity = 0;
        let poolNewQuantity = 0;

        if (isProcessingItem) {
          // PROCESSING ITEM: Stock goes to Processing Pool
          console.log(`🔄 Item ${product.itemName} is a processing item. Stock goes to Processing Pool.`);
          
          // Use transaction to update pool and get quantities
          await prisma.$transaction(async (tx) => {
            let poolItem = await tx.processingPool.findFirst({
              where: {
                itemId: product.id,
                warehouseId: product.warehouseId,
              },
            });

            const itemPurchasePrice = parseFloat(item.unitPrice || item.price || product.purchasePrice || 0);
            poolPreviousQuantity = poolItem ? poolItem.currentStock : 0;

            if (poolItem) {
              // Update existing pool
              const newTotalValue = poolItem.totalValue + quantityReceived * itemPurchasePrice;
              const newCurrentStock = poolItem.currentStock + quantityReceived;
              poolNewQuantity = newCurrentStock;
              const newAvgPrice = newCurrentStock > 0 ? newTotalValue / newCurrentStock : (poolItem.avgPurchasePrice || itemPurchasePrice);

              await tx.processingPool.update({
                where: { id: poolItem.id },
                data: {
                  currentStock: newCurrentStock,
                  avgPurchasePrice: newAvgPrice,
                  totalValue: newTotalValue,
                  totalPurchased: poolItem.totalPurchased + quantityReceived,
                },
              });
            } else {
              // Create new pool
              poolNewQuantity = quantityReceived;
              await tx.processingPool.create({
                data: {
                  itemId: product.id,
                  itemName: product.itemName,
                  category: product.category,
                  itemCode: product.itemCode,
                  warehouseId: product.warehouseId,
                  warehouseName: product.warehouse?.name || "Unknown",
                  currentStock: quantityReceived,
                  uom: product.baseUom,
                  avgPurchasePrice: itemPurchasePrice,
                  totalValue: quantityReceived * itemPurchasePrice,
                  totalPurchased: quantityReceived,
                  status: "active",
                },
              });
            }
          });

          console.log(`✅ Processing Pool updated for: ${product.itemName} (${poolPreviousQuantity} → ${poolNewQuantity})`);
        } else {
          // REGULAR ITEM: Stock goes to Item inventory
          // Update product quantity and status
          await prisma.item.update({
            where: { id: product.id },
            data: {
              quantity: newQuantity,
              status,
            },
          });
          console.log(
            `✅ Stock updated: ${product.itemName} (${previousQuantity} → ${newQuantity}) - Status: ${status}`
          );
        }

        // Create stock adjustment record for audit trail
        await prisma.stockAdjustment.create({
          data: {
            itemId: product.id,
            itemName: product.itemName,
            category: product.category,
            warehouseId: product.warehouseId,
            warehouseName: product.warehouse?.name || "Unknown",
            adjustmentMethod: "purchase_order",
            adjustmentType: "increase",
            quantity: quantityReceived,
            previousQuantity: isProcessingItem ? poolPreviousQuantity : previousQuantity,
            newQuantity: isProcessingItem ? poolNewQuantity : newQuantity,
            uom: product.baseUom,
            // Original input data (before conversion)
            originalQuantity: purchaseUomInfo.conversionApplied ? purchaseUomInfo.originalQuantity : quantityReceived,
            originalUom: purchaseUomInfo.conversionApplied ? purchaseUomInfo.fromUom : product.baseUom,
            adjustedBy: "system",
            // Purchase order specific fields
            purchaseOrderId: bill.purchaseOrderId || null,
            poNumber: bill.poNumber || null,
            billId: bill.id,
            grnNumber: bill.grnNumber,
            supplierId: bill.supplierId,
            supplierName: bill.supplierName,
            batchNumber: item.batchNumber || null,
            expiryDate: item.expiryDate || null,
            manufacturingDate: item.manufacturingDate || null,
            notes: `Purchase received - GRN: ${bill.grnNumber}, Supplier: ${bill.supplierName}${
              purchaseUomInfo.conversionApplied 
                ? ` | UOM: ${purchaseUomInfo.originalQuantity}${purchaseUomInfo.fromUom} → ${purchaseUomInfo.convertedQuantity}${purchaseUomInfo.toUom}` 
                : ''
            }`,
          },
        });

        console.log(
          `📝 Stock adjustment created - GRN: ${bill.grnNumber}, Method: purchase_order, Type: increase`
        );

        // Sync POS Product if exists
        try {
          const posProduct = await prisma.pOSProduct.findFirst({
            where: { itemId: product.id },
          });

          if (posProduct) {
            await prisma.pOSProduct.update({
              where: { id: posProduct.id },
              data: {
                quantity: newQuantity,
                status,
                lastSyncedFromItem: new Date(),
              },
            });
            console.log(`🔄 POS Product synced: ${product.itemName} → ${newQuantity}`);
          }
        } catch (syncError) {
          console.error(`⚠️ Failed to sync POS Product:`, syncError.message);
        }

        // Sync OnlineProduct totalStockQuantity
        try {
          await syncOnlineProductStock(product.id);
        } catch (syncError) {
          console.error(`⚠️ Failed to sync OnlineProduct:`, syncError.message);
        }

        results.push({
          itemId: product.id,
          itemName: product.itemName,
          previousQuantity,
          newQuantity,
          quantityReceived,
          status,
          success: true,
        });
      } catch (itemError) {
        console.error(`❌ Error updating stock for ${item.productName}:`, itemError.message);
        results.push({
          itemId: item.itemId,
          itemName: item.productName,
          success: false,
          error: itemError.message,
        });
      }
    }

    console.log(
      `✅ Purchase stock update completed for GRN ${bill.grnNumber}: ${
        results.filter((r) => r.success).length
      }/${results.length} items updated`
    );

    return results;
  } catch (error) {
    console.error(`❌ Error in updateStockAfterPurchase:`, error);
    throw error;
  }
};

/**
 * Reverse stock update (for bill/GRN cancellation or correction)
 * 
 * @param {Object} bill - Bill object
 * @param {Array} items - Array of bill items
 * @returns {Promise<Array>} - Array of stock update results
 */
const reverseStockAfterPurchase = async (bill, items) => {
  const results = [];

  try {
    console.log(`🔄 [Purchase Stock Reversal] Processing GRN: ${bill.grnNumber}`);

    for (const item of items) {
      try {
        if (!item.itemId) {
          console.warn(`⚠️ Item ${item.productName} has no itemId, skipping reversal`);
          continue;
        }

        const product = await prisma.item.findUnique({
          where: { id: item.itemId },
          include: { warehouse: true },
        });

        if (!product) {
          console.warn(`⚠️ Inventory item not found: ${item.itemId}`);
          continue;
        }

        const previousQuantity = product.quantity;
        
        // 🆕 UOM Conversion for Reversal
        let quantityToReverse = parseFloat(item.receivedQuantity || item.quantityReceived || 0);
        let reversalUomInfo = { fromUom: product.baseUom, toUom: product.baseUom, conversionApplied: false };

        if (item.uom && item.uom !== product.baseUom) {
          try {
            const convertedQty = convertToBaseUOM(
              quantityToReverse,
              item.uom,
              product.baseUom,
              product.availableUoms || []
            );
            
            if (convertedQty !== null) {
              quantityToReverse = convertedQty;
              reversalUomInfo = {
                fromUom: item.uom,
                toUom: product.baseUom,
                originalQuantity: parseFloat(item.receivedQuantity || item.quantityReceived || 0),
                convertedQuantity: convertedQty,
                conversionApplied: true
              };
            }
          } catch (error) {
            console.error(`❌ Purchase reversal UOM conversion error for ${product.itemName}:`, error.message);
          }
        }

        const newQuantity = Math.max(0, previousQuantity - quantityToReverse);

        // Determine new status
        let status = "in_stock";
        if (newQuantity === 0) {
          status = "out_of_stock";
        } else if (newQuantity <= product.lowStockAlertLevel) {
          status = "low_stock";
        }

        // PROCESSING ITEM vs REGULAR ITEM handling
        let isProcessingItem = product.itemType === "processing";
        let poolPreviousQuantity = 0;
        let poolNewQuantity = 0;

        if (isProcessingItem) {
          // PROCESSING ITEM: Stock reversed from Processing Pool
          console.log(`🔄 Item ${product.itemName} is a processing item. Reversing from Processing Pool.`);
          
          await prisma.$transaction(async (tx) => {
            let poolItem = await tx.processingPool.findFirst({
              where: {
                itemId: product.id,
                warehouseId: product.warehouseId,
              },
            });

            if (poolItem) {
              const itemPurchasePrice = parseFloat(item.unitPrice || item.price || product.purchasePrice || 0);
              poolPreviousQuantity = poolItem.currentStock;
              const newCurrentStock = Math.max(0, poolItem.currentStock - quantityToReverse);
              poolNewQuantity = newCurrentStock;
              const newTotalValue = Math.max(0, poolItem.totalValue - quantityToReverse * itemPurchasePrice);
              const newAvgPrice = newCurrentStock > 0 ? newTotalValue / newCurrentStock : poolItem.avgPurchasePrice;

              await tx.processingPool.update({
                where: { id: poolItem.id },
                data: {
                  currentStock: newCurrentStock,
                  avgPurchasePrice: newAvgPrice,
                  totalValue: newTotalValue,
                },
              });
            }
          });
          console.log(`✅ Processing Pool reversed for: ${product.itemName} (${poolPreviousQuantity} → ${poolNewQuantity})`);
        } else {
          // REGULAR ITEM: Stock reversed from Item inventory
          // Update product
          await prisma.item.update({
            where: { id: product.id },
            data: {
              quantity: newQuantity,
              status,
            },
          });
          console.log(`✅ Stock reversed: ${product.itemName} (${previousQuantity} → ${newQuantity})`);
        }

        await prisma.stockAdjustment.create({
          data: {
            itemId: product.id,
            itemName: product.itemName,
            category: product.category,
            warehouseId: product.warehouseId,
            warehouseName: product.warehouse?.name || "Unknown",
            adjustmentMethod: "adjustment",
            adjustmentType: "decrease",
            quantity: quantityToReverse,
            previousQuantity: isProcessingItem ? poolPreviousQuantity : previousQuantity,
            newQuantity: isProcessingItem ? poolNewQuantity : newQuantity,
            uom: product.baseUom,
            // Original input data (before conversion)
            originalQuantity: reversalUomInfo.conversionApplied ? reversalUomInfo.originalQuantity : quantityToReverse,
            originalUom: reversalUomInfo.conversionApplied ? reversalUomInfo.fromUom : product.baseUom,
            adjustedBy: "system",
            billId: bill.id,
            grnNumber: bill.grnNumber,
            supplierId: bill.supplierId,
            supplierName: bill.supplierName,
            notes: `Purchase reversal - GRN: ${bill.grnNumber} cancelled/corrected${
              reversalUomInfo.conversionApplied 
                ? ` | UOM: ${reversalUomInfo.originalQuantity}${reversalUomInfo.fromUom} → ${reversalUomInfo.convertedQuantity}${reversalUomInfo.toUom}` 
                : ''
            }`,
          },
        });

        console.log(`✅ Stock reversed: ${product.itemName} (${previousQuantity} → ${newQuantity})`);

        // Sync POS Product if exists
        try {
          const posProduct = await prisma.pOSProduct.findFirst({
            where: { itemId: product.id },
          });

          if (posProduct) {
            await prisma.pOSProduct.update({
              where: { id: posProduct.id },
              data: {
                quantity: newQuantity,
                status,
                lastSyncedFromItem: new Date(),
              },
            });
            console.log(`🔄 POS Product synced: ${product.itemName} → ${newQuantity}`);
          }
        } catch (syncError) {
          console.error(`⚠️ Failed to sync POS Product:`, syncError.message);
        }

        // Sync OnlineProduct totalStockQuantity
        try {
          await syncOnlineProductStock(product.id);
        } catch (syncError) {
          console.error(`⚠️ Failed to sync OnlineProduct:`, syncError.message);
        }

        results.push({
          itemId: product.id,
          itemName: product.itemName,
          previousQuantity,
          newQuantity,
          quantityReversed: quantityToReverse,
          status,
          success: true,
        });
      } catch (itemError) {
        console.error(`❌ Error reversing stock for ${item.productName}:`, itemError.message);
        results.push({
          itemId: item.itemId,
          itemName: item.productName,
          success: false,
          error: itemError.message,
        });
      }
    }

    console.log(`✅ Purchase stock reversal completed for GRN ${bill.grnNumber}`);
    return results;
  } catch (error) {
    console.error(`❌ Error in reverseStockAfterPurchase:`, error);
    throw error;
  }
};

module.exports = {
  updateStockAfterPurchase,
  reverseStockAfterPurchase,
};
