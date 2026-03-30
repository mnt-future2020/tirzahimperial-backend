const { prisma } = require("../../config/database");
const { getPresignedUrl } = require("../../utils/online/uploadS3");
const { generateInvoicePDF, getCompanyData } = require("../../utils/order/invoicePDFGenerator");

const normalizeOrderDiscount = (order) => {
  if (!order) return order;
  const discount = Number(order.discount || 0);
  const couponDiscount = Number(order.couponDiscount || 0);
  if (discount > 0 && couponDiscount > 0 && Math.abs(discount - couponDiscount) < 0.01) {
    return { ...order, discount: 0, couponDiscount };
  }
  return order;
};

/**
 * Convert S3 keys to presigned URLs in order items
 */
const convertOrderImagesToUrls = async (orders) => {
  return Promise.all(
    orders.map(async (order) => {
      const itemsWithUrls = await Promise.all(
        order.items.map(async (item) => {
          if (item.productImage && !item.productImage.startsWith("http")) {
            try {
              const proxyUrl = getPresignedUrl(item.productImage, 3600);
              return { ...item, productImage: proxyUrl };
            } catch (error) {
              console.error("Error generating presigned URL:", error);
              return item;
            }
          }
          return item;
        })
      );
      return { ...order, items: itemsWithUrls };
    })
  );
};

/**
 * Get all orders for a user
 * GET /api/online/my-orders
 */
const getMyOrders = async (req, res) => {
  try {
    const { userId } = req.query;
    const { page = 1, limit = 10, status } = req.query;

    if (!userId) {
      return res.status(400).json({ success: false, error: "User ID is required" });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = { userId };

    if (status && status !== "all") {
      where.orderStatus = status;
    }

    const [orders, total] = await Promise.all([
      prisma.onlineOrder.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: parseInt(limit),
        include: {
          deliveryPartner: {
            select: {
              id: true,
              partnerId: true,
              name: true,
              phone: true,
            },
          },
        },
      }),
      prisma.onlineOrder.count({ where }),
    ]);

    // Convert S3 keys to presigned URLs
    const ordersWithUrls = await convertOrderImagesToUrls(orders);
    const normalizedOrders = ordersWithUrls.map(normalizeOrderDiscount);

    res.json({
      success: true,
      data: normalizedOrders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching user orders:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch orders",
      message: error.message,
    });
  }
};

/**
 * Get single order by order number
 * GET /api/online/my-orders/:orderNumber
 */
const getOrderByNumber = async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ success: false, error: "User ID is required" });
    }

    const order = await prisma.onlineOrder.findFirst({
      where: {
        orderNumber,
        userId,
      },
      include: {
        deliveryPartner: {
          select: {
            id: true,
            partnerId: true,
            name: true,
            phone: true,
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: "Order not found",
      });
    }

    // Convert S3 keys to presigned URLs
    const [orderWithUrls] = await convertOrderImagesToUrls([order]);
    const normalizedOrder = normalizeOrderDiscount(orderWithUrls);

    res.json({
      success: true,
      data: normalizedOrder,
    });
  } catch (error) {
    console.error("Error fetching order:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch order",
      message: error.message,
    });
  }
};

/**
 * Download order invoice PDF (User)
 * GET /api/online/my-orders/:orderNumber/invoice/download
 */
const downloadOrderInvoice = async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const { userId } = req.query;

    console.log(`📄 User invoice download requested for order: ${orderNumber}`);

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    // Find the order by order number and verify it belongs to the user
    const order = await prisma.onlineOrder.findFirst({
      where: {
        orderNumber: orderNumber,
        userId: userId
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found or does not belong to you'
      });
    }

    console.log(`📄 Order found: ${order.orderNumber}, Status: ${order.orderStatus}`);

    // Only allow invoice download for confirmed, packing, shipped, and delivered orders
    if (!['confirmed', 'packing', 'shipped', 'delivered'].includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invoice not available for ${order.orderStatus} orders`
      });
    }

    // Get company data
    const companyData = await getCompanyData();

    // Prepare order data for PDF generation
    const normalizedOrder = normalizeOrderDiscount(order);
    const orderData = {
      ...normalizedOrder,
      items: order.items || [],
      deliveryAddress: order.deliveryAddress || {},
      createdAt: order.createdAt,
      invoiceNumber: order.invoiceNumber || order.orderNumber,
      // Ensure GST fields are included
      gstType: order.gstType,
      cgstAmount: order.cgstAmount || 0,
      sgstAmount: order.sgstAmount || 0,
      igstAmount: order.igstAmount || 0,
      totalGstAmount: order.totalGstAmount || order.tax || 0,
      adminState: order.adminState,
      customerState: order.customerState
    };

    console.log(`📄 Generating PDF for user download: ${orderNumber}`);
    console.log(`📊 Order GST Data:`, {
      gstType: orderData.gstType,
      cgstAmount: orderData.cgstAmount,
      sgstAmount: orderData.sgstAmount,
      igstAmount: orderData.igstAmount,
      totalGstAmount: orderData.totalGstAmount,
      tax: orderData.tax
    });

    // Generate PDF
    const pdfBuffer = await generateInvoicePDF(orderData, companyData);

    console.log(`📄 PDF generated successfully for user download: ${orderNumber}`);

    // Set response headers for PDF download
    const filename = `invoice-${orderNumber}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);

    // Send PDF buffer
    res.send(pdfBuffer);

  } catch (error) {
    console.error('Error generating user invoice PDF:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate invoice PDF',
      error: error.message
    });
  }
};

module.exports = {
  getMyOrders,
  getOrderByNumber,
  downloadOrderInvoice,
};
