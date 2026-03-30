const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { convertUOMValue } = require("../../utils/inventory/uomConverter");
const { syncOnlineProductStock, syncPOSProductStock } = require("../../utils/inventory/stockUpdateService");

// Generate transaction number
const generateTransactionNumber = async () => {
  const year = new Date().getFullYear();
  const lastTransaction = await prisma.processingTransaction.findFirst({
    where: {
      transactionNumber: {
        startsWith: `PT-${year}-`,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  let sequenceNumber = 1;
  if (lastTransaction) {
    const lastNumber = parseInt(lastTransaction.transactionNumber.split("-")[2]);
    sequenceNumber = lastNumber + 1;
  }

  return `PT-${year}-${sequenceNumber.toString().padStart(3, "0")}`;
};
 
// Create processing transaction
const createProcessingTransaction = async (req, res) => {
  try {
    const {
      poolId,
      inputItemId,
      inputQuantity,
      inputUom,
      warehouseId,
      outputs,
      wastagePercent,
      processingCost,
      notes,
    } = req.body;

    // Validate required fields
    if (!poolId || !inputItemId || !inputQuantity || !warehouseId || !outputs || outputs.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Get pool item
    const poolItem = await prisma.processingPool.findUnique({
      where: { id: poolId },
    });

    if (!poolItem) {
      return res.status(404).json({
        success: false,
        message: "Processing pool item not found",
      });
    }

    // Get input item details
    const inputItem = await prisma.item.findUnique({
      where: { id: inputItemId },
    });

    if (!inputItem) {
      return res.status(404).json({
        success: false,
        message: "Input item not found",
      });
    }

    // 🆕 UOM Conversion for input
    let stockToDeduct = inputQuantity;
    if (inputUom && inputUom !== poolItem.uom) {
      const converted = convertUOMValue(inputQuantity, inputUom, poolItem.uom);
      if (converted === null) {
        return res.status(400).json({
          success: false,
          message: `Cannot convert input UOM ${inputUom} to pool UOM ${poolItem.uom}`,
        });
      }
      stockToDeduct = converted;
      console.log(`🔄 Processing Conversion: ${inputQuantity}${inputUom} -> ${stockToDeduct}${poolItem.uom}`);
    }

    // Check if sufficient stock (using converted amount)
    if (poolItem.currentStock < stockToDeduct) {
      return res.status(400).json({
        success: false,
        message: `Insufficient stock in processing pool. Available: ${poolItem.currentStock} ${poolItem.uom}, Requested: ${stockToDeduct} ${poolItem.uom}`,
      });
    }

    // Calculate costs
    const inputUnitCost = poolItem.avgPurchasePrice;
    const inputTotalCost = stockToDeduct * inputUnitCost;
    
    // Calculate wastage quantity in pool UOM
    const wastageQuantity = (stockToDeduct * (wastagePercent || 0)) / 100;
    
    const totalCost = inputTotalCost + (processingCost || 0);
    
    console.log(`📊 Processing Calculation:
      - Input: ${inputQuantity}${inputUom} → ${stockToDeduct}${poolItem.uom} (converted)
      - Wastage: ${wastagePercent}% → ${wastageQuantity}${poolItem.uom}
      - Cost: ₹${inputTotalCost.toFixed(2)} + ₹${processingCost || 0} = ₹${totalCost.toFixed(2)}
    `);

    // Generate transaction number
    const transactionNumber = await generateTransactionNumber();

    // Start transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create processing transaction
      const transaction = await tx.processingTransaction.create({
        data: {
          transactionNumber,
          poolId,
          inputItemId,
          inputItemName: inputItem.itemName,
          inputQuantity: stockToDeduct, // Store in pool UOM
          inputUom: poolItem.uom,
          inputUnitCost,
          inputTotalCost,
          warehouseId,
          warehouseName: poolItem.warehouseName,
          outputs,
          wastagePercent: wastagePercent || 0,
          wastageQuantity,
          processingCost: processingCost || 0,
          totalCost,
          notes: notes || null,
          status: "completed",
          processedAt: new Date(),
        },
      });

      // 2. Update processing pool stock
      const newPoolStock = poolItem.currentStock - stockToDeduct;
      const newTotalValue = newPoolStock * poolItem.avgPurchasePrice;

      await tx.processingPool.update({
        where: { id: poolId },
        data: {
          currentStock: newPoolStock,
          totalValue: newTotalValue,
          totalProcessed: poolItem.totalProcessed + stockToDeduct,
          totalWastage: poolItem.totalWastage + wastageQuantity,
        },
      });

      // 🆕 Log input deduction in stock adjustment history
      await tx.stockAdjustment.create({
        data: {
          itemId: inputItemId,
          itemName: inputItem.itemName,
          category: inputItem.category,
          warehouseId,
          warehouseName: poolItem.warehouseName,
          adjustmentMethod: "processing",
          adjustmentType: "decrease",
          quantity: stockToDeduct, // Deducted from pool
          uom: poolItem.uom,
          originalQuantity: inputQuantity, // User's input quantity
          originalUom: inputUom || poolItem.uom,
          previousQuantity: poolItem.currentStock,
          newQuantity: newPoolStock,
          reason: "processing",
          reasonDetails: `Used for processing PT (${transactionNumber})`,
          adjustedBy: "system",
          notes: `Processing: ${inputQuantity}${inputUom || poolItem.uom} deducted from pool`,
        },
      });

      // 3. Update inventory for each output item
      for (const output of outputs) {
        const outputItem = await tx.item.findUnique({
          where: { id: output.itemId },
        });

        if (!outputItem) {
          throw new Error(`Output item not found: ${output.itemId}`);
        }

        // 🆕 UOM Conversion for output
        let finalOutputQuantity = output.quantity;
        if (output.uom && output.uom !== outputItem.baseUom) {
          const converted = convertUOMValue(output.quantity, output.uom, outputItem.baseUom);
          if (converted === null) {
            throw new Error(`Cannot convert output UOM ${output.uom} to item base UOM ${outputItem.baseUom} for ${outputItem.itemName}`);
          }
          finalOutputQuantity = converted;
          console.log(`🔄 Output Conversion (${outputItem.itemName}): ${output.quantity}${output.uom} → ${finalOutputQuantity}${outputItem.baseUom}`);
        }

        // Calculate new quantity and status
        const newQuantity = outputItem.quantity + finalOutputQuantity;
        let newStatus = outputItem.status;
        
        // Auto-update status based on new quantity
        if (newQuantity === 0) {
          newStatus = "out_of_stock";
        } else if (newQuantity <= outputItem.lowStockAlertLevel) {
          newStatus = "low_stock";
        } else {
          newStatus = "in_stock";
        }

        // Increase inventory stock (using converted quantity)
        await tx.item.update({
          where: { id: output.itemId },
          data: {
            quantity: newQuantity,
            status: newStatus,
          },
        });

        console.log(`✅ Updated ${outputItem.itemName}: ${outputItem.quantity}${outputItem.baseUom} → ${newQuantity}${outputItem.baseUom} (${newStatus})`);

        // Create stock adjustment record
        await tx.stockAdjustment.create({
          data: {
            itemId: output.itemId,
            itemName: output.itemName,
            category: outputItem.category,
            warehouseId,
            warehouseName: poolItem.warehouseName,
            adjustmentMethod: "processing",
            adjustmentType: "increase",
            quantity: finalOutputQuantity, // Log in base UOM
            uom: outputItem.baseUom,
            originalQuantity: output.quantity, // Original input quantity
            originalUom: output.uom, // Original input UOM
            previousQuantity: outputItem.quantity,
            newQuantity: newQuantity,
            reason: "processing",
            reasonDetails: `Processed from ${inputItem.itemName} (${transactionNumber})`,
            adjustedBy: "system",
            notes: `Processing: ${output.quantity}${output.uom} → ${finalOutputQuantity}${outputItem.baseUom}`,
          },
        });

        // 4. Update or create recipe
        const existingRecipe = await tx.processingRecipe.findUnique({
          where: {
            poolId_outputItemId: {
              poolId,
              outputItemId: output.itemId,
            },
          },
        });

        if (existingRecipe) {
          await tx.processingRecipe.update({
            where: { id: existingRecipe.id },
            data: {
              timesCreated: existingRecipe.timesCreated + 1,
              totalQuantity: existingRecipe.totalQuantity + output.quantity,
              lastCreatedAt: new Date(),
            },
          });
        } else {
          await tx.processingRecipe.create({
            data: {
              poolId,
              inputItemId,
              inputItemName: inputItem.itemName,
              outputItemId: output.itemId,
              outputItemName: output.itemName,
              outputUom: output.uom,
              timesCreated: 1,
              totalQuantity: output.quantity,
              firstCreatedAt: new Date(),
              lastCreatedAt: new Date(),
            },
          });
        }
      }

      return transaction;
    });

    // 🆕 Sync online product stock AND POS product stock for all output items (after transaction commits)
    for (const output of outputs) {
      try {
        // Sync online products
        await syncOnlineProductStock(output.itemId);
        console.log(`✅ Synced online product stock for output item: ${output.itemName}`);
        
        // Sync POS products
        await syncPOSProductStock(output.itemId);
        console.log(`✅ Synced POS product stock for output item: ${output.itemName}`);
      } catch (syncError) {
        console.error(`⚠️ Failed to sync products for ${output.itemName}:`, syncError.message);
        // Don't fail the whole operation if sync fails
      }
    }

    res.status(201).json({
      success: true,
      message: "Processing completed successfully",
      data: result,
    });
  } catch (error) {
    console.error("Error creating processing transaction:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create processing transaction",
      error: error.message,
    });
  }
};

// Get all processing transactions
const getProcessingTransactions = async (req, res) => {
  try {
    const { poolId, warehouseId, startDate, endDate } = req.query;

    const where = {};
    if (poolId) where.poolId = poolId;
    if (warehouseId) where.warehouseId = warehouseId;
    if (startDate || endDate) {
      where.processedAt = {};
      if (startDate) where.processedAt.gte = new Date(startDate);
      if (endDate) where.processedAt.lte = new Date(endDate);
    }

    const transactions = await prisma.processingTransaction.findMany({
      where,
      orderBy: { processedAt: "desc" },
    });

    res.status(200).json({
      success: true,
      data: transactions,
    });
  } catch (error) {
    console.error("Error fetching processing transactions:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch processing transactions",
      error: error.message,
    });
  }
};

// Get single processing transaction
const getProcessingTransaction = async (req, res) => {
  try {
    const { id } = req.params;

    const transaction = await prisma.processingTransaction.findUnique({
      where: { id },
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Processing transaction not found",
      });
    }

    res.status(200).json({
      success: true,
      data: transaction,
    });
  } catch (error) {
    console.error("Error fetching processing transaction:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch processing transaction",
      error: error.message,
    });
  }
};

module.exports = {
  createProcessingTransaction,
  getProcessingTransactions,
  getProcessingTransaction,
};
