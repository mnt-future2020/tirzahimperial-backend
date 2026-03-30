const { prisma } = require("../../config/database");

/**
 * Dashboard Controller - Comprehensive Implementation
 * Provides aggregated data from all backend services:
 * - Orders (POS + Online)
 * - Inventory (Items, Stock Adjustments, Warehouses)
 * - Finance (Transactions, Bills, Expenses)
 * - Purchase (Purchase Orders, Suppliers)
 * - Delivery (Deliveries, Partners)
 * - Customers (Analytics, Orders)
 */

/**
 * Get comprehensive dashboard data
 * GET /api/dashboard?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
const getDashboardData = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Parse dates with proper timezone handling
    // Helper function to parse date string in local timezone (not UTC)
    const parseLocalDate = (dateStr) => {
      const [year, month, day] = dateStr.split('-').map(Number);
      return new Date(year, month - 1, day);
    };
    
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    
    const start = startDate ? parseLocalDate(startDate) : (() => {
      const lastWeek = new Date();
      lastWeek.setDate(lastWeek.getDate() - 6);
      lastWeek.setHours(0, 0, 0, 0);
      return lastWeek;
    })();
    start.setHours(0, 0, 0, 0);
    
    const end = endDate ? parseLocalDate(endDate) : today;
    end.setHours(23, 59, 59, 999);

    // Calculate previous period for trend comparison
    const periodDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    const prevStart = new Date(start);
    prevStart.setDate(prevStart.getDate() - periodDays);
    prevStart.setHours(0, 0, 0, 0);
    
    const prevEnd = new Date(start);
    prevEnd.setMilliseconds(-1);

    console.log(`📊 Dashboard Data Request:`, {
      period: `${start.toISOString().split('T')[0]} to ${end.toISOString().split('T')[0]}`,
      periodDays,
      previousPeriod: `${prevStart.toISOString().split('T')[0]} to ${prevEnd.toISOString().split('T')[0]}`
    });

    // Fetch all data in parallel for optimal performance
    const [
      kpiCards,
      orderOperations,
      dailyInsights,
      deliveryPerformance,
      paymentFinance,
      warehouseAlerts,
      eodClosing
    ] = await Promise.all([
      getKPICards(start, end, prevStart, prevEnd),
      getOrderOperations(start, end),
      getDailyInsights(start, end),
      getDeliveryPerformance(start, end),
      getPaymentFinance(start, end),
      getWarehouseAlerts(),
      getEODClosing(end)
    ]);

    res.json({
      success: true,
      data: {
        kpiCards,
        orderOperations,
        dailyInsights,
        deliveryPerformance,
        paymentFinance,
        warehouseAlerts,
        eodClosing
      },
      meta: {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        periodDays,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("❌ Error fetching dashboard data:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch dashboard data",
      message: error.message
    });
  }
};

/**
 * Get KPI Cards Data with Comprehensive Metrics
 * Includes: Orders, Revenue, AOV, On-Time Delivery, Cancellations, Warehouse Status
 * Data Sources: POSOrder, OnlineOrder, Warehouse, Delivery
 */
async function getKPICards(startDate, endDate, prevStartDate, prevEndDate) {
  try {
    // Fetch current and previous period data in parallel
    const [
      currentPosOrders,
      currentOnlineOrders,
      prevPosOrders,
      prevOnlineOrders,
      warehouses,
      currentDeliveries,
      customers
    ] = await Promise.all([
      // Current POS Orders
      prisma.pOSOrder.findMany({
        where: {
          createdAt: { gte: startDate, lte: endDate },
          orderStatus: { not: 'cancelled' }
        },
        select: {
          total: true,
          orderStatus: true,
          createdAt: true,
          paymentStatus: true
        }
      }),
      // Current Online Orders
      prisma.onlineOrder.findMany({
        where: {
          createdAt: { gte: startDate, lte: endDate },
          orderStatus: { not: 'cancelled' }
        },
        select: {
          total: true,
          orderStatus: true,
          deliveredAt: true,
          shippedAt: true,
          createdAt: true,
          paymentStatus: true
        }
      }),
      // Previous POS Orders
      prisma.pOSOrder.findMany({
        where: {
          createdAt: { gte: prevStartDate, lte: prevEndDate },
          orderStatus: { not: 'cancelled' }
        },
        select: {
          total: true,
          orderStatus: true
        }
      }),
      // Previous Online Orders
      prisma.onlineOrder.findMany({
        where: {
          createdAt: { gte: prevStartDate, lte: prevEndDate },
          orderStatus: { not: 'cancelled' }
        },
        select: {
          total: true,
          orderStatus: true
        }
      }),
      // Warehouses
      prisma.warehouse.findMany({
        select: {
          status: true
        }
      }),
      // Current Deliveries for on-time calculation
      prisma.delivery.findMany({
        where: {
          status: 'delivered',
          deliveredAt: { gte: startDate, lte: endDate }
        },
        select: {
          assignedAt: true,
          deliveredAt: true
        }
      }),
      // Total customers
      prisma.customer.count()
    ]);

    // Current period calculations
    const currentOrders = [...currentPosOrders, ...currentOnlineOrders];
    const totalOrders = currentOrders.length;
    const totalRevenue = currentOrders.reduce((sum, order) => sum + (order.total || 0), 0);
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    
    // Count cancelled orders separately (not included in totalOrders)
    const [cancelledPosOrders, cancelledOnlineOrders] = await Promise.all([
      prisma.pOSOrder.count({
        where: {
          createdAt: { gte: startDate, lte: endDate },
          orderStatus: 'cancelled'
        }
      }),
      prisma.onlineOrder.count({
        where: {
          createdAt: { gte: startDate, lte: endDate },
          orderStatus: 'cancelled'
        }
      })
    ]);
    const cancelledOrders = cancelledPosOrders + cancelledOnlineOrders;

    // Previous period calculations for trends
    const prevOrders = [...prevPosOrders, ...prevOnlineOrders];
    const prevTotalOrders = prevOrders.length;
    const prevTotalRevenue = prevOrders.reduce((sum, order) => sum + (order.total || 0), 0);
    const prevAvgOrderValue = prevTotalOrders > 0 ? prevTotalRevenue / prevTotalOrders : 0;

    // Calculate trends (percentage change)
    const ordersTrend = prevTotalOrders > 0 
      ? ((totalOrders - prevTotalOrders) / prevTotalOrders) * 100 
      : totalOrders > 0 ? 100 : 0;
    
    const revenueTrend = prevTotalRevenue > 0 
      ? ((totalRevenue - prevTotalRevenue) / prevTotalRevenue) * 100 
      : totalRevenue > 0 ? 100 : 0;
    
    const avgOrderValueTrend = prevAvgOrderValue > 0 
      ? ((avgOrderValue - prevAvgOrderValue) / prevAvgOrderValue) * 100 
      : avgOrderValue > 0 ? 100 : 0;

    // Calculate on-time delivery percentage
    let onTimeDelivery = 0;
    if (currentDeliveries.length > 0) {
      const onTimeCount = currentDeliveries.filter(delivery => {
        if (!delivery.assignedAt || !delivery.deliveredAt) return false;
        const assignedDate = new Date(delivery.assignedAt);
        const deliveredDate = new Date(delivery.deliveredAt);
        const deliveryTime = (deliveredDate - assignedDate) / (1000 * 60 * 60 * 24); // days
        return deliveryTime <= 3; // Consider on-time if delivered within 3 days
      }).length;
      onTimeDelivery = (onTimeCount / currentDeliveries.length) * 100;
    }

    // Warehouse status
    const warehouseStatus = {
      total: warehouses.length,
      online: warehouses.filter(w => w.status === 'active').length,
      offline: warehouses.filter(w => w.status === 'inactive').length
    };

    console.log(`📊 KPI Cards: Orders=${totalOrders}, Revenue=₹${totalRevenue.toFixed(2)}, AOV=₹${avgOrderValue.toFixed(2)}, Cancelled=${cancelledOrders}`);

    return {
      todaysOrders: totalOrders,
      todaysRevenue: totalRevenue,
      avgOrderValue: avgOrderValue,
      onTimeDelivery: Math.round(onTimeDelivery * 10) / 10,
      cancelledOrders: cancelledOrders,
      warehouseStatus: warehouseStatus,
      totalCustomers: customers,
      trends: {
        orders: Math.round(ordersTrend * 10) / 10,
        revenue: Math.round(revenueTrend * 10) / 10,
        avgOrderValue: Math.round(avgOrderValueTrend * 10) / 10
      }
    };
  } catch (error) {
    console.error("❌ Error in getKPICards:", error);
    throw error;
  }
}

/**
 * Get Order Operations Data
 * Comprehensive order status breakdown from POS + Online orders
 * Data Sources: POSOrder, OnlineOrder
 */
async function getOrderOperations(startDate, endDate) {
  try {
    const [posOrders, onlineOrders] = await Promise.all([
      prisma.pOSOrder.findMany({
        where: {
          createdAt: { gte: startDate, lte: endDate }
        },
        select: {
          orderStatus: true,
          paymentStatus: true
        }
      }),
      prisma.onlineOrder.findMany({
        where: {
          createdAt: { gte: startDate, lte: endDate }
        },
        select: {
          orderStatus: true,
          paymentStatus: true
        }
      })
    ]);

    const allOrders = [...posOrders, ...onlineOrders];

    const operations = {
      pending: allOrders.filter(o => o.orderStatus === 'pending').length,
      confirmed: allOrders.filter(o => o.orderStatus === 'confirmed').length,
      packing: allOrders.filter(o => o.orderStatus === 'packing').length,
      shipped: allOrders.filter(o => o.orderStatus === 'shipped').length,
      delivered: allOrders.filter(o => o.orderStatus === 'delivered').length,
      cancelled: allOrders.filter(o => o.orderStatus === 'cancelled').length,
      completed: allOrders.filter(o => o.orderStatus === 'completed').length,
      // Additional metrics
      paymentPending: allOrders.filter(o => o.paymentStatus === 'pending').length,
      paymentCompleted: allOrders.filter(o => o.paymentStatus === 'completed').length,
      paymentFailed: allOrders.filter(o => o.paymentStatus === 'failed').length
    };

    console.log(`📦 Order Operations: Pending=${operations.pending}, Confirmed=${operations.confirmed}, Delivered=${operations.delivered}`);

    return operations;
  } catch (error) {
    console.error("❌ Error in getOrderOperations:", error);
    throw error;
  }
}

/**
 * Get Daily Insights Data with Inventory-based Top Items and Sales Time Series
 * Data Sources: StockAdjustment, InventoryCategory, Item, POSOrder, OnlineOrder
 */
async function getDailyInsights(startDate, endDate) {
  try {
    // Get stock adjustments for sales (decrease type) from the period
    const [stockAdjustments, categories, allOrders] = await Promise.all([
      prisma.stockAdjustment.findMany({
        where: {
          createdAt: { gte: startDate, lte: endDate },
          adjustmentType: 'decrease', // Sales reduce stock
          adjustmentMethod: 'sales_order' // Only sales-related adjustments
        },
        select: {
          itemName: true,
          quantity: true,
          category: true,
          itemId: true,
          createdAt: true
        }
      }),
      prisma.inventoryCategory.findMany({
        where: { isActive: true },
        select: { name: true }
      }),
      // Get orders for peak hours and sales analytics
      Promise.all([
        prisma.pOSOrder.findMany({
          where: { 
            createdAt: { gte: startDate, lte: endDate },
            orderStatus: { not: 'cancelled' }
          },
          select: { createdAt: true, total: true, items: true, saleDate: true }
        }),
        prisma.onlineOrder.findMany({
          where: { 
            createdAt: { gte: startDate, lte: endDate },
            orderStatus: { not: 'cancelled' }
          },
          select: { createdAt: true, total: true, items: true, saleDate: true }
        })
      ]).then(([pos, online]) => [...pos, ...online])
    ]);

    // Aggregate items by itemId to get accurate totals
    const itemMap = new Map();
    const categoryMap = new Map();
    
    stockAdjustments.forEach(adjustment => {
      const key = adjustment.itemId;
      if (!itemMap.has(key)) {
        itemMap.set(key, {
          name: adjustment.itemName,
          quantity: 0,
          revenue: 0,
          category: adjustment.category
        });
      }
      const existing = itemMap.get(key);
      existing.quantity += adjustment.quantity;
      
      // Aggregate by category
      if (adjustment.category) {
        if (!categoryMap.has(adjustment.category)) {
          categoryMap.set(adjustment.category, {
            name: adjustment.category,
            sales: 0,
            revenue: 0
          });
        }
        const catData = categoryMap.get(adjustment.category);
        catData.sales += adjustment.quantity;
      }
    });

    // Calculate revenue from orders for categories
    allOrders.forEach(order => {
      const items = Array.isArray(order.items) ? order.items : [];
      items.forEach(item => {
        const category = item.category || item.productName?.split(' ')[0] || 'Other';
        if (categoryMap.has(category)) {
          const catData = categoryMap.get(category);
          catData.revenue += (item.unitPrice || item.total || 0) * (item.quantity || 1);
        }
      });
    });

    // Get top items from stock adjustments
    let topItems = Array.from(itemMap.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);

    // If no stock adjustments found, get top items from current inventory
    if (topItems.length === 0) {
      const inventoryItems = await prisma.item.findMany({
        where: {
          status: { in: ['in_stock', 'low_stock'] }
        },
        select: {
          itemName: true,
          quantity: true,
          category: true,
          openingStock: true,
          sellingPrice: true
        },
        orderBy: {
          quantity: 'desc'
        },
        take: 10
      });

      topItems = inventoryItems.map(item => ({
        name: item.itemName,
        quantity: Math.max(0, item.openingStock - item.quantity), // Sold quantity
        revenue: (item.openingStock - item.quantity) * (item.sellingPrice || 0),
        category: item.category
      }));
    }

    // Get top categories
    const topCategories = Array.from(categoryMap.values())
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 5);

    // If no categories from stock adjustments, use default categories
    if (topCategories.length === 0) {
      topCategories.push(...categories.slice(0, 5).map(cat => ({
        name: cat.name,
        sales: 0,
        revenue: 0
      })));
    }

    // Calculate peak hours from orders
    const hourMap = new Map();
    allOrders.forEach(order => {
      const hour = new Date(order.createdAt).getHours();
      const hourKey = `${hour.toString().padStart(2, '0')}:00`;
      hourMap.set(hourKey, (hourMap.get(hourKey) || 0) + 1);
    });

    const peakHours = Array.from(hourMap.entries())
      .map(([hour, orders]) => ({ hour, orders }))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 6);

    // Generate sales time series data for SalesAnalytics chart
    const salesTimeSeries = generateSalesTimeSeries(allOrders, startDate, endDate);

    console.log(`📈 Daily Insights: Top Items=${topItems.length}, Top Categories=${topCategories.length}, Peak Hours=${peakHours.length}, Sales Data Points=${salesTimeSeries.length}`);

    return {
      topCategories: topCategories,
      topItems: topItems,
      peakHours: peakHours,
      salesTimeSeries: salesTimeSeries // NEW: Actual sales data over time
    };
  } catch (error) {
    console.error("❌ Error in getDailyInsights:", error);
    throw error;
  }
}

/**
 * Generate sales time series data based on date range
 * Returns daily data for ranges <= 30 days, monthly data for longer ranges
 */
function generateSalesTimeSeries(orders, startDate, endDate) {
  const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
  
  // Helper to format date in local timezone (YYYY-MM-DD)
  const formatLocalDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  if (daysDiff <= 30) {
    // Daily data for short ranges
    const dailyMap = new Map();
    
    // Initialize all days with 0
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dateKey = formatLocalDate(currentDate);
      dailyMap.set(dateKey, { date: dateKey, sales: 0, revenue: 0, orders: 0 });
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // Aggregate orders by day
    orders.forEach(order => {
      const orderDate = new Date(order.saleDate || order.createdAt);
      const dateKey = formatLocalDate(orderDate);
      
      if (dailyMap.has(dateKey)) {
        const dayData = dailyMap.get(dateKey);
        dayData.orders += 1;
        dayData.revenue += order.total || 0;
        
        // Count total items sold
        const items = Array.isArray(order.items) ? order.items : [];
        dayData.sales += items.reduce((sum, item) => sum + (item.quantity || 0), 0);
      }
    });
    
    return Array.from(dailyMap.values())
      .map(data => ({
        date: data.date,
        sales: data.sales,
        revenue: Math.round(data.revenue * 100) / 100,
        orders: data.orders
      }));
  } else {
    // Monthly data for longer ranges
    const monthlyMap = new Map();
    
    orders.forEach(order => {
      const orderDate = new Date(order.saleDate || order.createdAt);
      const monthKey = `${orderDate.getFullYear()}-${String(orderDate.getMonth() + 1).padStart(2, '0')}`;
      
      if (!monthlyMap.has(monthKey)) {
        monthlyMap.set(monthKey, { 
          period: monthKey, 
          sales: 0, 
          revenue: 0, 
          orders: 0 
        });
      }
      
      const monthData = monthlyMap.get(monthKey);
      monthData.orders += 1;
      monthData.revenue += order.total || 0;
      
      // Count total items sold
      const items = Array.isArray(order.items) ? order.items : [];
      monthData.sales += items.reduce((sum, item) => sum + (item.quantity || 0), 0);
    });
    
    return Array.from(monthlyMap.values())
      .sort((a, b) => a.period.localeCompare(b.period))
      .map(data => ({
        date: data.period,
        sales: data.sales,
        revenue: Math.round(data.revenue * 100) / 100,
        orders: data.orders
      }));
  }
}
      
    
/**
 * Get Delivery Performance Data
 * Data Sources: Delivery, DeliveryPartner
 */
async function getDeliveryPerformance(startDate, endDate) {
  try {
    const [deliveries, partners] = await Promise.all([
      prisma.delivery.findMany({
        where: {
          createdAt: { gte: startDate, lte: endDate }
        },
        select: {
          status: true,
          assignedAt: true,
          deliveredAt: true,
          pickedUpAt: true
        }
      }),
      prisma.deliveryPartner.findMany({
        where: {
          partnerStatus: 'active',
          isActive: true
        },
        select: {
          id: true,
          isAvailable: true,
          totalDeliveries: true
        }
      })
    ]);

    // Calculate average delivery time (from pickup to delivery)
    const deliveredOrders = deliveries.filter(d => 
      d.status === 'delivered' && d.pickedUpAt && d.deliveredAt
    );
    
    let avgDeliveryTime = 0;
    if (deliveredOrders.length > 0) {
      const totalTime = deliveredOrders.reduce((sum, d) => {
        const time = (new Date(d.deliveredAt).getTime() - new Date(d.pickedUpAt).getTime()) / (1000 * 60);
        return sum + time;
      }, 0);
      avgDeliveryTime = Math.round(totalTime / deliveredOrders.length);
    }

    // Count failed/cancelled deliveries
    const failedAttempts = deliveries.filter(d => 
      d.status === 'cancelled' || d.status === 'failed'
    ).length;

    // Count available riders
    const availableRiders = partners.filter(p => p.isAvailable).length;

    // Calculate delivery success rate
    const totalDeliveries = deliveries.length;
    const successfulDeliveries = deliveries.filter(d => d.status === 'delivered').length;
    const successRate = totalDeliveries > 0 
      ? Math.round((successfulDeliveries / totalDeliveries) * 100 * 10) / 10 
      : 0;

    console.log(`🚚 Delivery Performance: Avg Time=${avgDeliveryTime}min, Active Riders=${partners.length}, Success Rate=${successRate}%`);

    return {
      avgDeliveryTime: avgDeliveryTime,
      activeRiders: partners.length,
      availableRiders: availableRiders,
      totalDeliveries: totalDeliveries,
      successfulDeliveries: successfulDeliveries,
      failedAttempts: failedAttempts,
      successRate: successRate,
      // Status breakdown
      pending: deliveries.filter(d => d.status === 'pending').length,
      assigned: deliveries.filter(d => d.status === 'assigned').length,
      pickedUp: deliveries.filter(d => d.status === 'picked_up').length,
      inTransit: deliveries.filter(d => d.status === 'in_transit').length,
      delivered: successfulDeliveries
    };
  } catch (error) {
    console.error("❌ Error in getDeliveryPerformance:", error);
    return {
      avgDeliveryTime: 0,
      activeRiders: 0,
      availableRiders: 0,
      totalDeliveries: 0,
      successfulDeliveries: 0,
      failedAttempts: 0,
      successRate: 0,
      pending: 0,
      assigned: 0,
      pickedUp: 0,
      inTransit: 0,
      delivered: 0
    };
  }
}

/**
 * Get Payment & Finance Data with Comprehensive Financial Analysis
 * Data Sources: Transaction, Bill, Expense, POSOrder, OnlineOrder, PurchaseOrder
 */
async function getPaymentFinance(startDate, endDate) {
  try {
    // Get last 6 months of data for chart
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    // Fetch financial data from multiple sources in parallel
    const [bills, expenses, posOrders, onlineOrders, purchaseOrders] = await Promise.all([
      // Get bills for expenses
      prisma.bill.findMany({
        where: {
          createdAt: { gte: sixMonthsAgo },
          billStatus: 'completed'
        },
        select: {
          grandTotal: true,
          totalGST: true,
          totalDiscount: true,
          paymentStatus: true,
          billDate: true,
          createdAt: true,
          paidAmount: true
        }
      }),
      // Get other expenses
      prisma.expense.findMany({
        where: {
          createdAt: { gte: sixMonthsAgo },
          status: { in: ['pending', 'paid'] }
        },
        select: {
          amount: true,
          status: true,
          expenseDate: true,
          createdAt: true,
          categoryName: true
        }
      }),
      // Get POS orders for revenue
      prisma.pOSOrder.findMany({
        where: {
          createdAt: { gte: sixMonthsAgo },
          orderStatus: { not: 'cancelled' }
        },
        select: {
          total: true,
          tax: true,
          discount: true,
          paymentMethod: true,
          paymentStatus: true,
          accountingPeriod: true,
          createdAt: true,
          saleDate: true
        }
      }),
      // Get Online orders for revenue
      prisma.onlineOrder.findMany({
        where: {
          createdAt: { gte: sixMonthsAgo },
          orderStatus: { not: 'cancelled' }
        },
        select: {
          total: true,
          tax: true,
          discount: true,
          couponDiscount: true,
          shippingCharge: true,
          paymentMethod: true,
          paymentStatus: true,
          accountingPeriod: true,
          createdAt: true,
          saleDate: true
        }
      }),
      // Get purchase orders for cost analysis
      prisma.purchaseOrder.findMany({
        where: {
          createdAt: { gte: sixMonthsAgo },
          poStatus: 'completed'
        },
        select: {
          grandTotal: true,
          totalGST: true,
          poDate: true,
          createdAt: true
        }
      })
    ]);

    // Combine all revenue sources
    const allOrders = [...posOrders, ...onlineOrders];

    // Group by month with comprehensive aggregation
    const monthlyDataMap = new Map();
    
    // Process orders for revenue
    allOrders.forEach(order => {
      const date = order.saleDate || order.createdAt;
      const period = order.accountingPeriod || `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const [year, month] = period.split('-');
      
      if (!monthlyDataMap.has(period)) {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        monthlyDataMap.set(period, {
          period,
          month: monthNames[parseInt(month) - 1] || month,
          year: parseInt(year),
          revenue: 0,
          expenses: 0,
          orders: 0,
          tax: 0,
          discount: 0,
          netRevenue: 0,
          profit: 0,
          purchaseCost: 0
        });
      }
      
      const monthData = monthlyDataMap.get(period);
      const orderTotal = order.total || 0;
      const orderTax = order.tax || 0;
      const orderDiscount = (order.discount || 0) + (order.couponDiscount || 0);
      
      monthData.revenue += orderTotal;
      monthData.orders += 1;
      monthData.tax += orderTax;
      monthData.discount += orderDiscount;
    });

    // Process bills for expenses
    bills.forEach(bill => {
      const date = bill.billDate || bill.createdAt;
      const period = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (monthlyDataMap.has(period)) {
        const monthData = monthlyDataMap.get(period);
        monthData.expenses += bill.grandTotal || 0;
      }
    });

    // Process other expenses
    expenses.forEach(expense => {
      const date = expense.expenseDate || expense.createdAt;
      const period = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (monthlyDataMap.has(period)) {
        const monthData = monthlyDataMap.get(period);
        monthData.expenses += expense.amount || 0;
      }
    });

    // Process purchase orders for cost tracking
    purchaseOrders.forEach(po => {
      const date = po.poDate || po.createdAt;
      const period = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (monthlyDataMap.has(period)) {
        const monthData = monthlyDataMap.get(period);
        monthData.purchaseCost += po.grandTotal || 0;
      }
    });

    // Calculate net revenue and profit for each month
    monthlyDataMap.forEach((monthData) => {
      monthData.netRevenue = monthData.revenue - monthData.tax - monthData.discount;
      monthData.profit = monthData.netRevenue - monthData.expenses;
    });

    const monthlyData = Array.from(monthlyDataMap.values())
      .sort((a, b) => a.period.localeCompare(b.period))
      .slice(-6); // Last 6 months

    // Calculate payment split for selected date range
    const filteredOrders = allOrders.filter(o => {
      const orderDate = new Date(o.createdAt);
      return orderDate >= startDate && orderDate <= endDate;
    });

    const codOrders = filteredOrders.filter(o => 
      o.paymentMethod === 'cod' || o.paymentMethod === 'cash'
    );
    const prepaidOrders = filteredOrders.filter(o => 
      o.paymentMethod !== 'cod' && o.paymentMethod !== 'cash'
    );

    const codAmount = codOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    const prepaidAmount = prepaidOrders.reduce((sum, o) => sum + (o.total || 0), 0);

    const pendingCOD = codOrders
      .filter(o => o.paymentStatus === 'pending')
      .reduce((sum, o) => sum + (o.total || 0), 0);

    const failedPayments = filteredOrders.filter(o => 
      o.paymentStatus === 'failed'
    ).length;

    // Count refunds pending
    const refundsPending = filteredOrders.filter(o => 
      o.paymentStatus === 'refunded' || o.paymentStatus === 'refund_pending'
    ).length;

    // Calculate period totals
    const totalRevenue = filteredOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    const totalTax = filteredOrders.reduce((sum, o) => sum + (o.tax || 0), 0);
    const totalDiscount = filteredOrders.reduce((sum, o) => 
      sum + (o.discount || 0) + (o.couponDiscount || 0), 0
    );

    // Calculate expenses for the period
    const periodBills = bills.filter(b => {
      const billDate = new Date(b.createdAt);
      return billDate >= startDate && billDate <= endDate;
    });
    const periodExpenses = expenses.filter(e => {
      const expenseDate = new Date(e.createdAt);
      return expenseDate >= startDate && expenseDate <= endDate;
    });

    const totalExpenses = periodBills.reduce((sum, b) => sum + (b.grandTotal || 0), 0) +
                         periodExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);

    const netRevenue = totalRevenue - totalTax - totalDiscount;
    const profit = netRevenue - totalExpenses;

    // Calculate outstanding payments
    const outstandingBills = bills.filter(b => 
      b.paymentStatus === 'unpaid' || b.paymentStatus === 'partial'
    ).reduce((sum, b) => sum + (b.grandTotal - (b.paidAmount || 0)), 0);

    console.log(`💰 Payment Finance: Revenue=₹${totalRevenue.toFixed(2)}, Expenses=₹${totalExpenses.toFixed(2)}, Profit=₹${profit.toFixed(2)}`);

    return {
      paymentSplit: {
        cod: codOrders.length,
        prepaid: prepaidOrders.length,
        codAmount: codAmount,
        prepaidAmount: prepaidAmount
      },
      pendingCOD: pendingCOD,
      failedPayments: failedPayments,
      refundsPending: refundsPending,
      outstandingBills: outstandingBills,
      monthlyData: monthlyData,
      summary: {
        totalRevenue,
        totalTax,
        totalDiscount,
        netRevenue,
        totalExpenses,
        profit,
        profitMargin: totalRevenue > 0 ? ((profit / totalRevenue) * 100).toFixed(2) : 0
      }
    };
  } catch (error) {
    console.error("❌ Error in getPaymentFinance:", error);
    throw error;
  }
}

/**
 * Get Warehouse Alerts Data
 * Data Sources: Item, Warehouse, StockAdjustment
 */
async function getWarehouseAlerts() {
  try {
    const [items, warehouses, recentAdjustments] = await Promise.all([
      prisma.item.findMany({
        select: {
          status: true,
          expiryDate: true,
          quantity: true,
          lowStockAlertLevel: true,
          itemName: true
        }
      }),
      prisma.warehouse.findMany({
        select: {
          status: true,
          name: true
        }
      }),
      // Get recent stock adjustments for mismatch detection
      prisma.stockAdjustment.findMany({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
          }
        },
        select: {
          adjustmentType: true,
          reason: true
        }
      })
    ]);

    // Count out of stock items
    const outOfStock = items.filter(i => i.status === 'out_of_stock').length;
    
    // Count low stock items
    const lowStock = items.filter(i => i.status === 'low_stock').length;

    // Check expiring items (next 30 days)
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    
    const expiringItems = items.filter(i => 
      i.expiryDate && 
      new Date(i.expiryDate) <= thirtyDaysFromNow &&
      new Date(i.expiryDate) > new Date()
    ).length;

    // Count inventory mismatches (corrections in last 7 days)
    const inventoryMismatch = recentAdjustments.filter(adj => 
      adj.reason === 'correction' || adj.reason === 'found' || adj.reason === 'loss'
    ).length;

    // Count critical stock items (quantity below alert level)
    const criticalStock = items.filter(i => 
      i.quantity > 0 && i.quantity <= i.lowStockAlertLevel
    ).length;

    // Count inactive warehouses
    const inactiveWarehouses = warehouses.filter(w => w.status === 'inactive').length;

    console.log(`⚠️ Warehouse Alerts: Out of Stock=${outOfStock}, Low Stock=${lowStock}, Expiring=${expiringItems}`);

    return {
      outOfStock: outOfStock,
      lowStockAlerts: lowStock,
      expiringItems: expiringItems,
      inventoryMismatch: inventoryMismatch,
      criticalStock: criticalStock,
      inactiveWarehouses: inactiveWarehouses,
      totalAlerts: outOfStock + lowStock + expiringItems + inventoryMismatch
    };
  } catch (error) {
    console.error("❌ Error in getWarehouseAlerts:", error);
    throw error;
  }
}

/**
 * Get EOD (End of Day) Closing Data with Stock Information
 * Data Sources: POSOrder, OnlineOrder, Item
 */
async function getEODClosing(endDate) {
  try {
    const startOfDay = new Date(endDate);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(endDate);
    endOfDay.setHours(23, 59, 59, 999);

    const [posOrders, onlineOrders, items, stockSummary] = await Promise.all([
      // Get POS orders for the day
      prisma.pOSOrder.findMany({
        where: {
          createdAt: { gte: startOfDay, lte: endOfDay },
          orderStatus: { not: 'cancelled' }
        },
        select: {
          total: true,
          orderStatus: true,
          paymentMethod: true,
          items: true
        }
      }),
      // Get Online orders for the day
      prisma.onlineOrder.findMany({
        where: {
          createdAt: { gte: startOfDay, lte: endOfDay },
          orderStatus: { not: 'cancelled' }
        },
        select: {
          total: true,
          orderStatus: true,
          paymentMethod: true,
          items: true
        }
      }),
      // Get inventory items
      prisma.item.findMany({
        select: {
          quantity: true,
          sellingPrice: true,
          status: true
        }
      }),
      // Get stock summary by status
      prisma.item.groupBy({
        by: ['status'],
        _count: {
          id: true
        },
        _sum: {
          quantity: true
        }
      })
    ]);

    const allOrders = [...posOrders, ...onlineOrders];

    // Calculate total cash collected (cash + COD payments)
    const totalCash = allOrders
      .filter(o => o.paymentMethod === 'cash' || o.paymentMethod === 'cod')
      .reduce((sum, order) => sum + (order.total || 0), 0);
    
    // Calculate total sales for the day
    const totalSales = allOrders.reduce((sum, o) => sum + (o.total || 0), 0);

    // Calculate total items sold
    const totalItemsSold = allOrders.reduce((sum, order) => {
      const items = Array.isArray(order.items) ? order.items : [];
      return sum + items.reduce((itemSum, item) => itemSum + (item.quantity || 0), 0);
    }, 0);

    // Count completed orders
    const completedOrders = allOrders.filter(o => 
      o.orderStatus === 'completed' || o.orderStatus === 'delivered'
    ).length;

    // Calculate closing stock value
    const closingStockValue = items.reduce((sum, item) => {
      const price = item.sellingPrice || 0;
      const quantity = item.quantity || 0;
      return sum + (quantity * price);
    }, 0);

    const totalStockItems = items.length;
    const totalStockQuantity = items.reduce((sum, item) => sum + (item.quantity || 0), 0);

    // Stock status breakdown
    const stockByStatus = {
      inStock: stockSummary.find(s => s.status === 'in_stock')?._count.id || 0,
      lowStock: stockSummary.find(s => s.status === 'low_stock')?._count.id || 0,
      outOfStock: stockSummary.find(s => s.status === 'out_of_stock')?._count.id || 0,
      inStockQty: stockSummary.find(s => s.status === 'in_stock')?._sum.quantity || 0,
      lowStockQty: stockSummary.find(s => s.status === 'low_stock')?._sum.quantity || 0,
    };

    // Check if ready to close
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    const isFutureDate = endOfDay > now;
    const readyToClose = !isFutureDate && allOrders.length > 0;

    console.log(`🔒 EOD Closing: Cash=₹${totalCash.toFixed(2)}, Sales=₹${totalSales.toFixed(2)}, Stock Value=₹${closingStockValue.toFixed(2)}, Ready=${readyToClose}`);

    return {
      dailyThroughput: totalItemsSold,
      totalCash: totalCash,
      totalSales: totalSales,
      totalItems: totalStockItems,
      totalStockQuantity: totalStockQuantity,
      closingStockValue: closingStockValue,
      completedOrders: completedOrders,
      readyToClose: readyToClose,
      stockByStatus: stockByStatus
    };
  } catch (error) {
    console.error("❌ Error in getEODClosing:", error);
    throw error;
  }
}

module.exports = {
  getDashboardData
};
