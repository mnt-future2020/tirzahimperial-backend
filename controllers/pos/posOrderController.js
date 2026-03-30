const { prisma } = require("../../config/database");
const { updateStockAfterOrder } = require("../../utils/inventory/stockUpdateService");
const { getFinancialPeriod } = require("../../utils/finance/financialPeriod");
const { createPOSTransaction } = require("../../utils/finance/transactionService");
const { generateInvoiceNumber } = require("../../utils/order/invoiceGenerator");

/**
 * Update customer analytics (total orders, total spent, last order date)
 */
const updateCustomerAnalytics = async (customerId, orderTotal, orderDate) => {
  try {
    // Find customer in Customer collection
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      console.log(`⚠️ Customer not found in Customer collection: ${customerId}`);
      return;
    }

    // Update customer analytics
    await prisma.customer.update({
      where: { id: customerId },
      data: {
        totalOrders: customer.totalOrders + 1,
        totalSpent: customer.totalSpent + orderTotal,
        lastOrderDate: orderDate ? new Date(orderDate) : new Date(),
        updatedAt: new Date(),
      },
    });

    console.log(`📊 Customer analytics updated: ${customer.name} - Orders: ${customer.totalOrders + 1}, Spent: ₹${(customer.totalSpent + orderTotal).toFixed(2)}`);
  } catch (error) {
    console.error("❌ Error updating customer analytics:", error);
    throw error;
  }
};

// Generate unique order number
const generateOrderNumber = () => {
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `POS-${timestamp}-${random}`;
};

// Create POS Order (Direct save in monolith)
const createPOSOrder = async (req, res) => {
  try {
    const {
      customer,
      items,
      subtotal,
      tax,
      taxRate,
      discount = 0,
      roundingOff = 0,
      total,
      paymentMethod,
      amountReceived,
      changeGiven = 0,
      createdBy,
    } = req.body;

    // Validation
    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Order must contain at least one item",
      });
    }

    if (!paymentMethod) {
      return res.status(400).json({
        success: false,
        message: "Payment method is required",
      });
    }

    // Generate order number and invoice number
    const orderNumber = generateOrderNumber();
    const invoiceResult = await generateInvoiceNumber();
    const invoiceNumber = invoiceResult?.invoiceNumber || null;

    // Get financial period for the order
    const { financialYear, accountingPeriod } = await getFinancialPeriod(new Date());

    // Prepare order items
    const orderItems = items.map((item) => {
      const itemSubtotal = item.unitPrice * item.quantity;
      const discountAmount = item.discount
        ? (itemSubtotal * item.discount) / 100
        : 0;
      const itemTotal = itemSubtotal - discountAmount;

      // Calculate GST breakdown
      const gstPercentage = item.gstPercentage || 0;
      const priceBeforeGst = itemTotal / (1 + gstPercentage / 100);
      const gstAmount = itemTotal - priceBeforeGst;

      // Extract barcodes - handle both single barcode and array
      let barcodes = [];
      if (item.barcode) {
        barcodes = Array.isArray(item.barcode) ? item.barcode : [item.barcode];
      } else if (item.barcodes && Array.isArray(item.barcodes)) {
        barcodes = item.barcodes;
      }

      return {
        productId: item.productId,
        productName: item.productName,
        productSku: item.productSku || null,
        barcodes: barcodes, // Save barcodes array
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        discount: item.discount || 0,
        subtotal: itemSubtotal,
        total: itemTotal,
        gstPercentage: gstPercentage,
        gstAmount: gstAmount,
        priceBeforeGst: priceBeforeGst,
        // Multi-UOM fields for stock deduction
        variantUom: item.variantUom || null,
        variantUomValue: item.variantUomValue || null,
      };
    });

    // Save order in backend database
    console.log(`📝 Creating POS order ${orderNumber} with invoice ${invoiceNumber || 'N/A'}...`);
    const order = await prisma.pOSOrder.create({
      data: {
        orderNumber,
        invoiceNumber,
        orderType: "pos",
        customerId: customer?.id || null,
        customerName: customer?.name || null,
        customerEmail: customer?.email || null,
        customerPhone: customer?.phone || null,
        subtotal,
        tax,
        taxRate,
        discount,
        roundingOff,
        total,
        paymentMethod,
        paymentStatus: "completed",
        amountReceived,
        changeGiven,
        orderStatus: "completed",
        createdBy: createdBy || null,
        completedAt: new Date(),
        saleDate: new Date(),
        accountingPeriod,
        financialYear,
        items: {
          create: orderItems,
        },
      },
      include: {
        items: true,
      },
    });

    console.log(`✅ POS Order created: ${order.orderNumber}`);

    // Create transaction record
    try {
      await createPOSTransaction(order);
    } catch (transactionError) {
      console.error(`⚠️ Failed to create transaction:`, transactionError.message);
      // Order is still created, transaction creation failure is logged
    }

    // Update customer analytics if customer exists
    if (customer?.id) {
      try {
        await updateCustomerAnalytics(customer.id, total, order.completedAt);
        console.log(`📊 Customer analytics updated for ${customer.name}`);
      } catch (analyticsError) {
        console.error(`⚠️ Failed to update customer analytics:`, analyticsError.message);
        // Order is still created, analytics update failure is logged
      }
    }

    // Update inventory stock for each item using centralized stock update service
    try {
      const stockUpdateResults = await updateStockAfterOrder(order, "POS_ORDER");
      const successCount = stockUpdateResults.filter((r) => r.success).length;
      console.log(`📦 Stock updated for ${successCount}/${stockUpdateResults.length} items`);
    } catch (stockError) {
      console.error(`⚠️ Failed to update stock:`, stockError.message);
      // Order is still created, stock update failure is logged
    }

    // Send POS order notification to all admins
    try {
      const { sendToAllAdmins } = require('../../utils/notification/sendNotification');
      
      const adminNotification = {
        title: '🏪 New POS Order!',
        body: `POS Order from ${customer?.name || 'Walk-in Customer'}\n\n📦 Order #${order.orderNumber}\n💰 Amount: ₹${total.toFixed(2)}\n💳 Payment: ${paymentMethod.toUpperCase()}`,
      };

      const adminData = {
        type: 'NEW_POS_ORDER',
        orderNumber: order.orderNumber,
        orderId: order.id,
        customerName: customer?.name || 'Walk-in Customer',
        total: total.toString(),
        paymentMethod: paymentMethod,
        link: `/dashboard/order-management/pos-orders/${order.id}`,
        urgency: 'normal',
        vibrate: [200, 100, 200],
        requireInteraction: false,
        color: '#FF9800',
        backgroundColor: '#FFF3E0',
      };

      await sendToAllAdmins(adminNotification, adminData);
      console.log(`📱 POS order notification sent to all admins`);
    } catch (adminNotifError) {
      console.error(`⚠️ Failed to send admin notification:`, adminNotifError.message);
    }

    res.status(201).json({
      success: true,
      message: "POS order created successfully",
      data: order,
    });
  } catch (error) {
    console.error("Error creating POS order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create POS order",
      error: error.message,
    });
  }
};

// Get all POS orders
const getPOSOrders = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      orderStatus,
      paymentMethod,
      startDate,
      endDate,
      search,
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = {};

    if (orderStatus) {
      where.orderStatus = orderStatus;
    }

    if (paymentMethod) {
      where.paymentMethod = paymentMethod;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate);
      }
    }

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: "insensitive" } },
        { invoiceNumber: { contains: search, mode: "insensitive" } },
        { customerName: { contains: search, mode: "insensitive" } },
        { customerPhone: { contains: search } },
      ];
    }

    const [orders, total] = await Promise.all([
      prisma.pOSOrder.findMany({
        where,
        include: {
          items: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        skip,
        take: parseInt(limit),
      }),
      prisma.pOSOrder.count({ where }),
    ]);

    res.json({
      success: true,
      data: orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching POS orders:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch POS orders",
      error: error.message,
    });
  }
};

// Get single POS order by ID
const getPOSOrderById = async (req, res) => {
  try {
    const { id } = req.params;

    const order = await prisma.pOSOrder.findUnique({
      where: { id },
      include: {
        items: true,
      },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    res.json({
      success: true,
      data: order,
    });
  } catch (error) {
    console.error("Error fetching POS order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch POS order",
      error: error.message,
    });
  }
};

// Get POS order by order number
const getPOSOrderByOrderNumber = async (req, res) => {
  try {
    const { orderNumber } = req.params;

    const order = await prisma.pOSOrder.findUnique({
      where: { orderNumber },
      include: {
        items: true,
      },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    res.json({
      success: true,
      data: order,
    });
  } catch (error) {
    console.error("Error fetching POS order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch POS order",
      error: error.message,
    });
  }
};

// Get POS orders by date range
const getPOSOrdersByDateRange = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Start date and end date are required",
      });
    }

    const orders = await prisma.pOSOrder.findMany({
      where: {
        createdAt: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      },
      include: {
        items: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json({
      success: true,
      data: orders,
      count: orders.length,
    });
  } catch (error) {
    console.error("Error fetching POS orders by date range:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch POS orders",
      error: error.message,
    });
  }
};

// Get POS order statistics
const getPOSOrderStats = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const where = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate);
      }
    }

    const [
      totalOrders,
      completedOrders,
      cancelledOrders,
      totalRevenue,
      cashOrders,
      cardOrders,
      upiOrders,
    ] = await Promise.all([
      prisma.pOSOrder.count({ where }),
      prisma.pOSOrder.count({ where: { ...where, orderStatus: "completed" } }),
      prisma.pOSOrder.count({ where: { ...where, orderStatus: "cancelled" } }),
      prisma.pOSOrder.aggregate({
        where: { ...where, orderStatus: "completed" },
        _sum: { total: true },
      }),
      prisma.pOSOrder.count({ where: { ...where, paymentMethod: "cash" } }),
      prisma.pOSOrder.count({ where: { ...where, paymentMethod: "card" } }),
      prisma.pOSOrder.count({ where: { ...where, paymentMethod: "upi" } }),
    ]);

    res.json({
      success: true,
      data: {
        totalOrders,
        completedOrders,
        cancelledOrders,
        totalRevenue: totalRevenue._sum.total || 0,
        paymentMethods: {
          cash: cashOrders,
          card: cardOrders,
          upi: upiOrders,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching POS order stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch POS order statistics",
      error: error.message,
    });
  }
};

// Get customer from User collection
const getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        phoneNumber: true,
        address: true,
        city: true,
        state: true,
        zipCode: true,
        country: true,
      },
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    res.json({
      success: true,
      data: customer,
    });
  } catch (error) {
    console.error("Error fetching customer:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch customer",
      error: error.message,
    });
  }
};

// Search customers from User collection
const searchCustomers = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim() === "") {
      return res.json({
        success: true,
        data: [],
      });
    }

    const customers = await prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { phoneNumber: { contains: q } },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        phoneNumber: true,
        address: true,
        city: true,
        state: true,
        zipCode: true,
        country: true,
      },
      take: 20,
      orderBy: { name: "asc" },
    });

    res.json({
      success: true,
      data: customers,
    });
  } catch (error) {
    console.error("Error searching customers:", error);
    res.status(500).json({
      success: false,
      message: "Failed to search customers",
      error: error.message,
    });
  }
};

module.exports = {
  createPOSOrder,
  getPOSOrders,
  getPOSOrderById,
  getPOSOrderByOrderNumber,
  getPOSOrdersByDateRange,
  getPOSOrderStats,
  getCustomerById,
  searchCustomers,
};
