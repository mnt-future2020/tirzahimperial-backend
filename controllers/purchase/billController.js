const { prisma } = require("../../config/database");
const { uploadToS3, deleteFromS3, getPresignedUrl } = require("../../utils/purchase/uploadsS3");
const { updateStockAfterPurchase } = require("../../utils/purchase/stockUpdateHelper");

// Generate Bill/GRN Number
const generateBillNumber = async () => {
  const currentYear = new Date().getFullYear();
  
  const latestBill = await prisma.bill.findFirst({
    where: {
      billId: {
        startsWith: `BILL-${currentYear}-`,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  let nextNumber = 1;
  if (latestBill) {
    const parts = latestBill.billId.split("-");
    const lastNumber = parseInt(parts[2], 10);
    nextNumber = lastNumber + 1;
  }

  const paddedNumber = nextNumber.toString().padStart(3, "0");
  return `BILL-${currentYear}-${paddedNumber}`;
};

// Generate GRN Number
const generateGRNNumber = async () => {
  const currentYear = new Date().getFullYear();
  
  const latestGRN = await prisma.bill.findFirst({
    where: {
      grnNumber: {
        startsWith: `GRN-${currentYear}-`,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  let nextNumber = 1;
  if (latestGRN) {
    const parts = latestGRN.grnNumber.split("-");
    const lastNumber = parseInt(parts[2], 10);
    nextNumber = lastNumber + 1;
  }

  const paddedNumber = nextNumber.toString().padStart(3, "0");
  return `GRN-${currentYear}-${paddedNumber}`;
};

// Get all bills
const getAllBills = async (req, res) => {
  try {
    const { 
      status, 
      supplierId, 
      warehouseId, 
      poId, 
      startDate, 
      endDate,
      paymentStatus 
    } = req.query;

    const filter = {};
    
    if (status) filter.billStatus = status;
    if (supplierId) filter.supplierId = supplierId;
    if (warehouseId) filter.warehouseId = warehouseId;
    if (poId) filter.purchaseOrderId = poId;
    if (paymentStatus) filter.paymentStatus = paymentStatus;

    if (startDate || endDate) {
      filter.billDate = {};
      if (startDate) filter.billDate.gte = new Date(startDate);
      if (endDate) filter.billDate.lte = new Date(endDate);
    }

    const bills = await prisma.bill.findMany({
      where: filter,
      include: {
        items: true,
      },
      orderBy: { createdAt: "desc" },
    });

    // Generate pre-signed URLs for invoice copies
    const billsWithUrls = await Promise.all(
      bills.map(async (bill) => ({
        ...bill,
        invoiceCopyUrl: bill.invoiceCopyUrl 
          ? getPresignedUrl(bill.invoiceCopyUrl)
          : null,
      }))
    );

    res.status(200).json({
      success: true,
      count: billsWithUrls.length,
      data: billsWithUrls,
    });
  } catch (error) {
    console.error("Error fetching bills:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch bills",
      message: error.message,
    });
  }
};

// Get bill by ID
const getBillById = async (req, res) => {
  try {
    const { id } = req.params;

    const bill = await prisma.bill.findUnique({
      where: { id },
      include: {
        items: true,
        supplier: true,
        purchaseOrder: {
          include: {
            items: true,
          },
        },
      },
    });

    if (!bill) {
      return res.status(404).json({
        success: false,
        error: "Bill not found",
      });
    }

    // Generate proxy URL for invoice copy
    if (bill.invoiceCopyUrl) {
      bill.invoiceCopyUrl = getPresignedUrl(bill.invoiceCopyUrl);
    }

    res.status(200).json({
      success: true,
      data: bill,
    });
  } catch (error) {
    console.error("Error fetching bill:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch bill",
      message: error.message,
    });
  }
};

// Get next GRN number
const getNextGRNNumber = async (req, res) => {
  try {
    const grnNumber = await generateGRNNumber();
    
    res.status(200).json({
      success: true,
      data: { grnNumber },
    });
  } catch (error) {
    console.error("Error generating GRN number:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate GRN number",
      message: error.message,
    });
  }
};

// Create bill/GRN
const createBill = async (req, res) => {
  try {
    const {
      grnNumber,
      invoiceNumber,
      grnDate,
      supplierId,
      supplierName,
      poId,

      billDueDate,
      billingAddress,
      shippingAddress,
      warehouseId,
      warehouseName,
      shipmentReceivedDate,
      deliveryChallanNumber,
      transporterName,
      eWayBillNumber,
      remarks,
      contactPersonName,
      supplierPhone,
      supplierEmail,
      supplierGSTIN,
      items,
      subTotal,
      totalDiscount,
      discount,
      discountType,
      totalCGST,
      totalSGST,
      totalIGST,
      totalGST,
      otherCharges,
      roundOff,
      grandTotal,
      paymentStatus,
      paymentDate,
    } = req.body;

    // Validation
    if (!invoiceNumber || !supplierId || !warehouseId || !items || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
        required: ["invoiceNumber", "supplierId", "warehouseId", "items"],
      });
    }

    // Parse items if it's a string
    const parsedItems = typeof items === "string" ? JSON.parse(items) : items;

    // Generate GRN number if not provided
    const finalGRNNumber = grnNumber || await generateGRNNumber();
    const billId = finalGRNNumber;

    // Handle invoice copy upload
    let invoiceCopyUrl = null;
    if (req.file) {
      invoiceCopyUrl = await uploadToS3(req.file, "bill-invoices");
    }

    // Get PO details if poId provided
    let purchaseOrderId = poId;
    let poNumber = null;
    if (poId) {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: poId },
        select: { poId: true },
      });
      if (po) {
        poNumber = po.poId;
      }
    }

    // Create bill with items
    const bill = await prisma.bill.create({
      data: {
        billId,
        grnNumber: finalGRNNumber,
        purchaseOrderId: purchaseOrderId || null,
        poNumber: poNumber || null,
        supplierId,
        supplierName,
        supplierPhone,
        supplierEmail,
        supplierGSTIN: supplierGSTIN || "",
        supplierInvoiceNo: invoiceNumber,
        supplierInvoiceDate: new Date(grnDate),
        billDate: new Date(grnDate),
        billDueDate: billDueDate ? new Date(billDueDate) : null,
        receivedDate: new Date(shipmentReceivedDate),
        warehouseId,
        warehouseName,
        billingAddress,
        shippingAddress,
        transporterName,
        vehicleNumber: deliveryChallanNumber,
        lrNumber: deliveryChallanNumber,
        eWayBillNumber,

        paymentStatus: paymentStatus || "unpaid",
        paymentDate: paymentDate ? new Date(paymentDate) : null,
        paidAmount: paymentStatus === "paid" ? parseFloat(grandTotal) : 0,
        subTotal: parseFloat(subTotal),
        totalQuantity: parsedItems.reduce((sum, item) => sum + parseInt(item.quantityReceived), 0),
        totalDiscount: parseFloat(totalDiscount || 0),
        discount: parseFloat(discount || 0),
        discountType: discountType || "flat",
        totalCGST: parseFloat(totalCGST),
        totalSGST: parseFloat(totalSGST),
        totalIGST: parseFloat(totalIGST),
        totalGST: parseFloat(totalGST),
        otherCharges: parseFloat(otherCharges),
        roundingAdjustment: parseFloat(roundOff),
        grandTotal: parseFloat(grandTotal),
        invoiceCopyUrl,
        remarks,
        items: {
          create: parsedItems.map((item) => ({
            itemId: item.itemId,
            category: item.category,
            productName: item.itemName,
            sku: item.itemCode,
            hsnCode: item.hsnCode,
            orderedQuantity: parseInt(item.quantityReceived),
            receivedQuantity: parseInt(item.quantityReceived),
            acceptedQuantity: parseInt(item.quantityReceived),
            rejectedQuantity: 0,
            uom: item.uom,
            price: parseFloat(item.purchasePrice),
            gstRateId: item.gstRateId || null,
            gstPercentage: item.gstPercentage ? parseFloat(item.gstPercentage) : 0,
            gstType: item.gstType,
            cgstPercentage: parseFloat(item.cgstPercentage || 0),
            sgstPercentage: parseFloat(item.sgstPercentage || 0),
            igstPercentage: parseFloat(item.igstPercentage || 0),
            cgstAmount: parseFloat(item.cgstAmount || 0),
            sgstAmount: parseFloat(item.sgstAmount || 0),
            igstAmount: parseFloat(item.igstAmount || 0),
            totalGstAmount: parseFloat(item.totalGstAmount || 0),
            mrp: item.mrp,
            itemTotal: parseFloat(item.totalAmount) - parseFloat(item.totalGstAmount),
            totalPrice: parseFloat(item.totalAmount),
            batchNumber: item.batchNo,
            expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
            manufacturingDate: item.mfgDate ? new Date(item.mfgDate) : null,
          })),
        },
      },
      include: {
        items: true,
      },
    });

    // Update stock directly (replaces Kafka)
    try {
      await updateStockAfterPurchase(bill, parsedItems);
      console.log(`✅ Stock updated successfully for GRN: ${bill.grnNumber}`);
    } catch (stockError) {
      console.error(`❌ Error updating stock for GRN ${bill.grnNumber}:`, stockError);
      // Don't fail the bill creation if stock update fails
    }

    res.status(201).json({
      success: true,
      message: "Bill created and stock updated successfully",
      data: bill,
    });
  } catch (error) {
    console.error("Error creating bill:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create bill",
      message: error.message,
    });
  }
};

// Update bill/GRN
const updateBill = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      grnNumber,
      invoiceNumber,
      grnDate,
      supplierId,
      supplierName,
      poId,
      billDueDate,

      billingAddress,
      shippingAddress,
      warehouseId,
      warehouseName,
      shipmentReceivedDate,
      deliveryChallanNumber,
      transporterName,
      eWayBillNumber,
      remarks,
      contactPersonName,
      supplierPhone,
      supplierEmail,
      supplierGSTIN,
      items,
      subTotal,
      totalDiscount,
      discount,
      discountType,
      totalCGST,
      totalSGST,
      totalIGST,
      totalGST,
      otherCharges,
      roundOff,
      grandTotal,
      paymentStatus,
      paymentDate,
      existingInvoiceCopy,
    } = req.body;

    // Get existing bill
    const existingBill = await prisma.bill.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existingBill) {
      return res.status(404).json({
        success: false,
        error: "Bill not found",
      });
    }

    // Parse items if it's a string
    const parsedItems = typeof items === "string" ? JSON.parse(items) : items;

    // Handle invoice copy upload
    let invoiceCopyUrl = existingBill.invoiceCopyUrl;
    if (req.file) {
      if (existingBill.invoiceCopyUrl) {
        await deleteFromS3(existingBill.invoiceCopyUrl);
      }
      invoiceCopyUrl = await uploadToS3(req.file, "bill-invoices");
    } else if (existingInvoiceCopy) {
      invoiceCopyUrl = existingInvoiceCopy;
    }

    // Get PO details if poId provided
    let purchaseOrderId = poId;
    let poNumber = existingBill.poNumber;
    if (poId && poId !== existingBill.purchaseOrderId) {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: poId },
        select: { poId: true },
      });
      if (po) {
        poNumber = po.poId;
      }
    }

    // Delete existing items
    await prisma.billItem.deleteMany({
      where: { billId: id },
    });

    // Update bill with new items
    const bill = await prisma.bill.update({
      where: { id },
      data: {
        billId: grnNumber,
        grnNumber,
        purchaseOrderId: purchaseOrderId || existingBill.purchaseOrderId,
        poNumber: poNumber,
        supplierId,
        supplierName,
        supplierPhone,
        supplierEmail,
        supplierGSTIN: supplierGSTIN || "",
        supplierInvoiceNo: invoiceNumber,
        supplierInvoiceDate: new Date(grnDate),
        billDate: new Date(grnDate),
        billDueDate: billDueDate ? new Date(billDueDate) : null,
        receivedDate: new Date(shipmentReceivedDate),
        warehouseId,
        warehouseName,
        billingAddress,
        shippingAddress,
        transporterName,
        vehicleNumber: deliveryChallanNumber,
        lrNumber: deliveryChallanNumber,
        eWayBillNumber,
        paymentStatus: paymentStatus || existingBill.paymentStatus,

        paymentDate: paymentDate ? new Date(paymentDate) : null,
        paidAmount: paymentStatus === "paid" ? parseFloat(grandTotal) : existingBill.paidAmount,
        subTotal: parseFloat(subTotal),
        totalQuantity: parsedItems.reduce((sum, item) => sum + parseInt(item.quantityReceived), 0),
        totalDiscount: parseFloat(totalDiscount || 0),
        discount: parseFloat(discount || 0),
        discountType: discountType || "flat",
        totalCGST: parseFloat(totalCGST),
        totalSGST: parseFloat(totalSGST),
        totalIGST: parseFloat(totalIGST),
        totalGST: parseFloat(totalGST),
        otherCharges: parseFloat(otherCharges),
        roundingAdjustment: parseFloat(roundOff),
        grandTotal: parseFloat(grandTotal),
        invoiceCopyUrl,
        remarks,
        items: {
          create: parsedItems.map((item) => ({
            itemId: item.itemId,
            category: item.category,
            productName: item.itemName,
            sku: item.itemCode,
            hsnCode: item.hsnCode,
            orderedQuantity: parseInt(item.quantityReceived),
            receivedQuantity: parseInt(item.quantityReceived),
            acceptedQuantity: parseInt(item.quantityReceived),
            rejectedQuantity: 0,
            uom: item.uom,
            price: parseFloat(item.purchasePrice),
            gstRateId: item.gstRateId || null,
            gstPercentage: item.gstPercentage ? parseFloat(item.gstPercentage) : 0,
            gstType: item.gstType,
            cgstPercentage: parseFloat(item.cgstPercentage || 0),
            sgstPercentage: parseFloat(item.sgstPercentage || 0),
            igstPercentage: parseFloat(item.igstPercentage || 0),
            cgstAmount: parseFloat(item.cgstAmount || 0),
            sgstAmount: parseFloat(item.sgstAmount || 0),
            igstAmount: parseFloat(item.igstAmount || 0),
            totalGstAmount: parseFloat(item.totalGstAmount || 0),
            mrp: item.mrp,
            itemTotal: parseFloat(item.totalAmount) - parseFloat(item.totalGstAmount),
            totalPrice: parseFloat(item.totalAmount),
            batchNumber: item.batchNo,
            expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
            manufacturingDate: item.mfgDate ? new Date(item.mfgDate) : null,
          })),
        },
      },
      include: {
        items: true,
      },
    });

    // Update stock (handles delta automatically)
    try {
      await updateStockAfterPurchase(bill, parsedItems);
      console.log(`✅ Stock updated successfully for GRN: ${bill.grnNumber}`);
    } catch (stockError) {
      console.error(`❌ Error updating stock for GRN ${bill.grnNumber}:`, stockError);
    }

    res.status(200).json({
      success: true,
      message: "Bill updated successfully",
      data: bill,
    });
  } catch (error) {
    console.error("Error updating bill:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update bill",
      message: error.message,
    });
  }
};

// Update payment status
const updatePaymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentStatus, paymentDate } = req.body;

    const bill = await prisma.bill.findUnique({
      where: { id },
    });

    if (!bill) {
      return res.status(404).json({
        success: false,
        error: "Bill not found",
      });
    }

    const updatedBill = await prisma.bill.update({
      where: { id },
      data: {
        paymentStatus,
        paymentDate: paymentDate ? new Date(paymentDate) : null,
        paidAmount: paymentStatus === "paid" ? bill.grandTotal : bill.paidAmount,
      },
      include: {
        items: true,
      },
    });

    res.status(200).json({
      success: true,
      message: "Payment status updated successfully",
      data: updatedBill,
    });
  } catch (error) {
    console.error("Error updating payment status:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update payment status",
      message: error.message,
    });
  }
};

// Get bill statistics
const getBillStats = async (req, res) => {
  try {
    const totalBills = await prisma.bill.count();
    const unpaidBills = await prisma.bill.count({
      where: { paymentStatus: "unpaid" },
    });
    const paidBills = await prisma.bill.count({
      where: { paymentStatus: "paid" },
    });

    // Calculate total values
    const totalValue = await prisma.bill.aggregate({
      _sum: { grandTotal: true },
    });

    const unpaidValue = await prisma.bill.aggregate({
      where: { paymentStatus: "unpaid" },
      _sum: { grandTotal: true },
    });

    // Get recent bills
    const recentBills = await prisma.bill.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        billId: true,
        grnNumber: true,
        supplierName: true,
        grandTotal: true,
        paymentStatus: true,
        createdAt: true,
      },
    });

    res.status(200).json({
      success: true,
      data: {
        total: totalBills,
        unpaid: unpaidBills,
        paid: paidBills,
        totalValue: totalValue._sum.grandTotal || 0,
        unpaidValue: unpaidValue._sum.grandTotal || 0,
        recentBills,
      },
    });
  } catch (error) {
    console.error("Error fetching bill stats:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch bill statistics",
      message: error.message,
    });
  }
};

// Get bills by supplier
const getBillsBySupplier = async (req, res) => {
  try {
    const { supplierId } = req.params;

    const bills = await prisma.bill.findMany({
      where: { supplierId },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      success: true,
      count: bills.length,
      data: bills,
    });
  } catch (error) {
    console.error("Error fetching bills by supplier:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch bills",
      message: error.message,
    });
  }
};

// Get bills by warehouse
const getBillsByWarehouse = async (req, res) => {
  try {
    const { warehouseId } = req.params;

    const bills = await prisma.bill.findMany({
      where: { warehouseId },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      success: true,
      count: bills.length,
      data: bills,
    });
  } catch (error) {
    console.error("Error fetching bills by warehouse:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch bills",
      message: error.message,
    });
  }
};

// Get bills by purchase order
const getBillsByPurchaseOrder = async (req, res) => {
  try {
    const { poId } = req.params;

    const bills = await prisma.bill.findMany({
      where: { purchaseOrderId: poId },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      success: true,
      count: bills.length,
      data: bills,
    });
  } catch (error) {
    console.error("Error fetching bills by PO:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch bills",
      message: error.message,
    });
  }
};

module.exports = {
  getAllBills,
  getBillById,
  getNextGRNNumber,
  createBill,
  updateBill,
  updatePaymentStatus,
  getBillStats,
  getBillsBySupplier,
  getBillsByWarehouse,
  getBillsByPurchaseOrder,
};
