const { prisma } = require("../../config/database");
const { sendPurchaseOrderEmail } = require("../../utils/purchase/purchaseOrderEmailHelper");

// Generate PO Number from database
const generatePONumber = async () => {
  const currentYear = new Date().getFullYear();

  // Get the latest PO for current year
  const latestPO = await prisma.purchaseOrder.findFirst({
    where: {
      poId: {
        startsWith: `PO-${currentYear}-`,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  let nextNumber = 1;
  if (latestPO) {
    // Extract number from PO-2024-001 format
    const parts = latestPO.poId.split("-");
    const lastNumber = parseInt(parts[2], 10);
    nextNumber = lastNumber + 1;
  }

  // Format: PO-2024-001, PO-2024-002, etc.
  const paddedNumber = nextNumber.toString().padStart(3, "0");
  return `PO-${currentYear}-${paddedNumber}`;
};

// Get all purchase orders
const getAllPurchaseOrders = async (req, res) => {
  try {
    const { status, supplierId, warehouseId, startDate, endDate, availableForBill } = req.query;

    const filter = {};

    if (status) {
      filter.poStatus = status;
    }

    if (supplierId) {
      filter.supplierId = supplierId;
    }

    if (warehouseId) {
      filter.warehouseId = warehouseId;
    }

    if (startDate || endDate) {
      filter.poDate = {};
      if (startDate) {
        filter.poDate.gte = new Date(startDate);
      }
      if (endDate) {
        filter.poDate.lte = new Date(endDate);
      }
    }

    // Filter out POs that already have bills (for bill creation dropdown)
    if (availableForBill === 'true') {
      // Get all PO IDs that have bills
      const posWithBills = await prisma.bill.findMany({
        where: {
          purchaseOrderId: { not: null }
        },
        select: {
          purchaseOrderId: true
        }
      });

      const poIdsWithBills = posWithBills.map(bill => bill.purchaseOrderId);

      // Exclude POs that already have bills
      filter.id = {
        notIn: poIdsWithBills
      };

      // Only show completed POs for bill creation
      filter.poStatus = 'completed';
    }

    const purchaseOrders = await prisma.purchaseOrder.findMany({
      where: filter,
      include: {
        items: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      success: true,
      count: purchaseOrders.length,
      data: purchaseOrders,
    });
  } catch (error) {
    console.error("Error fetching purchase orders:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch purchase orders",
      message: error.message,
    });
  }
};

// Get purchase order by ID
const getPurchaseOrderById = async (req, res) => {
  try {
    const { id } = req.params;

    const purchaseOrder = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        items: true,
        supplier: true,
      },
    });

    if (!purchaseOrder) {
      return res.status(404).json({
        success: false,
        error: "Purchase order not found",
      });
    }

    res.status(200).json({
      success: true,
      data: purchaseOrder,
    });
  } catch (error) {
    console.error("Error fetching purchase order:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch purchase order",
      message: error.message,
    });
  }
};

// Generate next PO number (for frontend)
const getNextPONumber = async (req, res) => {
  try {
    const poNumber = await generatePONumber();

    res.status(200).json({
      success: true,
      data: { poId: poNumber },
    });
  } catch (error) {
    console.error("Error generating PO number:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate PO number",
      message: error.message,
    });
  }
};

// Create purchase order
const createPurchaseOrder = async (req, res) => {
  try {
    const {
      supplierInfo,
      billingAddress,
      shippingAddress,
      warehouseId,
      warehouseName,
      poDate,
      expectedDeliveryDate,

      poStatus,
      poNotes,
      currency,
      currencySymbol,
      items,
      subTotal,
      totalQuantity,
      discount,
      discountType,
      totalCGST,
      totalSGST,
      totalIGST,
      totalGST,
      otherCharges,
      roundingAdjustment,
      grandTotal,
    } = req.body;

    // Validation
    if (
      !supplierInfo?.supplierId ||
      !warehouseId ||
      !items ||
      items.length === 0 ||
      !poDate ||
      !expectedDeliveryDate
    ) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
        required: [
          "supplierInfo.supplierId",
          "warehouseId",
          "items",
          "poDate",
          "expectedDeliveryDate",
        ],
      });
    }

    // Date validation
    const parsedPoDate = new Date(poDate);
    const parsedExpectedDate = new Date(expectedDeliveryDate);

    if (isNaN(parsedPoDate.getTime()) || isNaN(parsedExpectedDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format",
        message: "poDate and expectedDeliveryDate must be valid dates",
      });
    }

    // Generate PO number from database
    const poId = await generatePONumber();

    // Create purchase order with items
    const purchaseOrder = await prisma.purchaseOrder.create({
      data: {
        poId,
        supplierId: supplierInfo.supplierId,
        supplierName: supplierInfo.supplierName,
        contactPersonName: supplierInfo.contactPersonName,
        supplierPhone: supplierInfo.supplierPhone,
        supplierEmail: supplierInfo.supplierEmail,
        supplierGSTIN: supplierInfo.supplierGSTIN,
        billingAddress,
        shippingAddress,
        warehouseId,
        warehouseName,
        poDate: new Date(poDate),
        expectedDeliveryDate: new Date(expectedDeliveryDate),

        poStatus: poStatus || "draft",
        poNotes: poNotes?.trim() || null,
        subTotal,
        totalQuantity,
        discount,
        discountType,
        totalCGST,
        totalSGST,
        totalIGST,
        totalGST,
        otherCharges,
        roundingAdjustment,
        grandTotal,
        items: {
          create: items.map((item) => ({
            itemId: item.itemId,
            category: item.category,
            productName: item.productName,
            sku: item.sku,
            hsnCode: item.hsnCode,
            quantity: item.quantity,
            uom: item.uom,
            price: item.price,
            gstRateId: item.gstRateId || null,
            gstPercentage: item.gstPercentage ? parseFloat(item.gstPercentage) : 0,
            gstType: item.gstType,
            cgstPercentage: item.cgstPercentage,
            sgstPercentage: item.sgstPercentage,
            igstPercentage: item.igstPercentage,
            cgstAmount: item.cgstAmount,
            sgstAmount: item.sgstAmount,
            igstAmount: item.igstAmount,
            totalGstAmount: item.totalGstAmount,
            mrp: item.mrp,
            itemTotal: item.itemTotal,
            totalPrice: item.totalPrice,
          })),
        },
      },
      include: {
        items: true,
      },
    });

    // Send email if status is completed
    let emailSent = false;
    if (poStatus === "completed") {
      try {
        const emailResult = await sendPurchaseOrderEmail(
          {
            ...purchaseOrder,
            currency: currency || "INR",
            currencySymbol: currencySymbol || "₹",
          },
          "sent"
        );
        emailSent = emailResult.success;
      } catch (emailError) {
        console.error("❌ Error sending PO email:", emailError);
      }
    }

    const message =
      poStatus === "completed"
        ? emailSent
          ? "Purchase order created and sent to supplier via email"
          : "Purchase order created and marked as completed"
        : "Purchase order saved as draft";

    // Send purchase order notification to all admins
    try {
      const { sendToAllAdmins } = require('../../utils/notification/sendNotification');
      
      const statusEmoji = poStatus === 'completed' ? '✅' : '📝';
      const statusText = poStatus === 'completed' ? 'Completed' : 'Draft';
      
      const adminNotification = {
        title: `${statusEmoji} Purchase Order ${statusText}`,
        body: `PO #${purchaseOrder.poId}\n\n🏢 Supplier: ${supplierInfo.supplierName}\n💰 Amount: ₹${grandTotal.toFixed(2)}\n📦 Items: ${totalQuantity}`,
      };

      const adminData = {
        type: 'PURCHASE_ORDER_CREATED',
        poId: purchaseOrder.poId,
        purchaseOrderId: purchaseOrder.id,
        supplierName: supplierInfo.supplierName,
        grandTotal: grandTotal.toString(),
        status: poStatus,
        link: `/dashboard/purchase-management/purchase-orders/${purchaseOrder.id}`,
        urgency: poStatus === 'completed' ? 'high' : 'normal',
        vibrate: [200, 100, 200],
        requireInteraction: poStatus === 'completed',
        color: poStatus === 'completed' ? '#4CAF50' : '#2196F3',
        backgroundColor: poStatus === 'completed' ? '#E8F5E9' : '#E3F2FD',
      };

      await sendToAllAdmins(adminNotification, adminData);
      console.log(`📱 Purchase order notification sent to all admins`);
    } catch (adminNotifError) {
      console.error(`⚠️ Failed to send admin notification:`, adminNotifError.message);
    }

    res.status(201).json({
      success: true,
      message,
      data: purchaseOrder,
    });
  } catch (error) {
    console.error("Error creating purchase order:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create purchase order",
      message: error.message,
    });
  }
};

// Update purchase order
const updatePurchaseOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      supplierInfo,
      billingAddress,
      shippingAddress,
      warehouseId,
      warehouseName,
      poDate,
      expectedDeliveryDate,
      poStatus,
      poNotes,
      currency,
      currencySymbol,
      items,
      subTotal,
      totalQuantity,
      discount,
      discountType,
      totalCGST,
      totalSGST,
      totalIGST,
      totalGST,
      otherCharges,
      roundingAdjustment,
      grandTotal,
    } = req.body;

    // Validation
    if (
      !supplierInfo?.supplierId ||
      !warehouseId ||
      !items ||
      items.length === 0 ||
      !poDate ||
      !expectedDeliveryDate
    ) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
        required: [
          "supplierInfo.supplierId",
          "warehouseId",
          "items",
          "poDate",
          "expectedDeliveryDate",
        ],
      });
    }

    // Date validation
    const parsedPoDate = new Date(poDate);
    const parsedExpectedDate = new Date(expectedDeliveryDate);

    if (isNaN(parsedPoDate.getTime()) || isNaN(parsedExpectedDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format",
        message: "poDate and expectedDeliveryDate must be valid dates",
      });
    }

    // Get existing PO
    const existingPO = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existingPO) {
      return res.status(404).json({
        success: false,
        error: "Purchase order not found",
      });
    }

    const oldStatus = existingPO.poStatus;

    // Prevent editing completed POs (unless staying in same status)
    if (oldStatus === "completed" && oldStatus !== poStatus) {
      return res.status(400).json({
        success: false,
        error: "Cannot modify purchase order",
        message: `Purchase order is ${oldStatus} and cannot be modified`,
      });
    }

    // Validate status transitions (only draft and completed)
    const validTransitions = {
      draft: ["draft", "completed"],
      completed: ["completed"],
    };

    if (!validTransitions[oldStatus]) {
      return res.status(400).json({
        success: false,
        error: "Invalid current status",
        message: `Unknown status: "${oldStatus}"`,
      });
    }

    if (!validTransitions[oldStatus].includes(poStatus)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status transition",
        message: `Cannot change status from "${oldStatus}" to "${poStatus}". Valid transitions: ${validTransitions[
          oldStatus
        ].join(", ")}`,
      });
    }

    // Delete existing items
    await prisma.purchaseOrderItem.deleteMany({
      where: { purchaseOrderId: id },
    });

    // Update purchase order with new items
    const purchaseOrder = await prisma.purchaseOrder.update({
      where: { id },
      data: {
        supplierId: supplierInfo.supplierId,
        supplierName: supplierInfo.supplierName,
        contactPersonName: supplierInfo.contactPersonName,
        supplierPhone: supplierInfo.supplierPhone,
        supplierEmail: supplierInfo.supplierEmail,
        supplierGSTIN: supplierInfo.supplierGSTIN,
        billingAddress,
        shippingAddress,
        warehouseId,
        warehouseName,
        poDate: new Date(poDate),
        expectedDeliveryDate: new Date(expectedDeliveryDate),

        poStatus,
        poNotes: poNotes?.trim() || null,
        subTotal,
        totalQuantity,
        discount,
        discountType,
        totalCGST,
        totalSGST,
        totalIGST,
        totalGST,
        otherCharges,
        roundingAdjustment,
        grandTotal,
        items: {
          create: items.map((item) => ({
            itemId: item.itemId,
            category: item.category,
            productName: item.productName,
            sku: item.sku,
            hsnCode: item.hsnCode,
            quantity: item.quantity,
            uom: item.uom,
            price: item.price,
            gstRateId: item.gstRateId || null,
            gstPercentage: item.gstPercentage ? parseFloat(item.gstPercentage) : 0,
            gstType: item.gstType,
            cgstPercentage: item.cgstPercentage,
            sgstPercentage: item.sgstPercentage,
            igstPercentage: item.igstPercentage,
            cgstAmount: item.cgstAmount,
            sgstAmount: item.sgstAmount,
            igstAmount: item.igstAmount,
            totalGstAmount: item.totalGstAmount,
            mrp: item.mrp,
            itemTotal: item.itemTotal,
            totalPrice: item.totalPrice,
          })),
        },
      },
      include: {
        items: true,
      },
    });

    // Send email if status changed from draft to completed
    let emailSent = false;
    if (oldStatus === "draft" && poStatus === "completed") {
      try {
        const emailResult = await sendPurchaseOrderEmail(
          {
            ...purchaseOrder,
            currency: currency || "INR",
            currencySymbol: currencySymbol || "₹",
          },
          "sent"
        );
        emailSent = emailResult.success;
      } catch (emailError) {
        console.error("❌ Error sending PO email:", emailError);
      }
    }

    let message = "Purchase order updated";
    if (oldStatus === "draft" && poStatus === "completed") {
      message = emailSent
        ? "Purchase order completed and sent to supplier via email"
        : "Purchase order marked as completed";
    }

    res.status(200).json({
      success: true,
      message,
      data: purchaseOrder,
    });
  } catch (error) {
    console.error("Error updating purchase order:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update purchase order",
      message: error.message,
    });
  }
};

// Delete purchase order - DISABLED FOR SAFETY
const deletePurchaseOrder = async (req, res) => {
  return res.status(403).json({
    success: false,
    error: "Delete operation not allowed",
    message:
      "Purchase orders cannot be deleted. Please cancel the purchase order instead using status update.",
  });
};

// Get purchase order statistics
const getPurchaseOrderStats = async (req, res) => {
  try {
    const totalPOs = await prisma.purchaseOrder.count();
    const draftPOs = await prisma.purchaseOrder.count({
      where: { poStatus: "draft" },
    });
    const completedPOs = await prisma.purchaseOrder.count({
      where: { poStatus: "completed" },
    });

    // Calculate total value
    const totalValue = await prisma.purchaseOrder.aggregate({
      _sum: {
        grandTotal: true,
      },
    });

    // Get recent POs
    const recentPOs = await prisma.purchaseOrder.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        poId: true,
        supplierName: true,
        grandTotal: true,
        poStatus: true,
        createdAt: true,
      },
    });

    res.status(200).json({
      success: true,
      data: {
        total: totalPOs,
        draft: draftPOs,
        completed: completedPOs,
        totalValue: totalValue._sum.grandTotal || 0,
        recentPOs,
      },
    });
  } catch (error) {
    console.error("Error fetching purchase order stats:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch purchase order statistics",
      message: error.message,
    });
  }
};

module.exports = {
  getAllPurchaseOrders,
  getPurchaseOrderById,
  getNextPONumber,
  createPurchaseOrder,
  updatePurchaseOrder,
  deletePurchaseOrder,
  getPurchaseOrderStats,
};
