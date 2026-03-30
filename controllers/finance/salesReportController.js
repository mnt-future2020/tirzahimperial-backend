const { prisma } = require("../../config/database");

/**
 * Sales Summary Report - Combined POS + Online
 * GET /api/finance/reports/sales-summary
 */
const getSalesSummaryReport = async (req, res) => {
  try {
    const { startDate, endDate, financialYear, paymentStatus, orderType } = req.query;

    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.saleDate = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        dateFilter.saleDate.gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.saleDate.lte = end;
      }
    }

    const commonFilters = {
      ...dateFilter,
      ...(financialYear && financialYear !== "all" && { financialYear }),
      ...(paymentStatus && paymentStatus !== "all" && { paymentStatus }),
      orderStatus: { not: "cancelled" },
    };

    // Fetch POS orders
    const posOrders =
      orderType === "online"
        ? []
        : await prisma.pOSOrder.findMany({
            where: commonFilters,
            include: { items: true },
            orderBy: { saleDate: "desc" },
          });

    // Fetch Online orders
    const onlineOrders =
      orderType === "pos"
        ? []
        : await prisma.onlineOrder.findMany({
            where: commonFilters,
            orderBy: { saleDate: "desc" },
          });

    // Transform to unified format
    const transformedPOS = posOrders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      invoiceNumber: order.invoiceNumber,
      orderType: "pos",
      source: "POS",
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      saleDate: order.saleDate,
      subtotal: order.subtotal,
      tax: order.tax,
      discount: order.discount,
      total: order.total,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      financialYear: order.financialYear,
      accountingPeriod: order.accountingPeriod,
      itemCount: order.items.length,
    }));

    const transformedOnline = onlineOrders.map((order) => {
      const items = Array.isArray(order.items) ? order.items : [];
      return {
        id: order.id,
        orderNumber: order.orderNumber,
        invoiceNumber: order.invoiceNumber,
        orderType: "online",
        source: "Online",
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        saleDate: order.saleDate,
        subtotal: order.subtotal,
        tax: order.tax,
        discount: order.discount,
        couponDiscount: order.couponDiscount,
        shippingCharge: order.shippingCharge,
        total: order.total,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
        financialYear: order.financialYear,
        accountingPeriod: order.accountingPeriod,
        itemCount: items.length,
      };
    });

    const allSales = [...transformedPOS, ...transformedOnline];

    // Calculate summary
    const summary = {
      totalOrders: allSales.length,
      posOrders: transformedPOS.length,
      onlineOrders: transformedOnline.length,
      totalAmount: allSales.reduce((sum, sale) => sum + sale.total, 0),
      totalTax: allSales.reduce((sum, sale) => sum + sale.tax, 0),
      totalDiscount: allSales.reduce(
        (sum, sale) => sum + (sale.discount + (sale.couponDiscount || 0)),
        0
      ),
    };

    res.json({
      success: true,
      data: {
        summary,
        sales: allSales,
      },
    });
  } catch (error) {
    console.error("Error generating sales summary report:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate sales summary report",
      message: error.message,
    });
  }
};

/**
 * POS Sales Report
 * GET /api/finance/reports/pos-sales
 */
const getPosSalesReport = async (req, res) => {
  try {
    const { startDate, endDate, financialYear, paymentMethod } = req.query;

    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.saleDate = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        dateFilter.saleDate.gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.saleDate.lte = end;
      }
    }

    const filters = {
      ...dateFilter,
      ...(financialYear && financialYear !== "all" && { financialYear }),
      ...(paymentMethod && paymentMethod !== "all" && { paymentMethod }),
    };

    const posOrders = await prisma.pOSOrder.findMany({
      where: filters,
      include: { items: true },
      orderBy: { saleDate: "desc" },
    });

    const summary = {
      totalOrders: posOrders.length,
      totalAmount: posOrders.reduce((sum, order) => sum + order.total, 0),
      totalTax: posOrders.reduce((sum, order) => sum + order.tax, 0),
      totalDiscount: posOrders.reduce((sum, order) => sum + order.discount, 0),
    };

    res.json({
      success: true,
      data: {
        summary,
        sales: posOrders,
      },
    });
  } catch (error) {
    console.error("Error generating POS sales report:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate POS sales report",
      message: error.message,
    });
  }
};

/**
 * Online Sales Report
 * GET /api/finance/reports/online-sales
 */
const getOnlineSalesReport = async (req, res) => {
  try {
    const { startDate, endDate, financialYear, paymentStatus } = req.query;

    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.saleDate = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        dateFilter.saleDate.gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.saleDate.lte = end;
      }
    }

    const filters = {
      ...dateFilter,
      ...(financialYear && financialYear !== "all" && { financialYear }),
      ...(paymentStatus && paymentStatus !== "all" && { paymentStatus }),
      orderStatus: { not: "cancelled" },
    };

    const onlineOrders = await prisma.onlineOrder.findMany({
      where: filters,
      orderBy: { saleDate: "desc" },
    });

    const summary = {
      totalOrders: onlineOrders.length,
      totalAmount: onlineOrders.reduce((sum, order) => sum + order.total, 0),
      totalTax: onlineOrders.reduce((sum, order) => sum + order.tax, 0),
      totalDiscount: onlineOrders.reduce(
        (sum, order) => sum + order.discount + (order.couponDiscount || 0),
        0
      ),
      totalShipping: onlineOrders.reduce(
        (sum, order) => sum + (order.shippingCharge || 0),
        0
      ),
    };

    res.json({
      success: true,
      data: {
        summary,
        sales: onlineOrders,
      },
    });
  } catch (error) {
    console.error("Error generating online sales report:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate online sales report",
      message: error.message,
    });
  }
};

module.exports = {
  getSalesSummaryReport,
  getPosSalesReport,
  getOnlineSalesReport,
};
