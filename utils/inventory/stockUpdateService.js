const { prisma } = require("../../config/database");
const { sendLowStockAlert } = require("../notification/sendNotification");
const { checkWishlistBackInStock } = require("../notification/wishlistAlertScheduler");
const { convertToBaseUOM, convertUOMValue } = require("./uomConverter");

/**
 * Update stock after order creation (POS or Online)
 * This replaces the Kafka-based stock update flow from microservices
 * 
 * @param {Object} order - Order object with items
 * @param {String} source - "POS_ORDER" or "ONLINE_ORDER"
 * @returns {Promise<Array>} - Array of stock update results
 */
const updateStockAfterOrder = async (order, source = "POS_ORDER") => {
  const results = [];

  try {
    console.log(`📦 [Stock Update] Processing ${source} for order: ${order.orderNumber}`);

    // 🆕 Expand combo product items into constituent items for stock deduction
    let expandedItems = [];
    for (const item of order.items) {
      if (item.isComboProduct && item.comboItems && Array.isArray(item.comboItems) && item.comboItems.length > 0) {
        console.log(`📦 [Combo Expansion] Expanding combo product "${item.productName}" into ${item.comboItems.length} constituent items`);
        for (const comboItem of item.comboItems) {
          let resolvedInventoryId = comboItem.inventoryProductId;

          // 🆕 Robust Fallback: If inventoryProductId is missing, try to resolve it from OnlineProduct
          if (!resolvedInventoryId && comboItem.productId) {
            try {
              const componentProduct = await prisma.onlineProduct.findUnique({
                where: { id: comboItem.productId },
                select: { variants: true }
              });
              
              const vIndex = comboItem.variantIndex !== undefined ? comboItem.variantIndex : 0;
              if (componentProduct && componentProduct.variants?.[vIndex]) {
                resolvedInventoryId = componentProduct.variants[vIndex].inventoryProductId;
                if (resolvedInventoryId) {
                  console.log(`🔗 Resolved missing inventoryProductId for "${comboItem.productName || comboItem.variantName}": ${resolvedInventoryId}`);
                }
              }
            } catch (e) {
              console.warn(`⚠️ Failed to resolve inventoryProductId for combo item:`, e.message);
            }
          }

          expandedItems.push({
            productId: resolvedInventoryId || comboItem.productId,
            inventoryProductId: resolvedInventoryId,
            productName: comboItem.productName || comboItem.variantName || "Combo Item",
            quantity: (comboItem.quantity || 1) * (item.quantity || 1), // Multiply by combo order quantity
            variantUom: comboItem.variantUom || null,
            variantUomValue: comboItem.variantUomValue || null,
          });
        }
      } else {
        expandedItems.push(item);
      }
    }

    for (const item of expandedItems) {
      try {
        // For POS orders, we need to update both POSProduct and Item (inventory)
        // For Online orders, we need to find Item using inventoryProductId
        
        let product = null;
        let isPOSProduct = false;

        if (source === "POS_ORDER") {
          // First try to find in POSProduct collection
          const posProduct = await prisma.pOSProduct.findUnique({
            where: { id: item.productId },
          });

          if (posProduct) {
            isPOSProduct = true;
            
            // Find the corresponding inventory item using itemId from POSProduct
            if (posProduct.itemId) {
              product = await prisma.item.findUnique({
                where: { id: posProduct.itemId },
                include: { warehouse: true },
              });
              
              if (product) {
                console.log(`🔗 Found inventory item via POSProduct.itemId: ${product.itemName}`);
              }
            }
            
            // Fallback: try itemCode if itemId lookup failed
            if (!product && posProduct.itemCode) {
              product = await prisma.item.findFirst({
                where: { itemCode: posProduct.itemCode },
                include: { warehouse: true },
              });
              
              if (product) {
                console.log(`🔗 Found inventory item via itemCode: ${product.itemName}`);
              }
            }
          }
        } else if (source === "ONLINE_ORDER") {
          // For online orders, use inventoryProductId to find the Item
          if (item.inventoryProductId) {
            product = await prisma.item.findUnique({
              where: { id: item.inventoryProductId },
              include: { warehouse: true },
            });
            
            if (product) {
              console.log(`🔗 Found inventory item via inventoryProductId: ${product.itemName}`);
            }
          }
        }

        // If not found yet, try direct productId lookup
        if (!product) {
          product = await prisma.item.findUnique({
            where: { id: item.productId },
            include: {
              warehouse: true,
            },
          });
        }

        if (!product) {
          console.warn(`⚠️ Product not found in inventory: ${item.productId} (${item.productName})`);
          results.push({
            productId: item.productId,
            productName: item.productName,
            success: false,
            error: "Product not found in inventory",
          });
          continue;
        }

        const previousQuantity = product.quantity;
        
        // 🆕 UOM Conversion: Calculate actual quantity to deduct
        let quantitySold = item.quantity; // Default to raw quantity
        let uomInfo = { fromUom: product.baseUom, toUom: product.baseUom, conversionApplied: false };
        
        // Check if item has UOM information (from online order variant)
        if (item.variantUom && item.variantUom !== product.baseUom) {
          try {
            // Convert variant UOM to base UOM
            // Example: 500g → 0.5kg (if base UOM is kg)
            const convertedQty = convertToBaseUOM(
              item.quantity * (item.variantUomValue || 1),
              item.variantUom,
              product.baseUom,
              product.availableUoms
            );
            
            if (convertedQty !== null) {
              quantitySold = convertedQty;
              uomInfo = {
                fromUom: item.variantUom,
                toUom: product.baseUom,
                originalQuantity: item.quantity * (item.variantUomValue || 1),
                convertedQuantity: convertedQty,
                conversionApplied: true
              };
              
              console.log(
                `🔄 UOM Conversion: ${item.quantity}${item.variantUom} → ${convertedQty}${product.baseUom} for ${product.itemName}`
              );
            } else {
              console.warn(
                `⚠️ UOM conversion failed for ${product.itemName}: ${item.variantUom} → ${product.baseUom}. Using raw quantity.`
              );
            }
          } catch (conversionError) {
            console.error(
              `❌ UOM conversion error for ${product.itemName}:`,
              conversionError.message
            );
            // Fall back to raw quantity
          }
        }
        
        const newQuantity = Math.max(0, previousQuantity - quantitySold);

        // Check if sufficient stock available
        if (newQuantity < 0) {
          console.error(
            `❌ Insufficient stock for ${product.itemName}: Available: ${previousQuantity}, Requested: ${quantitySold}`
          );
        }

        // Determine new status
        let status = "in_stock";
        if (newQuantity === 0) {
          status = "out_of_stock";
        } else if (newQuantity <= product.lowStockAlertLevel) {
          status = "low_stock";
        }

        // Update product quantity and status
        const updatedProduct = await prisma.item.update({
          where: { id: product.id },
          data: {
            quantity: newQuantity,
            status,
          },
        });

        console.log(
          `✅ Stock updated: ${product.itemName} (${previousQuantity} → ${newQuantity}) - Status: ${status}`
        );

        // Sync POS Product quantity to match inventory (for ALL order types)
        try {
          // Find all POS products linked to this inventory item
          const linkedPosProducts = await prisma.pOSProduct.findMany({
            where: { itemId: product.id }
          });

          for (const linkedPosProduct of linkedPosProducts) {
            await prisma.pOSProduct.update({
              where: { id: linkedPosProduct.id },
              data: {
                quantity: newQuantity,
                status,
                lastSyncedFromItem: new Date(),
              },
            });
            console.log(`🔄 POS Product synced: ${product.itemName} (POS ID: ${linkedPosProduct.id}) → ${newQuantity}`);
          }
        } catch (syncError) {
          console.error(`⚠️ Failed to sync POS Products:`, syncError.message);
        }

        try {
          await syncOnlineProductStock(product.id);
          // 🆕 Also sync combo products that might use this item
          await syncComboProductStock(product.id);
        } catch (syncError) {
          console.error(`⚠️ Failed to sync Online/ComboProduct:`, syncError.message);
        }

        // Create stock adjustment record for audit trail
        const warehouseName = product.warehouse && typeof product.warehouse === 'object' 
          ? product.warehouse.name 
          : (product.warehouse || "Unknown");
          
        await prisma.stockAdjustment.create({
          data: {
            itemId: product.id,
            itemName: product.itemName,
            category: product.category,
            warehouseId: product.warehouseId,
            warehouseName: warehouseName,
            adjustmentMethod: "sales_order",
            adjustmentType: "decrease",
            quantity: quantitySold,
            uom: product.baseUom,
            originalQuantity: uomInfo.conversionApplied ? uomInfo.originalQuantity : quantitySold,
            originalUom: uomInfo.conversionApplied ? uomInfo.fromUom : product.baseUom,
            previousQuantity,
            newQuantity,
            adjustedBy: "system",
            // Sales order specific fields
            salesOrderId: order.id,
            soNumber: order.invoiceNumber || order.orderNumber,
            customerId: order.customerId || null,
            customerName: order.customerName || "Walk-in Customer",
            notes: `${source === "POS_ORDER" ? "POS" : "Online"} sale - Invoice: ${
              order.invoiceNumber || order.orderNumber
            }, Payment: ${order.paymentMethod}${
              uomInfo.conversionApplied 
                ? ` | UOM: ${uomInfo.originalQuantity}${uomInfo.fromUom} → ${uomInfo.convertedQuantity}${uomInfo.toUom}` 
                : ''
            }`,
          },
        });

        console.log(
          `📝 Stock adjustment created - Invoice: ${
            order.invoiceNumber || order.orderNumber
          }, Method: sales_order, Type: decrease`
        );

        // Log stock alerts and send notifications
        if (status === "low_stock") {
          console.warn(
            `⚠️ LOW STOCK ALERT: ${product.itemName} - Quantity: ${newQuantity} (Alert Level: ${product.lowStockAlertLevel})`
          );
          
          // Only send notification if we weren't ALREADY low stock/out of stock
          // or if this is a significant drop (optional, but for now strict state change)
          const wasLowOrOut = previousQuantity <= product.lowStockAlertLevel;
          
          if (!wasLowOrOut) {
            // Send low stock notification to admins
            try {
              const warehouseName = product.warehouse && typeof product.warehouse === 'object' 
                ? product.warehouse.name 
                : (product.warehouse || "Unknown");
                
              await sendLowStockAlert(
                product.itemName, 
                newQuantity, 
                product.lowStockAlertLevel, 
                warehouseName
              );
              console.log(`📱 Low stock notification sent for: ${product.itemName}`);
            } catch (notifError) {
              console.error('⚠️ Failed to send low stock notification:', notifError.message);
            }
          }
        } else if (status === "out_of_stock") {
          console.error(`❌ OUT OF STOCK: ${product.itemName} - Quantity: ${newQuantity}`);
          
          // Only send notification if we weren't ALREADY out of stock
          const wasOutOfStock = previousQuantity === 0;
          
          if (!wasOutOfStock) {
            // Send out of stock notification to admins
            try {
              const warehouseName = product.warehouse && typeof product.warehouse === 'object' 
                ? product.warehouse.name 
                : (product.warehouse || "Unknown");
                
              await sendLowStockAlert(
                product.itemName, 
                newQuantity, 
                product.lowStockAlertLevel, 
                warehouseName
              );
              console.log(`📱 Out of stock notification sent for: ${product.itemName}`);
            } catch (notifError) {
              console.error('⚠️ Failed to send out of stock notification:', notifError.message);
            }
          }
        }

        results.push({
          productId: product.id,
          productName: product.itemName,
          previousQuantity,
          newQuantity,
          quantitySold,
          status,
          success: true,
        });
      } catch (itemError) {
        console.error(`❌ Error updating stock for ${item.productName}:`, itemError.message);
        results.push({
          productId: item.productId,
          productName: item.productName,
          success: false,
          error: itemError.message,
        });
      }
    }

    console.log(
      `✅ Stock update completed for order ${order.orderNumber}: ${results.filter((r) => r.success).length}/${
        results.length
      } items updated`
    );

    return results;
  } catch (error) {
    console.error(`❌ Error in updateStockAfterOrder:`, error);
    throw error;
  }
};

/**
 * Update stock after manual stock adjustment
 * This replaces the stock adjustment flow from inventory-service
 * 
 * @param {Object} adjustment - Stock adjustment data
 * @returns {Promise<Object>} - Updated product
 */
const updateStockAfterAdjustment = async (adjustment) => {
  try {
    const { itemId, adjustmentType, quantity } = adjustment;

    // Find the product
    const product = await prisma.item.findUnique({
      where: { id: itemId },
      include: {
        warehouse: true,
      },
    });

    if (!product) {
      throw new Error(`Product not found: ${itemId}`);
    }

    const previousQuantity = product.quantity;
    let newQuantity;

    // Calculate new quantity based on adjustment type
    if (adjustmentType === "increase") {
      newQuantity = previousQuantity + quantity;
    } else {
      newQuantity = Math.max(0, previousQuantity - quantity);
    }

    // Determine new status
    let status = "in_stock";
    if (newQuantity === 0) {
      status = "out_of_stock";
    } else if (newQuantity <= product.lowStockAlertLevel) {
      status = "low_stock";
    }

    // Update product
    const updatedProduct = await prisma.item.update({
      where: { id: itemId },
      data: {
        quantity: newQuantity,
        status,
      },
    });

    console.log(
      `✅ Stock adjusted: ${product.itemName} (${previousQuantity} → ${newQuantity}) - ${adjustmentType} by ${quantity}`
    );

    const adjustmentResult = {
      product: updatedProduct,
      previousQuantity,
      newQuantity,
      quantityChange: adjustmentType === "increase" ? quantity : -quantity,
      status,
    };

    // Sync Online/ComboProduct stock
    try {
      await syncOnlineProductStock(itemId);
      await syncComboProductStock(itemId);
      await syncPOSProductStock(itemId);
    } catch (syncError) {
      console.error(`⚠️ Failed to sync products after adjustment:`, syncError.message);
    }

    return adjustmentResult;
  } catch (error) {
    console.error(`❌ Error in updateStockAfterAdjustment:`, error);
    throw error;
  }
};

/**
 * Reverse stock update (for order cancellation/refund)
 * 
 * @param {Object} order - Order object with items
 * @param {String} source - "POS_ORDER" or "ONLINE_ORDER"
 * @returns {Promise<Array>} - Array of stock update results
 */
const reverseStockUpdate = async (order, source = "POS_ORDER") => {
  const results = [];

  try {
    console.log(`🔄 [Stock Reversal] Processing ${source} reversal for order: ${order.orderNumber}`);

    // 🆕 Expand combo product items into constituent items for stock reversal
    let expandedItems = [];
    for (const item of order.items) {
      if (item.isComboProduct && item.comboItems && Array.isArray(item.comboItems) && item.comboItems.length > 0) {
        console.log(`🔄 [Combo Expansion] Expanding combo product "${item.productName}" for reversal`);
        for (const comboItem of item.comboItems) {
          let resolvedInventoryId = comboItem.inventoryProductId;

          // 🆕 Robust Fallback: Resolve missing inventoryProductId for reversal too
          if (!resolvedInventoryId && comboItem.productId) {
            try {
              const componentProduct = await prisma.onlineProduct.findUnique({
                where: { id: comboItem.productId },
                select: { variants: true }
              });
              
              const vIndex = comboItem.variantIndex !== undefined ? comboItem.variantIndex : 0;
              if (componentProduct && componentProduct.variants?.[vIndex]) {
                resolvedInventoryId = componentProduct.variants[vIndex].inventoryProductId;
              }
            } catch (e) {
              console.warn(`⚠️ Failed to resolve inventoryProductId for reversal:`, e.message);
            }
          }

          expandedItems.push({
            productId: resolvedInventoryId || comboItem.productId,
            inventoryProductId: resolvedInventoryId,
            productName: comboItem.productName || comboItem.variantName || "Combo Item",
            quantity: (comboItem.quantity || 1) * (item.quantity || 1),
            variantUom: comboItem.variantUom || null,
            variantUomValue: comboItem.variantUomValue || null,
          });
        }
      } else {
        expandedItems.push(item);
      }
    }

    for (const item of expandedItems) {
      try {
        const product = await prisma.item.findUnique({
          where: { id: item.productId },
          include: {
            warehouse: true,
          },
        });

        if (!product) {
          console.warn(`⚠️ Product not found: ${item.productId}`);
          continue;
        }

        const previousQuantity = product.quantity;
        
        // 🆕 UOM Conversion for reversal
        let quantityReturned = item.quantity;
        let reversalUomInfo = { fromUom: product.baseUom, toUom: product.baseUom, conversionApplied: false };

        if (item.variantUom && item.variantUom !== product.baseUom) {
          try {
            const convertedQty = convertToBaseUOM(
              item.quantity * (item.variantUomValue || 1),
              item.variantUom,
              product.baseUom,
              product.availableUoms
            );
            
            if (convertedQty !== null) {
              quantityReturned = convertedQty;
              reversalUomInfo = {
                fromUom: item.variantUom,
                toUom: product.baseUom,
                originalQuantity: item.quantity * (item.variantUomValue || 1),
                convertedQuantity: convertedQty,
                conversionApplied: true
              };
            }
          } catch (error) {
            console.error(`❌ UOM reversal conversion error for ${product.itemName}:`, error.message);
          }
        }

        const newQuantity = previousQuantity + quantityReturned;

        // Determine new status
        let status = "in_stock";
        if (newQuantity === 0) {
          status = "out_of_stock";
        } else if (newQuantity <= product.lowStockAlertLevel) {
          status = "low_stock";
        }

        // Update product
        await prisma.item.update({
          where: { id: product.id },
          data: {
            quantity: newQuantity,
            status,
          },
        });

        // Create stock adjustment record
        await prisma.stockAdjustment.create({
          data: {
            itemId: product.id,
            itemName: product.itemName,
            category: product.category,
            warehouseId: product.warehouseId,
            warehouseName: product.warehouse?.name || product.warehouse || "Unknown",
            adjustmentMethod: "sales_return",
            adjustmentType: "increase",
            quantity: quantityReturned,
            uom: product.baseUom,
            originalQuantity: reversalUomInfo.conversionApplied ? reversalUomInfo.originalQuantity : quantityReturned,
            originalUom: reversalUomInfo.conversionApplied ? reversalUomInfo.fromUom : product.baseUom,
            previousQuantity,
            newQuantity,
            adjustedBy: "system",
            salesOrderId: order.id,
            soNumber: order.invoiceNumber || order.orderNumber,
            customerId: order.customerId || null,
            customerName: order.customerName || "Walk-in Customer",
            notes: `${source === "POS_ORDER" ? "POS" : "Online"} order cancelled/refunded - Invoice: ${
              order.invoiceNumber || order.orderNumber
            }${
              reversalUomInfo.conversionApplied 
                ? ` | UOM: ${reversalUomInfo.originalQuantity}${reversalUomInfo.fromUom} → ${reversalUomInfo.convertedQuantity}${reversalUomInfo.toUom}` 
                : ''
            }`,
          },
        });

        console.log(`✅ Stock reversed: ${product.itemName} (${previousQuantity} → ${newQuantity})`);

        results.push({
          productId: product.id,
          productName: product.itemName,
          previousQuantity,
          newQuantity,
          quantityReturned,
          status,
          success: true,
        });
      } catch (itemError) {
        console.error(`❌ Error reversing stock for ${item.productName}:`, itemError.message);
        results.push({
          productId: item.productId,
          productName: item.productName,
          success: false,
          error: itemError.message,
        });
      }
    }

    console.log(`✅ Stock reversal completed for order ${order.orderNumber}`);
    return results;
  } catch (error) {
    console.error(`❌ Error in reverseStockUpdate:`, error);
    throw error;
  }
};

/**
 * Sync OnlineProduct variant stock quantities for products that use this inventory item
 * @param {String} inventoryItemId - Inventory Item ID
 */
const syncOnlineProductStock = async (inventoryItemId) => {
  try {
    // Get current inventory quantity FIRST
    const inventoryItem = await prisma.item.findUnique({
      where: { id: inventoryItemId },
      select: { 
        quantity: true, 
        itemName: true,
        baseUom: true,
        availableUoms: true 
      },
    });
    
    if (!inventoryItem) {
      console.error(`⚠️ Inventory item not found: ${inventoryItemId}`);
      return;
    }
    
    const newStock = inventoryItem.quantity;
    console.log(`🔄 Syncing OnlineProduct for inventory item: ${inventoryItem.itemName} (Stock: ${newStock})`);
    
    // Find all online products
    const onlineProducts = await prisma.onlineProduct.findMany({});
    
        for (const onlineProduct of onlineProducts) {
          // Check if any variant uses this inventory item
          let hasVariant = false;
          let updatedVariants = [...onlineProduct.variants];
          
          // Update variant quantities that use this inventory item
          for (let i = 0; i < updatedVariants.length; i++) {
            const variant = updatedVariants[i];
            if (variant.inventoryProductId === inventoryItemId) {
              hasVariant = true;
              
              // ✅ Get PREVIOUS stock from variant BEFORE updating
              const previousStock = variant.variantStockQuantity || 0;
              
              // 🆕 Calculate NEW stock in terms of variant UOM if applicable
              let variantSpecificNewStock = newStock;
              if (variant.variantUom && variant.variantUomValue && variant.variantUom !== inventoryItem.baseUom) {
                const converted = convertUOMValue(newStock, inventoryItem.baseUom, variant.variantUom);
                if (converted !== null) {
                  // Round to 3 decimal places to avoid floating point issues (e.g., 0.8000000000000001)
                  variantSpecificNewStock = Math.round(converted * 1000) / 1000;
                  console.log(`     ⚖️ Converted ${newStock} ${inventoryItem.baseUom} to ${variantSpecificNewStock} ${variant.variantUom} for variant with ${variant.variantUomValue}${variant.variantUom} per unit`);
                } else {
                  console.warn(`     ⚠️ Conversion failed: ${newStock} ${inventoryItem.baseUom} to ${variant.variantUom}`);
                }
              } else if (variant.variantUom && variant.variantUom === inventoryItem.baseUom) {
                // Same UOM, no conversion needed
                variantSpecificNewStock = newStock;
                console.log(`     ✓ No conversion needed: ${newStock} ${inventoryItem.baseUom} (same as variant UOM)`);
              } else {
                // No variant UOM specified, use base stock
                console.log(`     ℹ️ No variant UOM specified, using base stock: ${newStock} ${inventoryItem.baseUom}`);
              }
  
              console.log(`   📦 Variant ${i}: ${variant.variantName} - Stock: ${previousStock} → ${variantSpecificNewStock}`);
              
              // Update variant stock quantity to match inventory (converted)
              updatedVariants[i] = {
                ...variant,
                variantStockQuantity: variantSpecificNewStock,
                variantStockStatus: variantSpecificNewStock === 0 
                  ? "out-of-stock" 
                  : variantSpecificNewStock <= (variant.variantLowStockAlert || 10)
                  ? "low-stock"
                  : "in-stock"
              };
              
              // ✅ Check if item was out of stock and is now back in stock
              if (previousStock === 0 && variantSpecificNewStock > 0) {
            console.log(`📦 [Back in Stock] ${onlineProduct.shortDescription} - Variant ${i} (${variant.variantName})`);
            console.log(`   Previous: ${previousStock}, New: ${newStock}`);
            
            // Send back in stock notifications to users with this in wishlist
            try {
              const result = await checkWishlistBackInStock(onlineProduct.id, i, newStock);
              console.log(`   ✅ Back in stock check completed:`, result);
            } catch (notifError) {
              console.error('   ⚠️ Failed to send back in stock notifications:', notifError.message);
            }
          }
        }
      }
      
      if (hasVariant) {
        // Update online product with new variant data
        await prisma.onlineProduct.update({
          where: { id: onlineProduct.id },
          data: {
            variants: updatedVariants,
          },
        });
        
        console.log(`✅ OnlineProduct synced: ${onlineProduct.shortDescription} → Variants updated`);
        
        // 🆕 Trigger combo product sync for any combos using this online product
        try {
          await syncComboProductsUsingOnlineProduct(onlineProduct.id);
        } catch (comboSyncError) {
          console.error(`⚠️ Failed to sync combo products for online product ${onlineProduct.id}:`, comboSyncError.message);
        }
      }
    }
  } catch (error) {
    console.error(`⚠️ Failed to sync OnlineProduct:`, error.message);
    console.error('Stack:', error.stack);
  }
};

/**
 * 🆕 Sync POS Product Stock from Inventory
 * Similar to syncOnlineProductStock but for POS products
 * Called after inventory changes (processing, adjustments, etc.)
 * 
 * @param {String} inventoryItemId - Inventory Item ID
 */
const syncPOSProductStock = async (inventoryItemId) => {
  try {
    // Get current inventory quantity
    const inventoryItem = await prisma.item.findUnique({
      where: { id: inventoryItemId },
      select: { 
        quantity: true, 
        itemName: true,
        status: true,
      },
    });
    
    if (!inventoryItem) {
      console.error(`⚠️ Inventory item not found: ${inventoryItemId}`);
      return;
    }
    
    const newStock = inventoryItem.quantity;
    const newStatus = inventoryItem.status;
    console.log(`🔄 Syncing POS Products for inventory item: ${inventoryItem.itemName} (Stock: ${newStock}, Status: ${newStatus})`);
    
    // Find all POS products linked to this inventory item
    const linkedPosProducts = await prisma.pOSProduct.findMany({
      where: { itemId: inventoryItemId }
    });

    if (linkedPosProducts.length === 0) {
      console.log(`   ℹ️ No POS products linked to this inventory item`);
      return;
    }

    for (const posProduct of linkedPosProducts) {
      await prisma.pOSProduct.update({
        where: { id: posProduct.id },
        data: {
          quantity: newStock,
          status: newStatus,
          lastSyncedFromItem: new Date(),
        },
      });
      console.log(`   ✅ POS Product synced: ${posProduct.productName} → ${newStock} (${newStatus})`);
    }
    
    console.log(`✅ Synced ${linkedPosProducts.length} POS product(s)`);
  } catch (error) {
    console.error(`⚠️ Failed to sync POS Products:`, error.message);
  }
};

/**
 * 🆕 Sync Combo Products that use a specific online product
 * Called after an online product's stock is updated
 * @param {String} onlineProductId - Online Product ID
 */
const syncComboProductsUsingOnlineProduct = async (onlineProductId) => {
  try {
    console.log(`🔄 [Combo Sync] Checking combos for online product: ${onlineProductId}`);
    
    // Find all combo products that use this online product
    const combos = await prisma.onlineProduct.findMany({
      where: { type: "combo" }
    });
    
    for (const combo of combos) {
      if (!combo.comboItems || !Array.isArray(combo.comboItems) || combo.comboItems.length === 0) {
        continue;
      }
      
      // Check if this combo uses the online product that was updated
      const usesProduct = combo.comboItems.some(item => item.productId === onlineProductId);
      
      if (usesProduct) {
        console.log(`📦 [Combo Sync] Recalculating stock for combo: "${combo.shortDescription}"`);
        
        let minStock = Infinity;
        let componentsFound = 0;
        
        for (const component of combo.comboItems) {
          if (!component.productId) {
            console.warn(`   ⚠️ No productId for component: ${component.productName || 'Unknown'}`);
            continue;
          }
          
          // Get online product and its variant stock
          const onlineProduct = await prisma.onlineProduct.findUnique({
            where: { id: component.productId },
            select: { 
              id: true,
              shortDescription: true,
              variants: true
            }
          });
          
          if (!onlineProduct) {
            console.warn(`   ⚠️ Online product not found: ${component.productId}`);
            continue;
          }
          
          const variantIndex = component.variantIndex || 0;
          const variant = onlineProduct.variants[variantIndex];
          
          if (!variant) {
            console.warn(`   ⚠️ Variant ${variantIndex} not found for product: ${onlineProduct.shortDescription}`);
            continue;
          }
          
          componentsFound++;
          
          // Get available stock from online product variant
          const availableStock = variant.variantStockQuantity || 0;
          
          // Calculate how many combos can be made with this component
          const baseQuantity = component.quantity || 1;
          const uomValue = component.variantUomValue || 1;
          const requiredPerCombo = baseQuantity * uomValue;
          
          const possibleCombos = Math.floor(availableStock / requiredPerCombo);
          
          if (possibleCombos < minStock) {
            minStock = possibleCombos;
          }
          
          console.log(`   📊 ${variant.displayName || variant.variantName}: ${availableStock}${component.variantUom || ''} available, ${requiredPerCombo}${component.variantUom || ''} required → ${possibleCombos} combos possible`);
        }
        
        const finalComboStock = componentsFound > 0 ? (minStock === Infinity ? 0 : minStock) : 0;
        
        console.log(`   📦 Final combo stock: ${finalComboStock} (from ${componentsFound} components)`);
        
        // Update combo product variants
        const updatedVariants = [...combo.variants];
        if (updatedVariants.length > 0) {
          const previousStock = updatedVariants[0].variantStockQuantity || 0;
          
          updatedVariants[0] = {
            ...updatedVariants[0],
            variantStockQuantity: finalComboStock,
            variantStockStatus: finalComboStock === 0 
              ? "out-of-stock" 
              : finalComboStock <= (updatedVariants[0].variantLowStockAlert || 5)
              ? "low-stock"
              : "in-stock"
          };
          
          await prisma.onlineProduct.update({
            where: { id: combo.id },
            data: { variants: updatedVariants }
          });
          
          console.log(`✅ [Combo Sync] "${combo.shortDescription}" updated: ${previousStock} → ${finalComboStock} (Status: ${updatedVariants[0].variantStockStatus})`);
        }
      }
    }
  } catch (error) {
    console.error(`⚠️ [Combo Sync] Failed for online product ${onlineProductId}:`, error.message);
  }
};

/**
 * 🆕 Sync Combo Product stock when one of its constituent items changes
 * This identifies all combo products that contain the changed inventory item
 * and recalculates their bottleneck stock based on online product stock.
 * 
 * @param {String} inventoryItemId - Inventory Item ID
 */
const syncComboProductStock = async (inventoryItemId) => {
  try {
    console.log(`🔄 [Combo Sync] Checking combos for inventory item: ${inventoryItemId}`);
    
    // Find all combo products
    const combos = await prisma.onlineProduct.findMany({
      where: { type: "combo" }
    });
    
    for (const combo of combos) {
      if (!combo.comboItems || !Array.isArray(combo.comboItems) || combo.comboItems.length === 0) {
        console.log(`⚠️ [Combo Sync] Skipping combo "${combo.shortDescription}" - no combo items`);
        continue;
      }
      
      // Check if this combo uses the inventory item that was updated
      const reliesOnItem = combo.comboItems.some(item => 
        item.inventoryProductId === inventoryItemId || item.productId === inventoryItemId
      );
      
      if (reliesOnItem) {
        console.log(`📦 [Combo Sync] Recalculating stock for combo: "${combo.shortDescription}"`);
        
        let minStock = Infinity;
        let componentsFound = 0;
        let componentDetails = [];
        
        for (const component of combo.comboItems) {
          // Use productId to get online product stock
          if (!component.productId) {
            console.warn(`   ⚠️ No productId for component: ${component.productName || 'Unknown'}`);
            continue;
          }
          
          // Get online product and its variant stock
          const onlineProduct = await prisma.onlineProduct.findUnique({
            where: { id: component.productId },
            select: { 
              id: true,
              shortDescription: true,
              variants: true
            }
          });
          
          if (!onlineProduct) {
            console.warn(`   ⚠️ Online product not found: ${component.productId}`);
            continue;
          }
          
          const variantIndex = component.variantIndex || 0;
          const variant = onlineProduct.variants[variantIndex];
          
          if (!variant) {
            console.warn(`   ⚠️ Variant ${variantIndex} not found for product: ${onlineProduct.shortDescription}`);
            continue;
          }
          
          componentsFound++;
          
          // Get available stock from online product variant
          const availableStock = variant.variantStockQuantity || 0;
          
          // Calculate how many combos can be made with this component
          // For items with UOM (e.g., 500g), we need quantity × variantUomValue
          const baseQuantity = component.quantity || 1;
          const uomValue = component.variantUomValue || 1;
          const requiredPerCombo = baseQuantity * uomValue;
          
          // Calculate possible combos
          // If variant has UOM, availableStock is already in that UOM
          const possibleCombos = Math.floor(availableStock / requiredPerCombo);
          
          componentDetails.push({
            name: variant.displayName || variant.variantName || onlineProduct.shortDescription,
            available: availableStock,
            required: requiredPerCombo,
            possibleCombos: possibleCombos,
            uom: component.variantUom || variant.variantUom
          });
          
          if (possibleCombos < minStock) {
            minStock = possibleCombos;
          }
          
          console.log(`   📊 ${variant.displayName || variant.variantName}: ${availableStock}${component.variantUom || ''} available, ${requiredPerCombo}${component.variantUom || ''} required → ${possibleCombos} combos possible`);
        }
        
        const finalComboStock = componentsFound > 0 ? (minStock === Infinity ? 0 : minStock) : 0;
        
        console.log(`   📦 Final combo stock: ${finalComboStock} (from ${componentsFound} components)`);
        
        // Update combo product variants (usually index 0 for combos)
        const updatedVariants = [...combo.variants];
        if (updatedVariants.length > 0) {
          const previousStock = updatedVariants[0].variantStockQuantity || 0;
          
          updatedVariants[0] = {
            ...updatedVariants[0],
            variantStockQuantity: finalComboStock,
            variantStockStatus: finalComboStock === 0 
              ? "out-of-stock" 
              : finalComboStock <= (updatedVariants[0].variantLowStockAlert || 5)
              ? "low-stock"
              : "in-stock"
          };
          
          await prisma.onlineProduct.update({
            where: { id: combo.id },
            data: { variants: updatedVariants }
          });
          
          console.log(`✅ [Combo Sync] "${combo.shortDescription}" updated: ${previousStock} → ${finalComboStock} (Status: ${updatedVariants[0].variantStockStatus})`);
        } else {
          console.warn(`   ⚠️ No variants found for combo product`);
        }
      }
    }
  } catch (error) {
    console.error(`⚠️ [Combo Sync] Failed:`, error.message);
    console.error('Stack:', error.stack);
  }
};

/**
 * 🆕 Sync ALL Combo Products Stock
 * Recalculates stock for all combo products based on online product stock
 * Uses productId from comboItems to get online product variant stock
 * Useful for initial setup or fixing stock inconsistencies
 */
const syncAllComboProductsStock = async () => {
  try {
    console.log(`🔄 [Combo Sync] Syncing ALL combo products...`);
    
    const combos = await prisma.onlineProduct.findMany({
      where: { type: "combo" }
    });
    
    console.log(`   Found ${combos.length} combo products`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const combo of combos) {
      try {
        if (!combo.comboItems || !Array.isArray(combo.comboItems) || combo.comboItems.length === 0) {
          console.log(`   ⚠️ Skipping "${combo.shortDescription}" - no combo items`);
          continue;
        }
        
        let minStock = Infinity;
        let componentsFound = 0;
        
        for (const component of combo.comboItems) {
          // Use productId to get online product stock
          if (!component.productId) {
            console.warn(`     ⚠️ No productId for component: ${component.productName || 'Unknown'}`);
            continue;
          }
          
          // Get online product and its variant stock
          const onlineProduct = await prisma.onlineProduct.findUnique({
            where: { id: component.productId },
            select: { 
              id: true,
              shortDescription: true,
              variants: true
            }
          });
          
          if (!onlineProduct) {
            console.warn(`     ⚠️ Online product not found: ${component.productId}`);
            continue;
          }
          
          const variantIndex = component.variantIndex || 0;
          const variant = onlineProduct.variants[variantIndex];
          
          if (!variant) {
            console.warn(`     ⚠️ Variant ${variantIndex} not found for product: ${onlineProduct.shortDescription}`);
            continue;
          }
          
          componentsFound++;
          
          // Get available stock from online product variant
          const availableStock = variant.variantStockQuantity || 0;
          
          // Calculate how many combos can be made with this component
          // For items with UOM (e.g., 500g), we need quantity × variantUomValue
          const baseQuantity = component.quantity || 1;
          const uomValue = component.variantUomValue || 1;
          const requiredPerCombo = baseQuantity * uomValue;
          
          // Calculate possible combos
          // If variant has UOM, availableStock is already in that UOM
          const possibleCombos = Math.floor(availableStock / requiredPerCombo);
          
          if (possibleCombos < minStock) {
            minStock = possibleCombos;
          }
          
          console.log(`     📊 ${variant.displayName || variant.variantName}: ${availableStock}${component.variantUom || ''} available, ${requiredPerCombo}${component.variantUom || ''} required → ${possibleCombos} combos possible`);
        }
        
        const finalComboStock = componentsFound > 0 ? (minStock === Infinity ? 0 : minStock) : 0;
        
        // Update combo product variants
        const updatedVariants = [...combo.variants];
        if (updatedVariants.length > 0) {
          const previousStock = updatedVariants[0].variantStockQuantity || 0;
          
          updatedVariants[0] = {
            ...updatedVariants[0],
            variantStockQuantity: finalComboStock,
            variantStockStatus: finalComboStock === 0 
              ? "out-of-stock" 
              : finalComboStock <= (updatedVariants[0].variantLowStockAlert || 5)
              ? "low-stock"
              : "in-stock"
          };
          
          await prisma.onlineProduct.update({
            where: { id: combo.id },
            data: { variants: updatedVariants }
          });
          
          console.log(`   ✅ "${combo.shortDescription}": ${previousStock} → ${finalComboStock}`);
          successCount++;
        }
      } catch (comboError) {
        console.error(`   ❌ Error syncing "${combo.shortDescription}":`, comboError.message);
        errorCount++;
      }
    }
    
    console.log(`✅ [Combo Sync] Complete: ${successCount} synced, ${errorCount} errors`);
    return { success: true, synced: successCount, errors: errorCount };
  } catch (error) {
    console.error(`❌ [Combo Sync] Failed to sync all combos:`, error.message);
    throw error;
  }
};

module.exports = {
  updateStockAfterOrder,
  updateStockAfterAdjustment,
  reverseStockUpdate,
  syncOnlineProductStock,
  syncPOSProductStock,
  syncComboProductStock,
  syncAllComboProductsStock,
};
