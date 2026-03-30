const { prisma } = require("../../config/database");

// Get daily movement report
const getDailyMovementReport = async (req, res) => {
  try {
    const { date, warehouseId } = req.query;
    
    const targetDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    // Build filter
    const filter = {
      createdAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
    };

    if (warehouseId) {
      filter.warehouseId = warehouseId;
    }

    // Get all adjustments for the day
    const adjustments = await prisma.stockAdjustment.findMany({
      where: filter,
      orderBy: { createdAt: "asc" },
    });

    // Group by item
    const itemMovements = {};
    
    adjustments.forEach((adj) => {
      if (!itemMovements[adj.itemId]) {
        itemMovements[adj.itemId] = {
          itemId: adj.itemId,
          itemName: adj.itemName,
          warehouseId: adj.warehouseId,
          warehouseName: adj.warehouseName,
          openingStock: adj.previousQuantity,
          increases: 0,
          decreases: 0,
          closingStock: adj.newQuantity,
          // Breakdown by method
          manualIncreases: 0,
          manualDecreases: 0,
          onlineDecreases: 0,
          posDecreases: 0,
          purchaseIncreases: 0,
          adjustments: [],
        };
      }

      const item = itemMovements[adj.itemId];

      if (adj.adjustmentType === "increase") {
        item.increases += adj.quantity;
        if (adj.adjustmentMethod === "adjustment") {
          item.manualIncreases += adj.quantity;
        } else if (adj.adjustmentMethod === "purchase_order") {
          item.purchaseIncreases += adj.quantity;
        }
      } else {
        item.decreases += adj.quantity;
        if (adj.adjustmentMethod === "adjustment") {
          item.manualDecreases += adj.quantity;
        } else if (adj.adjustmentMethod === "sales_order") {
          // Check if it's online or POS based on reference
          if (adj.soNumber && adj.soNumber.includes("POS")) {
            item.posDecreases += adj.quantity;
          } else {
            item.onlineDecreases += adj.quantity;
          }
        }
      }

      item.closingStock = adj.newQuantity;
      item.adjustments.push({
        time: adj.createdAt,
        type: adj.adjustmentType,
        method: adj.adjustmentMethod,
        quantity: adj.quantity,
        reason: adj.reason,
        adjustedBy: adj.adjustedBy,
        reference: adj.soNumber || adj.poNumber || adj.grnNumber,
      });
    });

    const report = Object.values(itemMovements);

    // Calculate summary by method
    const summary = {
      totalItems: report.length,
      totalIncreases: report.reduce((sum, item) => sum + item.increases, 0),
      totalDecreases: report.reduce((sum, item) => sum + item.decreases, 0),
      byMethod: {
        manual: {
          increases: report.reduce((sum, item) => sum + item.manualIncreases, 0),
          decreases: report.reduce((sum, item) => sum + item.manualDecreases, 0),
        },
        purchase: {
          increases: report.reduce((sum, item) => sum + item.purchaseIncreases, 0),
        },
        online: {
          decreases: report.reduce((sum, item) => sum + item.onlineDecreases, 0),
        },
        pos: {
          decreases: report.reduce((sum, item) => sum + item.posDecreases, 0),
        },
      },
    };

    res.status(200).json({
      success: true,
      data: {
        date: targetDate.toISOString().split("T")[0],
        summary,
        report,
      },
    });
  } catch (error) {
    console.error("Error generating daily movement report:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate daily movement report",
      message: error.message,
    });
  }
};

// Get EOD closing stock report
const getEODClosingStockReport = async (req, res) => {
  try {
    const { date, warehouseId } = req.query;

    // Parse the target date
    const targetDate = date ? new Date(date) : new Date();
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Get current date for comparison
    const now = new Date();
    now.setHours(23, 59, 59, 999);

    // If the selected date is in the future, return empty report
    if (endOfDay > now) {
      return res.status(200).json({
        success: true,
        data: {
          date: targetDate.toISOString().split("T")[0],
          summary: {
            totalItems: 0,
            totalUnits: 0,
            totalValue: 0,
            lowStockItems: 0,
            outOfStockItems: 0,
          },
          report: [],
          isFutureDate: true,
          message: "Cannot generate report for future dates",
        },
      });
    }

    const filter = {};
    if (warehouseId && warehouseId !== "all") {
      filter.warehouseId = warehouseId;
    }

    // Check if there are any stock adjustments on or before this date
    const hasAdjustments = await prisma.stockAdjustment.findFirst({
      where: {
        createdAt: {
          lte: endOfDay,
        },
      },
    });

    // If no adjustments exist for this date or before, return message
    if (!hasAdjustments) {
      return res.status(200).json({
        success: true,
        data: {
          date: targetDate.toISOString().split("T")[0],
          summary: {
            totalItems: 0,
            totalUnits: 0,
            totalValue: 0,
            lowStockItems: 0,
            outOfStockItems: 0,
          },
          report: [],
          noDataForDate: true,
          message: "No EOD closing stock at this date",
        },
      });
    }

    // Get all items
    const items = await prisma.item.findMany({
      where: filter,
      include: {
        warehouse: true,
      },
      orderBy: { itemName: "asc" },
    });

    // For each item, get the last stock adjustment on or before the target date
    const itemsWithHistoricalStock = await Promise.all(
      items.map(async (item) => {
        // Get the last adjustment on or before the target date
        const lastAdjustment = await prisma.stockAdjustment.findFirst({
          where: {
            itemId: item.id,
            createdAt: {
              lte: endOfDay,
            },
          },
          orderBy: {
            createdAt: "desc",
          },
        });

        // If there's no adjustment for this item on or before the date, skip it
        if (!lastAdjustment) {
          return null;
        }

        const stockOnDate = lastAdjustment.newQuantity;
        
        // Determine status based on stock level
        let status = "in_stock";
        if (stockOnDate === 0) {
          status = "out_of_stock";
        } else if (stockOnDate <= item.lowStockAlertLevel) {
          status = "low_stock";
        }

        return {
          ...item,
          currentStock: stockOnDate,
          status,
        };
      })
    );

    // Filter out null items (items with no adjustments)
    const validItems = itemsWithHistoricalStock.filter(item => item !== null);

    // If no valid items, return no data message
    if (validItems.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          date: targetDate.toISOString().split("T")[0],
          summary: {
            totalItems: 0,
            totalUnits: 0,
            totalValue: 0,
            lowStockItems: 0,
            outOfStockItems: 0,
          },
          report: [],
          noDataForDate: true,
          message: "No EOD closing stock at this date",
        },
      });
    }

    // Calculate total inventory value
    let totalValue = 0;
    let totalItems = 0;
    let lowStockItems = 0;
    let outOfStockItems = 0;

    const report = validItems.map((item) => {
      const itemValue = item.currentStock * (item.purchasePrice + (item.purchasePrice * item.gstPercentage / 100));
      totalValue += itemValue;
      totalItems += item.currentStock;

      if (item.status === "low_stock") lowStockItems++;
      if (item.status === "out_of_stock") outOfStockItems++;

      return {
        itemId: item.id,
        itemName: item.itemName,
        itemCode: item.itemCode,
        category: item.category,
        warehouse: item.warehouse.name,
        openingStock: item.openingStock,
        currentStock: item.currentStock,
        lowStockAlert: item.lowStockAlertLevel,
        status: item.status,
        uom: item.uom,
        purchasePrice: item.purchasePrice,
        gstPercentage: item.gstPercentage,
        itemValue: itemValue,
        variance: item.currentStock - item.openingStock,
      };
    });

    res.status(200).json({
      success: true,
      data: {
        date: targetDate.toISOString().split("T")[0],
        summary: {
          totalItems: validItems.length,
          totalUnits: totalItems,
          totalValue: totalValue,
          lowStockItems,
          outOfStockItems,
        },
        report,
      },
    });
  } catch (error) {
    console.error("Error generating EOD closing stock report:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate EOD closing stock report",
      message: error.message,
    });
  }
};

// Get period-based analytics
const getPeriodAnalytics = async (req, res) => {
  try {
    const { startDate, endDate, warehouseId, groupBy = "day" } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: "Start date and end date are required",
      });
    }

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    // Build filter
    const filter = {
      createdAt: {
        gte: start,
        lte: end,
      },
    };

    if (warehouseId) {
      filter.warehouseId = warehouseId;
    }

    // Get all adjustments in period
    const adjustments = await prisma.stockAdjustment.findMany({
      where: filter,
      orderBy: { createdAt: "asc" },
    });

    // Analytics calculations
    const analytics = {
      period: {
        startDate: startDate,
        endDate: endDate,
        days: Math.ceil((end - start) / (1000 * 60 * 60 * 24)),
      },
      summary: {
        totalAdjustments: adjustments.length,
        totalIncreases: 0,
        totalDecreases: 0,
        netChange: 0,
        uniqueItems: new Set(),
      },
      byReason: {},
      byWarehouse: {},
      byItem: {},
      timeline: [],
    };

    // Process adjustments
    adjustments.forEach((adj) => {
      analytics.summary.uniqueItems.add(adj.itemId);

      if (adj.adjustmentType === "increase") {
        analytics.summary.totalIncreases += adj.quantity;
        analytics.summary.netChange += adj.quantity;
      } else {
        analytics.summary.totalDecreases += adj.quantity;
        analytics.summary.netChange -= adj.quantity;
      }

      // By reason
      if (!analytics.byReason[adj.reason]) {
        analytics.byReason[adj.reason] = { count: 0, quantity: 0 };
      }
      analytics.byReason[adj.reason].count++;
      analytics.byReason[adj.reason].quantity += adj.quantity;

      // By warehouse
      if (!analytics.byWarehouse[adj.warehouseName]) {
        analytics.byWarehouse[adj.warehouseName] = { count: 0, increases: 0, decreases: 0 };
      }
      analytics.byWarehouse[adj.warehouseName].count++;
      if (adj.adjustmentType === "increase") {
        analytics.byWarehouse[adj.warehouseName].increases += adj.quantity;
      } else {
        analytics.byWarehouse[adj.warehouseName].decreases += adj.quantity;
      }

      // By item
      if (!analytics.byItem[adj.itemId]) {
        analytics.byItem[adj.itemId] = {
          itemName: adj.itemName,
          adjustments: 0,
          increases: 0,
          decreases: 0,
          netChange: 0,
        };
      }
      analytics.byItem[adj.itemId].adjustments++;
      if (adj.adjustmentType === "increase") {
        analytics.byItem[adj.itemId].increases += adj.quantity;
        analytics.byItem[adj.itemId].netChange += adj.quantity;
      } else {
        analytics.byItem[adj.itemId].decreases += adj.quantity;
        analytics.byItem[adj.itemId].netChange -= adj.quantity;
      }
    });

    analytics.summary.uniqueItems = analytics.summary.uniqueItems.size;

    // Convert to arrays for easier frontend consumption
    analytics.byReason = Object.entries(analytics.byReason).map(([reason, data]) => ({
      reason,
      ...data,
    }));

    analytics.byWarehouse = Object.entries(analytics.byWarehouse).map(([warehouse, data]) => ({
      warehouse,
      ...data,
    }));

    analytics.byItem = Object.entries(analytics.byItem).map(([itemId, data]) => ({
      itemId,
      ...data,
    })).sort((a, b) => b.adjustments - a.adjustments);

    res.status(200).json({
      success: true,
      data: analytics,
    });
  } catch (error) {
    console.error("Error generating period analytics:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate period analytics",
      message: error.message,
    });
  }
};

// Get inventory valuation report
const getInventoryValuationReport = async (req, res) => {
  try {
    const { warehouseId } = req.query;

    const filter = {};
    if (warehouseId) {
      filter.warehouseId = warehouseId;
    }

    const items = await prisma.item.findMany({
      where: filter,
      include: {
        warehouse: true,
      },
    });

    let totalValue = 0;
    const byCategory = {};
    const byWarehouse = {};

    items.forEach((item) => {
      const priceWithGst = item.purchasePrice + (item.purchasePrice * item.gstPercentage / 100);
      const itemValue = item.quantity * priceWithGst;
      totalValue += itemValue;

      // By category
      if (!byCategory[item.category]) {
        byCategory[item.category] = { items: 0, units: 0, value: 0 };
      }
      byCategory[item.category].items++;
      byCategory[item.category].units += item.quantity;
      byCategory[item.category].value += itemValue;

      // By warehouse
      const warehouseName = item.warehouse.name;
      if (!byWarehouse[warehouseName]) {
        byWarehouse[warehouseName] = { items: 0, units: 0, value: 0 };
      }
      byWarehouse[warehouseName].items++;
      byWarehouse[warehouseName].units += item.quantity;
      byWarehouse[warehouseName].value += itemValue;
    });

    res.status(200).json({
      success: true,
      data: {
        totalValue,
        totalItems: items.length,
        byCategory: Object.entries(byCategory).map(([category, data]) => ({
          category,
          ...data,
        })),
        byWarehouse: Object.entries(byWarehouse).map(([warehouse, data]) => ({
          warehouse,
          ...data,
        })),
      },
    });
  } catch (error) {
    console.error("Error generating inventory valuation report:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate inventory valuation report",
      message: error.message,
    });
  }
};

// Get stock availability report
const getStockAvailabilityReport = async (req, res) => {
  try {
    const { warehouseId, category, status, lowStock } = req.query;

    const filter = {};
    if (warehouseId && warehouseId !== "all") {
      filter.warehouseId = warehouseId;
    }
    if (category && category !== "all") {
      filter.category = category;
    }
    if (status && status !== "all") {
      filter.status = status;
    }

    const items = await prisma.item.findMany({
      where: filter,
      include: {
        warehouse: true,
      },
      orderBy: { itemName: "asc" },
    });

    // Filter for low stock if requested
    let filteredItems = items;
    if (lowStock === "true") {
      filteredItems = items.filter(
        (item) => item.status === "low_stock" || item.status === "out_of_stock"
      );
    }

    const report = filteredItems.map((item) => {
      // Calculate availability percentage based on opening stock as 100%
      // If opening stock is 0, use low stock alert level * 2 as baseline
      const baseline = item.openingStock > 0 ? item.openingStock : Math.max(item.lowStockAlertLevel * 2, 1);
      const availabilityPercentage = Math.min(Math.round((item.quantity / baseline) * 100), 100);
      
      return {
        itemId: item.id,
        itemName: item.itemName,
        itemCode: item.itemCode,
        category: item.category,
        warehouse: item.warehouse.name,
        warehouseId: item.warehouseId,
        currentStock: item.quantity,
        lowStockAlert: item.lowStockAlertLevel,
        status: item.status,
        uom: item.uom,
        availabilityPercentage: availabilityPercentage >= 0 ? availabilityPercentage : 0,
      };
    });

    const summary = {
      totalItems: filteredItems.length,
      inStock: filteredItems.filter((i) => i.status === "in_stock").length,
      lowStock: filteredItems.filter((i) => i.status === "low_stock").length,
      outOfStock: filteredItems.filter((i) => i.status === "out_of_stock").length,
      totalUnits: filteredItems.reduce((sum, i) => sum + i.quantity, 0),
    };

    res.status(200).json({
      success: true,
      data: {
        summary,
        report,
      },
    });
  } catch (error) {
    console.error("Error generating stock availability report:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate stock availability report",
      message: error.message,
    });
  }
};

// Get inventory movement report (period-based)
const getInventoryMovementReport = async (req, res) => {
  try {
    const { startDate, endDate, warehouseId, itemId } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: "Start date and end date are required",
      });
    }

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const filter = {
      createdAt: {
        gte: start,
        lte: end,
      },
    };

    if (warehouseId && warehouseId !== "all") {
      filter.warehouseId = warehouseId;
    }
    if (itemId) {
      filter.itemId = itemId;
    }

    const movements = await prisma.stockAdjustment.findMany({
      where: filter,
      orderBy: { createdAt: "desc" },
    });

    // Group by item
    const itemMovements = {};
    movements.forEach((mov) => {
      if (!itemMovements[mov.itemId]) {
        itemMovements[mov.itemId] = {
          itemId: mov.itemId,
          itemName: mov.itemName,
          category: mov.category,
          warehouse: mov.warehouseName,
          totalIncreases: 0,
          totalDecreases: 0,
          netChange: 0,
          movementCount: 0,
          // Breakdown by method
          manualIncreases: 0,
          manualDecreases: 0,
          onlineDecreases: 0,
          posDecreases: 0,
          purchaseIncreases: 0,
          movements: [],
        };
      }

      const item = itemMovements[mov.itemId];
      item.movementCount++;
      item.movements.push({
        date: mov.createdAt,
        type: mov.adjustmentType,
        method: mov.adjustmentMethod,
        quantity: mov.quantity,
        reason: mov.reason,
        adjustedBy: mov.adjustedBy,
        referenceNumber: mov.poNumber || mov.soNumber || mov.grnNumber,
      });

      if (mov.adjustmentType === "increase") {
        item.totalIncreases += mov.quantity;
        item.netChange += mov.quantity;
        
        if (mov.adjustmentMethod === "adjustment") {
          item.manualIncreases += mov.quantity;
        } else if (mov.adjustmentMethod === "purchase_order") {
          item.purchaseIncreases += mov.quantity;
        }
      } else {
        item.totalDecreases += mov.quantity;
        item.netChange -= mov.quantity;
        
        if (mov.adjustmentMethod === "adjustment") {
          item.manualDecreases += mov.quantity;
        } else if (mov.adjustmentMethod === "sales_order") {
          // Check if it's online or POS based on reference
          if (mov.soNumber && mov.soNumber.includes("POS")) {
            item.posDecreases += mov.quantity;
          } else {
            item.onlineDecreases += mov.quantity;
          }
        }
      }
    });

    const report = Object.values(itemMovements);

    const summary = {
      totalMovements: movements.length,
      totalIncreases: movements
        .filter((m) => m.adjustmentType === "increase")
        .reduce((sum, m) => sum + m.quantity, 0),
      totalDecreases: movements
        .filter((m) => m.adjustmentType === "decrease")
        .reduce((sum, m) => sum + m.quantity, 0),
      uniqueItems: report.length,
      dateRange: {
        start: startDate,
        end: endDate,
      },
      byMethod: {
        manual: {
          increases: report.reduce((sum, item) => sum + item.manualIncreases, 0),
          decreases: report.reduce((sum, item) => sum + item.manualDecreases, 0),
        },
        purchase: {
          increases: report.reduce((sum, item) => sum + item.purchaseIncreases, 0),
        },
        online: {
          decreases: report.reduce((sum, item) => sum + item.onlineDecreases, 0),
        },
        pos: {
          decreases: report.reduce((sum, item) => sum + item.posDecreases, 0),
        },
      },
    };

    res.status(200).json({
      success: true,
      data: {
        summary,
        report,
      },
    });
  } catch (error) {
    console.error("Error generating inventory movement report:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate inventory movement report",
      message: error.message,
    });
  }
};

// Get expiry and wastage report
const getExpiryWastageReport = async (req, res) => {
  try {
    const { warehouseId, daysAhead = 30 } = req.query;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + parseInt(daysAhead));
    futureDate.setHours(23, 59, 59, 999);

    // Get items expiring soon
    const filter = {
      expiryDate: {
        gte: today,
        lte: futureDate,
      },
    };

    if (warehouseId && warehouseId !== "all") {
      filter.warehouseId = warehouseId;
    }

    const expiringItems = await prisma.item.findMany({
      where: filter,
      include: {
        warehouse: true,
      },
      orderBy: { expiryDate: "asc" },
    });

    // Get wastage from stock adjustments (expired/damage/loss reasons)
    const wastageFilter = {
      reason: {
        in: ["expired", "damage", "loss"],
      },
    };

    if (warehouseId && warehouseId !== "all") {
      wastageFilter.warehouseId = warehouseId;
    }

    const wastageRecords = await prisma.stockAdjustment.findMany({
      where: wastageFilter,
      orderBy: { createdAt: "desc" },
      take: 100, // Last 100 wastage records
    });

    // Calculate days until expiry and categorize
    const expiryReport = expiringItems.map((item) => {
      const daysUntilExpiry = Math.ceil(
        (new Date(item.expiryDate) - today) / (1000 * 60 * 60 * 24)
      );

      let urgency = "normal";
      if (daysUntilExpiry <= 7) urgency = "critical";
      else if (daysUntilExpiry <= 15) urgency = "warning";

      const itemValue =
        item.quantity *
        (item.purchasePrice + (item.purchasePrice * item.gstPercentage) / 100);

      return {
        itemId: item.id,
        itemName: item.itemName,
        itemCode: item.itemCode,
        category: item.category,
        warehouse: item.warehouse.name,
        quantity: item.quantity,
        expiryDate: item.expiryDate,
        daysUntilExpiry,
        urgency,
        estimatedValue: itemValue,
        uom: item.uom,
      };
    });

    // Calculate wastage summary
    const wastageByReason = {};
    let totalWastageValue = 0;

    wastageRecords.forEach((record) => {
      if (!wastageByReason[record.reason]) {
        wastageByReason[record.reason] = {
          count: 0,
          quantity: 0,
          items: [],
        };
      }

      wastageByReason[record.reason].count++;
      wastageByReason[record.reason].quantity += record.quantity;
      wastageByReason[record.reason].items.push({
        itemName: record.itemName,
        quantity: record.quantity,
        date: record.createdAt,
        notes: record.notes,
      });
    });

    const summary = {
      expiringItems: expiringItems.length,
      criticalItems: expiryReport.filter((i) => i.urgency === "critical").length,
      warningItems: expiryReport.filter((i) => i.urgency === "warning").length,
      totalExpiryValue: expiryReport.reduce((sum, i) => sum + i.estimatedValue, 0),
      totalWastageRecords: wastageRecords.length,
      wastageByReason: Object.entries(wastageByReason).map(([reason, data]) => ({
        reason,
        ...data,
      })),
    };

    res.status(200).json({
      success: true,
      data: {
        summary,
        expiryReport,
        wastageRecords: wastageRecords.slice(0, 20), // Return top 20 recent wastage
      },
    });
  } catch (error) {
    console.error("Error generating expiry & wastage report:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate expiry & wastage report",
      message: error.message,
    });
  }
};

// Get top-selling products report
const getTopSellingReport = async (req, res) => {
  try {
    const { startDate, endDate, warehouseId, limit = 20 } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: "Start date and end date are required",
      });
    }

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    // Get all sales-related stock decreases
    const filter = {
      adjustmentType: "decrease",
      adjustmentMethod: "sales_order",
      createdAt: {
        gte: start,
        lte: end,
      },
    };

    if (warehouseId && warehouseId !== "all") {
      filter.warehouseId = warehouseId;
    }

    const salesMovements = await prisma.stockAdjustment.findMany({
      where: filter,
    });

    // Aggregate by item
    const itemSales = {};
    salesMovements.forEach((sale) => {
      if (!itemSales[sale.itemId]) {
        itemSales[sale.itemId] = {
          itemId: sale.itemId,
          itemName: sale.itemName,
          category: sale.category,
          totalQuantitySold: 0,
          totalOrders: 0,
          warehouses: new Set(),
        };
      }

      itemSales[sale.itemId].totalQuantitySold += sale.quantity;
      itemSales[sale.itemId].totalOrders++;
      itemSales[sale.itemId].warehouses.add(sale.warehouseName);
    });

    // Convert to array and sort by quantity sold
    let topProducts = Object.values(itemSales)
      .map((item) => ({
        ...item,
        warehouses: Array.from(item.warehouses),
        averagePerOrder: (item.totalQuantitySold / item.totalOrders).toFixed(2),
      }))
      .sort((a, b) => b.totalQuantitySold - a.totalQuantitySold)
      .slice(0, parseInt(limit));

    // Get current stock for these items
    const itemIds = topProducts.map((p) => p.itemId);
    const currentStocks = await prisma.item.findMany({
      where: {
        id: { in: itemIds },
      },
      select: {
        id: true,
        quantity: true,
        status: true,
      },
    });

    const stockMap = {};
    currentStocks.forEach((stock) => {
      stockMap[stock.id] = stock;
    });

    topProducts = topProducts.map((product) => ({
      ...product,
      currentStock: stockMap[product.itemId]?.quantity || 0,
      stockStatus: stockMap[product.itemId]?.status || "unknown",
    }));

    const summary = {
      totalSalesMovements: salesMovements.length,
      totalQuantitySold: salesMovements.reduce((sum, s) => sum + s.quantity, 0),
      uniqueProductsSold: Object.keys(itemSales).length,
      dateRange: {
        start: startDate,
        end: endDate,
      },
    };

    res.status(200).json({
      success: true,
      data: {
        summary,
        topProducts,
      },
    });
  } catch (error) {
    console.error("Error generating top-selling products report:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate top-selling products report",
      message: error.message,
    });
  }
};

module.exports = {
  getDailyMovementReport,
  getEODClosingStockReport,
  getPeriodAnalytics,
  getInventoryValuationReport,
  getStockAvailabilityReport,
  getInventoryMovementReport,
  getExpiryWastageReport,
  getTopSellingReport,
};
