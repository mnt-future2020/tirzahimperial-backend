const { prisma } = require("../../config/database");

/**
 * Get all sales (POS + Online orders) for finance dashboard
 * GET /api/finance/sales
 */
const getAllSales = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      paymentStatus,
      orderType,
      financialYear,
      accountingPeriod,
      page = 1,
      limit = 50,
      sortBy = "saleDate",
      sortOrder = "desc",
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // Build filter conditions
    const dateFilter = {};
    if (startDate || endDate) {
      // Use createdAt for date filtering since saleDate might not exist in old orders
      dateFilter.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        dateFilter.createdAt.gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.createdAt.lte = end;
      }
    }

    const commonFilters = {
      ...dateFilter,
      ...(paymentStatus && { paymentStatus }),
      ...(financialYear && { financialYear }),
      ...(accountingPeriod && { accountingPeriod }),
    };

    // Fetch POS orders
    const posOrders =
      orderType === "online"
        ? []
        : await prisma.pOSOrder.findMany({
            where: commonFilters,
            include: { items: true },
            skip,
            take,
            orderBy: { [sortBy === 'saleDate' ? 'createdAt' : sortBy]: sortOrder },
          });

    // Fetch Online orders
    const onlineOrders =
      orderType === "pos"
        ? []
        : await prisma.onlineOrder.findMany({
            where: commonFilters,
            skip,
            take,
            orderBy: { [sortBy === 'saleDate' ? 'createdAt' : sortBy]: sortOrder },
          });

    // Transform to unified format
    const transformedPOS = posOrders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      invoiceNumber: order.invoiceNumber,
      orderType: "pos",
      source: "POS",
      customerId: order.customerId,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      customerPhone: order.customerPhone,
      subtotal: order.subtotal,
      tax: order.tax,
      taxRate: order.taxRate,
      discount: order.discount,
      total: order.total,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      accountingPeriod: order.accountingPeriod,
      financialYear: order.financialYear,
      saleDate: order.saleDate || order.createdAt, // Fallback to createdAt if saleDate is null
      createdAt: order.createdAt,
      itemCount: order.items.length,
      totalQuantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
    }));

    const transformedOnline = onlineOrders.map((order) => {
      const items = Array.isArray(order.items) ? order.items : [];
      return {
        id: order.id,
        orderNumber: order.orderNumber,
        invoiceNumber: order.invoiceNumber,
        orderType: "online",
        source: "Online",
        customerId: order.customerId,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        subtotal: order.subtotal,
        tax: order.tax,
        taxRate: order.taxRate,
        discount: order.discount,
        couponDiscount: order.couponDiscount,
        shippingCharge: order.shippingCharge,
        total: order.total,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
        accountingPeriod: order.accountingPeriod,
        financialYear: order.financialYear,
        saleDate: order.saleDate || order.createdAt, // Fallback to createdAt if saleDate is null
        createdAt: order.createdAt,
        itemCount: items.length,
        totalQuantity: items.reduce((sum, item) => sum + (item.quantity || 0), 0),
      };
    });

    // Combine and sort
    let allOrders = [...transformedPOS, ...transformedOnline];
    allOrders.sort((a, b) => {
      const aValue = a[sortBy];
      const bValue = b[sortBy];
      if (sortOrder === "desc") {
        return new Date(bValue) - new Date(aValue);
      }
      return new Date(aValue) - new Date(bValue);
    });

    // Get total counts
    const totalPOSCount =
      orderType === "online"
        ? 0
        : await prisma.pOSOrder.count({ where: commonFilters });
    const totalOnlineCount =
      orderType === "pos"
        ? 0
        : await prisma.onlineOrder.count({ where: commonFilters });
    const totalCount =
      orderType === "pos"
        ? totalPOSCount
        : orderType === "online"
        ? totalOnlineCount
        : totalPOSCount + totalOnlineCount;

    res.json({
      success: true,
      data: allOrders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / parseInt(limit)),
      },
      summary: {
        totalOrders: totalCount,
        posOrders: totalPOSCount,
        onlineOrders: totalOnlineCount,
        totalAmount: allOrders.reduce((sum, order) => sum + order.total, 0),
      },
    });
  } catch (error) {
    console.error("Error fetching sales data:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch sales data",
      message: error.message,
    });
  }
};

/**
 * Get sales summary/statistics
 * GET /api/finance/sales/summary
 */
const getSalesSummary = async (req, res) => {
  try {
    const { startDate, endDate, financialYear } = req.query;

    const dateFilter = {};
    if (startDate || endDate) {
      // Use createdAt for date filtering since saleDate might not exist in old orders
      dateFilter.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        dateFilter.createdAt.gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.createdAt.lte = end;
      }
    }

    const commonFilters = {
      ...dateFilter,
      ...(financialYear && { financialYear }),
    };

    // POS Sales Summary
    const posStats = await prisma.pOSOrder.aggregate({
      where: commonFilters,
      _sum: { total: true, subtotal: true, tax: true, discount: true },
      _count: { id: true },
    });

    const posOrders = await prisma.pOSOrder.findMany({
      where: commonFilters,
      include: { items: true },
    });

    const posQuantity = posOrders.reduce(
      (sum, order) =>
        sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0),
      0
    );

    // Online Sales Summary
    const onlineStats = await prisma.onlineOrder.aggregate({
      where: commonFilters,
      _sum: {
        total: true,
        subtotal: true,
        tax: true,
        discount: true,
        couponDiscount: true,
        shippingCharge: true,
      },
      _count: { id: true },
    });

    const onlineOrders = await prisma.onlineOrder.findMany({
      where: commonFilters,
    });

    const onlineQuantity = onlineOrders.reduce((sum, order) => {
      const items = Array.isArray(order.items) ? order.items : [];
      return sum + items.reduce((itemSum, item) => itemSum + (item.quantity || 0), 0);
    }, 0);

    res.json({
      success: true,
      data: {
        overview: {
          totalOrders: (posStats._count.id || 0) + (onlineStats._count.id || 0),
          totalAmount: (posStats._sum.total || 0) + (onlineStats._sum.total || 0),
          totalQuantity: posQuantity + onlineQuantity,
          totalTax: (posStats._sum.tax || 0) + (onlineStats._sum.tax || 0),
          totalDiscount:
            (posStats._sum.discount || 0) +
            (onlineStats._sum.discount || 0) +
            (onlineStats._sum.couponDiscount || 0),
        },
        posChannel: {
          orders: posStats._count.id || 0,
          totalAmount: posStats._sum.total || 0,
          quantity: posQuantity,
          tax: posStats._sum.tax || 0,
          discount: posStats._sum.discount || 0,
        },
        onlineChannel: {
          orders: onlineStats._count.id || 0,
          totalAmount: onlineStats._sum.total || 0,
          quantity: onlineQuantity,
          tax: onlineStats._sum.tax || 0,
          discount:
            (onlineStats._sum.discount || 0) + (onlineStats._sum.couponDiscount || 0),
          shippingCharge: onlineStats._sum.shippingCharge || 0,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching sales summary:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch sales summary",
      message: error.message,
    });
  }
};

/**
 * Get sales by financial year
 * GET /api/finance/sales/by-year
 */
const getSalesByFinancialYear = async (req, res) => {
  try {
    // Get all POS orders
    const posOrders = await prisma.pOSOrder.findMany({
      select: {
        financialYear: true,
        total: true,
      },
    });

    // Get all Online orders
    const onlineOrders = await prisma.onlineOrder.findMany({
      select: {
        financialYear: true,
        total: true,
      },
    });

    // Group by financial year
    const yearData = new Map();

    // Process POS orders
    posOrders.forEach((order) => {
      const year = order.financialYear || 'Unknown';
      if (!yearData.has(year)) {
        yearData.set(year, {
          financialYear: year,
          totalOrders: 0,
          totalAmount: 0,
          posOrders: 0,
          posAmount: 0,
          onlineOrders: 0,
          onlineAmount: 0,
        });
      }
      const data = yearData.get(year);
      data.totalOrders++;
      data.totalAmount += order.total;
      data.posOrders++;
      data.posAmount += order.total;
    });

    // Process Online orders
    onlineOrders.forEach((order) => {
      const year = order.financialYear || 'Unknown';
      if (!yearData.has(year)) {
        yearData.set(year, {
          financialYear: year,
          totalOrders: 0,
          totalAmount: 0,
          posOrders: 0,
          posAmount: 0,
          onlineOrders: 0,
          onlineAmount: 0,
        });
      }
      const data = yearData.get(year);
      data.totalOrders++;
      data.totalAmount += order.total;
      data.onlineOrders++;
      data.onlineAmount += order.total;
    });

    // Convert to array and sort by financial year (descending)
    const result = Array.from(yearData.values()).sort((a, b) => {
      if (a.financialYear === 'Unknown') return 1;
      if (b.financialYear === 'Unknown') return -1;
      return b.financialYear.localeCompare(a.financialYear);
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error fetching sales by financial year:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch sales by financial year",
      message: error.message,
    });
  }
};

/**
 * Get order details by ID and type
 * GET /api/finance/sales/:type/:id
 */
const getOrderDetails = async (req, res) => {
  try {
    const { type, id } = req.params;

    if (!['pos', 'online'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid order type. Must be "pos" or "online"',
      });
    }

    let order;
    if (type === 'pos') {
      order = await prisma.pOSOrder.findUnique({
        where: { id },
        include: {
          items: true,
        },
      });
    } else {
      order = await prisma.onlineOrder.findUnique({
        where: { id },
      });
    }

    if (!order) {
      return res.status(404).json({
        success: false,
        error: `${type.toUpperCase()} order not found`,
      });
    }

    // Transform to unified format with items
    const items = Array.isArray(order.items) ? order.items : [];
    
    // Calculate total tax from items if order.tax is 0 (for POS orders)
    let calculatedTax = order.tax || 0;
    if (type === 'pos' && calculatedTax === 0 && items.length > 0) {
      calculatedTax = items.reduce((sum, item) => sum + (item.gstAmount || 0), 0);
    }
    
    const transformedOrder = {
      id: order.id,
      orderNumber: order.orderNumber,
      invoiceNumber: order.invoiceNumber,
      orderType: type,
      source: type === 'pos' ? 'POS' : 'Online',
      customerId: order.customerId,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      customerPhone: order.customerPhone,
      ...(type === 'online' && order.deliveryAddress && {
        deliveryAddress: order.deliveryAddress,
      }),
      subtotal: order.subtotal,
      tax: calculatedTax,
      taxRate: order.taxRate,
      discount: order.discount,
      ...(type === 'pos' && {
        roundingOff: order.roundingOff,
        amountReceived: order.amountReceived,
        changeGiven: order.changeGiven,
        createdBy: order.createdBy,
      }),
      ...(type === 'online' && {
        couponCode: order.couponCode,
        couponDiscount: order.couponDiscount,
        shippingCharge: order.shippingCharge,
        gstType: order.gstType,
        cgstAmount: order.cgstAmount,
        sgstAmount: order.sgstAmount,
        igstAmount: order.igstAmount,
        totalGstAmount: order.totalGstAmount,
      }),
      total: order.total,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      paymentId: order.paymentId,
      orderStatus: order.orderStatus,
      accountingPeriod: order.accountingPeriod,
      financialYear: order.financialYear,
      saleDate: order.saleDate || order.createdAt,
      createdAt: order.createdAt,
      items: items.map(item => ({
        id: item.id,
        productId: item.productId,
        inventoryProductId: item.inventoryProductId,
        productName: item.productName,
        variantName: item.variantName,
        displayName: item.displayName,
        brand: item.brand,
        productImage: item.productImage,
        selectedCuttingStyle: item.selectedCuttingStyle,
        unitPrice: item.unitPrice || 0,
        mrp: item.mrp || 0,
        quantity: item.quantity || 0,
        discount: item.discount || 0,
        subtotal: item.subtotal || item.itemTotal || 0,
        itemTotal: item.itemTotal || item.subtotal || 0,
        totalAmount: item.totalAmount || item.total || item.totalPrice || 0,
        total: item.total || item.totalAmount || item.totalPrice || 0,
        totalPrice: item.totalPrice || item.total || item.totalAmount || 0,
        gstPercentage: item.gstPercentage || 0,
        gstAmount: item.gstAmount || item.totalGstAmount || 0,
        totalGstAmount: item.totalGstAmount || item.gstAmount || 0,
        cgstAmount: item.cgstAmount || 0,
        sgstAmount: item.sgstAmount || 0,
        igstAmount: item.igstAmount || 0,
        cgstPercentage: item.cgstPercentage || 0,
        sgstPercentage: item.sgstPercentage || 0,
        igstPercentage: item.igstPercentage || 0,
        priceBeforeGst: item.priceBeforeGst || item.itemTotal || item.unitPrice || 0,
        revenueAmount: item.revenueAmount || item.total || 0,
        // UOM fields for proper quantity display
        variantUom: item.variantUom || null,
        variantUomValue: item.variantUomValue || null,
      })),
      itemCount: items.length,
      totalQuantity: items.reduce((sum, item) => sum + (item.quantity || 0), 0),
    };

    res.json({
      success: true,
      data: transformedOrder,
    });
  } catch (error) {
    console.error('Error fetching order details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch order details',
      message: error.message,
    });
  }
};

module.exports = {
  getAllSales,
  getSalesSummary,
  getSalesByFinancialYear,
  getOrderDetails,
};
