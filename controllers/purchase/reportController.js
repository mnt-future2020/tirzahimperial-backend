const { prisma } = require("../../config/database");
const XLSX = require("xlsx");

// Purchase Summary Report
const getPurchaseSummaryReport = async (req, res) => {
  try {
    const { startDate, endDate, supplierId, warehouseId, status } = req.query;

    const filter = {};
    
    if (status && status !== "all") filter.poStatus = status;
    if (supplierId && supplierId !== "all") filter.supplierId = supplierId;
    if (warehouseId && warehouseId !== "all") filter.warehouseId = warehouseId;
    
    // Exclude cancelled POs unless specifically requested
    if (!status || status === "all") {
      filter.poStatus = { not: "cancelled" };
    }

    if (startDate || endDate) {
      filter.poDate = {};
      if (startDate) filter.poDate.gte = new Date(startDate);
      if (endDate) filter.poDate.lte = new Date(endDate);
    }

    const purchaseOrders = await prisma.purchaseOrder.findMany({
      where: filter,
      include: {
        items: true,
        supplier: true,
      },
      orderBy: { poDate: "desc" },
    });

    // Calculate summary statistics
    const summary = {
      totalPOs: purchaseOrders.length,
      totalAmount: purchaseOrders.reduce((sum, po) => sum + po.grandTotal, 0),
      totalQuantity: purchaseOrders.reduce((sum, po) => sum + po.totalQuantity, 0),
      totalGST: purchaseOrders.reduce((sum, po) => sum + po.totalGST, 0),
      totalDiscount: purchaseOrders.reduce((sum, po) => sum + po.discount, 0),
      byStatus: {},
      bySupplier: {},
      byWarehouse: {},
    };

    // Group by status
    purchaseOrders.forEach((po) => {
      if (!summary.byStatus[po.poStatus]) {
        summary.byStatus[po.poStatus] = {
          count: 0,
          amount: 0,
        };
      }
      summary.byStatus[po.poStatus].count++;
      summary.byStatus[po.poStatus].amount += po.grandTotal;
    });

    // Group by supplier
    purchaseOrders.forEach((po) => {
      if (!summary.bySupplier[po.supplierName]) {
        summary.bySupplier[po.supplierName] = {
          count: 0,
          amount: 0,
        };
      }
      summary.bySupplier[po.supplierName].count++;
      summary.bySupplier[po.supplierName].amount += po.grandTotal;
    });

    // Group by warehouse
    purchaseOrders.forEach((po) => {
      if (!summary.byWarehouse[po.warehouseName]) {
        summary.byWarehouse[po.warehouseName] = {
          count: 0,
          amount: 0,
        };
      }
      summary.byWarehouse[po.warehouseName].count++;
      summary.byWarehouse[po.warehouseName].amount += po.grandTotal;
    });

    res.status(200).json({
      success: true,
      data: {
        summary,
        purchaseOrders,
      },
    });
  } catch (error) {
    console.error("Error generating purchase summary report:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate purchase summary report",
      message: error.message,
    });
  }
};

// Export Purchase Summary to Excel
const exportPurchaseSummaryExcel = async (req, res) => {
  try {
    const { startDate, endDate, supplierId, warehouseId, status } = req.query;

    const filter = {};
    
    if (status && status !== "all") filter.poStatus = status;
    if (supplierId && supplierId !== "all") filter.supplierId = supplierId;
    if (warehouseId && warehouseId !== "all") filter.warehouseId = warehouseId;

    if (startDate || endDate) {
      filter.poDate = {};
      if (startDate) filter.poDate.gte = new Date(startDate);
      if (endDate) filter.poDate.lte = new Date(endDate);
    }

    const purchaseOrders = await prisma.purchaseOrder.findMany({
      where: filter,
      include: {
        items: true,
        supplier: true,
      },
      orderBy: { poDate: "desc" },
    });

    // Prepare Excel data
    const excelData = purchaseOrders.map((po) => ({
      "PO ID": po.poId,
      "PO Date": po.poDate.toISOString().split('T')[0],
      "Expected Delivery": po.expectedDeliveryDate.toISOString().split('T')[0],
      "Supplier Name": po.supplierName,
      "Supplier Phone": po.supplierPhone || "",
      "Supplier Email": po.supplierEmail || "",
      "Supplier GSTIN": po.supplierGSTIN || "",
      "Warehouse": po.warehouseName,
      "Status": po.poStatus,
      "Sub Total": po.subTotal,
      "Total Quantity": po.totalQuantity,
      "Discount": po.discount,
      "CGST": po.totalCGST || 0,
      "SGST": po.totalSGST || 0,
      "IGST": po.totalIGST || 0,
      "Total GST": po.totalGST,
      "Other Charges": po.otherCharges || 0,
      "Grand Total": po.grandTotal,
    }));

    // Create workbook and worksheet
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Purchase Orders");

    // Generate buffer
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    // Set headers for file download
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=purchase-summary-${startDate || 'all'}-to-${endDate || 'all'}.xlsx`
    );

    res.send(buffer);
  } catch (error) {
    console.error("Error exporting purchase summary:", error);
    res.status(500).json({
      success: false,
      error: "Failed to export purchase summary",
      message: error.message,
    });
  }
};

// Bills Summary Report
const getBillsSummaryReport = async (req, res) => {
  try {
    const { startDate, endDate, supplierId, warehouseId, paymentStatus } = req.query;

    const filter = {};
    
    if (supplierId && supplierId !== "all") filter.supplierId = supplierId;
    if (warehouseId && warehouseId !== "all") filter.warehouseId = warehouseId;
    if (paymentStatus && paymentStatus !== "all") filter.paymentStatus = paymentStatus;

    if (startDate || endDate) {
      filter.billDate = {};
      if (startDate) filter.billDate.gte = new Date(startDate);
      if (endDate) filter.billDate.lte = new Date(endDate);
    }

    const bills = await prisma.bill.findMany({
      where: filter,
      include: {
        items: true,
        supplier: true,
      },
      orderBy: { billDate: "desc" },
    });

    // Calculate summary
    const summary = {
      totalBills: bills.length,
      totalAmount: bills.reduce((sum, bill) => sum + bill.grandTotal, 0),
      totalQuantity: bills.reduce((sum, bill) => sum + bill.totalQuantity, 0),
      totalGST: bills.reduce((sum, bill) => sum + bill.totalGST, 0),
      totalDiscount: bills.reduce((sum, bill) => sum + bill.totalDiscount, 0),
      byPaymentStatus: {},
      bySupplier: {},
      byWarehouse: {},
    };

    // Group by payment status
    bills.forEach((bill) => {
      if (!summary.byPaymentStatus[bill.paymentStatus]) {
        summary.byPaymentStatus[bill.paymentStatus] = {
          count: 0,
          amount: 0,
        };
      }
      summary.byPaymentStatus[bill.paymentStatus].count++;
      summary.byPaymentStatus[bill.paymentStatus].amount += bill.grandTotal;
    });

    // Group by supplier
    bills.forEach((bill) => {
      if (!summary.bySupplier[bill.supplierName]) {
        summary.bySupplier[bill.supplierName] = {
          count: 0,
          amount: 0,
        };
      }
      summary.bySupplier[bill.supplierName].count++;
      summary.bySupplier[bill.supplierName].amount += bill.grandTotal;
    });

    // Group by warehouse
    bills.forEach((bill) => {
      if (!summary.byWarehouse[bill.warehouseName]) {
        summary.byWarehouse[bill.warehouseName] = {
          count: 0,
          amount: 0,
        };
      }
      summary.byWarehouse[bill.warehouseName].count++;
      summary.byWarehouse[bill.warehouseName].amount += bill.grandTotal;
    });

    res.status(200).json({
      success: true,
      data: {
        summary,
        bills,
      },
    });
  } catch (error) {
    console.error("Error generating bills summary report:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate bills summary report",
      message: error.message,
    });
  }
};

// Export Bills Summary to Excel
const exportBillsSummaryExcel = async (req, res) => {
  try {
    const { startDate, endDate, supplierId, warehouseId, paymentStatus } = req.query;

    const filter = {};
    
    if (supplierId && supplierId !== "all") filter.supplierId = supplierId;
    if (warehouseId && warehouseId !== "all") filter.warehouseId = warehouseId;
    if (paymentStatus && paymentStatus !== "all") filter.paymentStatus = paymentStatus;

    if (startDate || endDate) {
      filter.billDate = {};
      if (startDate) filter.billDate.gte = new Date(startDate);
      if (endDate) filter.billDate.lte = new Date(endDate);
    }

    const bills = await prisma.bill.findMany({
      where: filter,
      include: {
        items: true,
        supplier: true,
      },
      orderBy: { billDate: "desc" },
    });

    // Prepare Excel data
    const excelData = bills.map((bill) => ({
      "Bill ID": bill.billId,
      "GRN Number": bill.grnNumber,
      "Supplier Invoice Number": bill.supplierInvoiceNo || "",
      "Bill Date": bill.billDate.toISOString().split('T')[0],
      "Received Date": bill.receivedDate.toISOString().split('T')[0],
      "Supplier Name": bill.supplierName,
      "Supplier Phone": bill.supplierPhone,
      "Supplier Email": bill.supplierEmail,
      "Supplier GSTIN": bill.supplierGSTIN || "",
      "Warehouse": bill.warehouseName,
      "Payment Status": bill.paymentStatus,
      "Due Date": bill.billDueDate ? bill.billDueDate.toISOString().split('T')[0] : "",
      "Sub Total": bill.subTotal,
      "Total Quantity": bill.totalQuantity,
      "Total Discount": bill.totalDiscount,
      "CGST": bill.totalCGST,
      "SGST": bill.totalSGST,
      "IGST": bill.totalIGST,
      "Total GST": bill.totalGST,
      "Other Charges": bill.otherCharges,
      "Grand Total": bill.grandTotal,
      "Paid Amount": bill.paidAmount || 0,
      "Balance": bill.grandTotal - (bill.paidAmount || 0),
      "Transporter Name": bill.transporterName || "",
      "Vehicle Number": bill.vehicleNumber || "",
    }));

    // Create workbook and worksheet
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Bills Summary");

    // Generate buffer
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    // Set headers for file download
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=bills-summary-${startDate || 'all'}-to-${endDate || 'all'}.xlsx`
    );

    res.send(buffer);
  } catch (error) {
    console.error("Error exporting bills summary:", error);
    res.status(500).json({
      success: false,
      error: "Failed to export bills summary",
      message: error.message,
    });
  }
};

// Expenses Summary Report
const getExpensesSummaryReport = async (req, res) => {
  try {
    const { startDate, endDate, categoryId, status, supplierId } = req.query;

    const filter = {};
    
    if (categoryId && categoryId !== "all") filter.categoryId = categoryId;
    if (status && status !== "all") filter.status = status;
    if (supplierId && supplierId !== "all") filter.supplierId = supplierId;

    if (startDate || endDate) {
      filter.expenseDate = {};
      if (startDate) filter.expenseDate.gte = new Date(startDate);
      if (endDate) filter.expenseDate.lte = new Date(endDate);
    }

    const expenses = await prisma.expense.findMany({
      where: filter,
      include: {
        category: true,
      },
      orderBy: { expenseDate: "desc" },
    });

    // Calculate summary
    const summary = {
      totalExpenses: expenses.length,
      totalAmount: expenses.reduce((sum, exp) => sum + exp.amount, 0),
      byStatus: {},
      byCategory: {},
      byPaymentMethod: {},
    };

    // Group by status
    expenses.forEach((exp) => {
      if (!summary.byStatus[exp.status]) {
        summary.byStatus[exp.status] = {
          count: 0,
          amount: 0,
        };
      }
      summary.byStatus[exp.status].count++;
      summary.byStatus[exp.status].amount += exp.amount;
    });

    // Group by category
    expenses.forEach((exp) => {
      if (!summary.byCategory[exp.categoryName]) {
        summary.byCategory[exp.categoryName] = {
          count: 0,
          amount: 0,
        };
      }
      summary.byCategory[exp.categoryName].count++;
      summary.byCategory[exp.categoryName].amount += exp.amount;
    });

    // Group by payment method
    expenses.forEach((exp) => {
      const method = exp.paymentMethod || "Not Specified";
      if (!summary.byPaymentMethod[method]) {
        summary.byPaymentMethod[method] = {
          count: 0,
          amount: 0,
        };
      }
      summary.byPaymentMethod[method].count++;
      summary.byPaymentMethod[method].amount += exp.amount;
    });

    res.status(200).json({
      success: true,
      data: {
        summary,
        expenses,
      },
    });
  } catch (error) {
    console.error("Error generating expenses summary report:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate expenses summary report",
      message: error.message,
    });
  }
};

// Export Expenses Summary to Excel
const exportExpensesSummaryExcel = async (req, res) => {
  try {
    const { startDate, endDate, categoryId, status, supplierId } = req.query;

    const filter = {};
    
    if (categoryId && categoryId !== "all") filter.categoryId = categoryId;
    if (status && status !== "all") filter.status = status;
    if (supplierId && supplierId !== "all") filter.supplierId = supplierId;

    if (startDate || endDate) {
      filter.expenseDate = {};
      if (startDate) filter.expenseDate.gte = new Date(startDate);
      if (endDate) filter.expenseDate.lte = new Date(endDate);
    }

    const expenses = await prisma.expense.findMany({
      where: filter,
      include: {
        category: true,
      },
      orderBy: { expenseDate: "desc" },
    });

    // Prepare Excel data
    const excelData = expenses.map((expense) => ({
      "Expense ID": expense.expenseNumber,
      "Date": expense.expenseDate.toISOString().split('T')[0],
      "Category": expense.categoryName,
      "Expense Name": expense.expense,
      "Description": expense.description || "",
      "Amount": expense.amount,
      "Payment Method": expense.paymentMethod || "",
      "Status": expense.status,
      "Supplier/Vendor": expense.supplierName || "",
      "Notes": expense.notes || "",
    }));

    // Create workbook and worksheet
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Expenses Summary");

    // Generate buffer
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    // Set headers for file download
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=expenses-summary-${startDate || 'all'}-to-${endDate || 'all'}.xlsx`
    );

    res.send(buffer);
  } catch (error) {
    console.error("Error exporting expenses summary:", error);
    res.status(500).json({
      success: false,
      error: "Failed to export expenses summary",
      message: error.message,
    });
  }
};

module.exports = {
  getPurchaseSummaryReport,
  exportPurchaseSummaryExcel,
  getBillsSummaryReport,
  exportBillsSummaryExcel,
  getExpensesSummaryReport,
  exportExpensesSummaryExcel,
};
