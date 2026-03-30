const { prisma } = require("../../config/database");
const PDFDocument = require("pdfkit");
const { generateInvoiceNumber } = require("../../utils/order/invoiceGenerator");

// Generate POS invoice number
const generatePOSInvoiceNumber = async (req, res) => {
  try {
    // Always peek (do not increment) for the standalone endpoint
    // The actual increment happens in createPOSOrder
    const result = await generateInvoiceNumber({ increment: false });

    if (!result) {
      return res.status(400).json({
        success: false,
        error: "Invoice settings not configured or inactive",
      });
    }

    const { invoiceNumber, financialYear, nextSequenceNo, settings: metaSettings } = result;

    res.status(200).json({
      success: true,
      invoiceNumber,
      data: {
        invoiceNumber,
        nextSequenceNo,
        settings: {
          prefix: metaSettings.prefix,
          format: metaSettings.format,
          financialYear,
        },
      },
    });
  } catch (error) {
    console.error("Error generating POS invoice number:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate POS invoice number",
      message: error.message,
    });
  }
};

// Get invoice settings
const getInvoiceSettings = async (req, res) => {
  try {
    const settings = await prisma.invoiceSettings.findFirst();

    if (!settings) {
      return res.status(404).json({
        success: false,
        error: "Invoice settings not found",
      });
    }

    res.status(200).json({
      success: true,
      data: settings,
    });
  } catch (error) {
    console.error("Error fetching invoice settings:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch invoice settings",
      message: error.message,
    });
  }
};

// Get invoice details by order number
const getInvoiceDetails = async (req, res) => {
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
        error: "Order not found",
      });
    }

    // Get company settings for invoice header
    const companySettings = await prisma.companySettings.findFirst();

    res.json({
      success: true,
      data: {
        order,
        company: companySettings,
      },
    });
  } catch (error) {
    console.error("Error fetching invoice details:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch invoice details",
      message: error.message,
    });
  }
};

// Generate PDF invoice
const generateInvoicePDF = async (order, company) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const chunks = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // Header
      doc.fontSize(20).text(company?.companyName || "Company Name", { align: "center" });
      doc.fontSize(10).text(company?.address || "", { align: "center" });
      doc.text(`${company?.city || ""}, ${company?.state || ""} ${company?.zipCode || ""}`, { align: "center" });
      doc.text(`Phone: ${company?.phone || ""} | Email: ${company?.email || ""}`, { align: "center" });
      doc.moveDown();

      // Invoice details
      doc.fontSize(16).text("TAX INVOICE", { align: "center", underline: true });
      doc.moveDown();

      doc.fontSize(10);
      doc.text(`Invoice No: ${order.invoiceNumber || order.orderNumber}`, 50, doc.y);
      doc.text(`Date: ${new Date(order.createdAt).toLocaleDateString()}`, 400, doc.y - 12);
      doc.moveDown();

      // Customer details
      if (order.customerName) {
        doc.text("Bill To:");
        doc.text(order.customerName);
        if (order.customerPhone) doc.text(`Phone: ${order.customerPhone}`);
        if (order.customerEmail) doc.text(`Email: ${order.customerEmail}`);
        doc.moveDown();
      }

      // Table header
      const tableTop = doc.y;
      doc.fontSize(10).font("Helvetica-Bold");
      doc.text("Item", 50, tableTop);
      doc.text("Qty", 250, tableTop);
      doc.text("Price", 300, tableTop);
      doc.text("Disc%", 350, tableTop);
      doc.text("GST%", 400, tableTop);
      doc.text("Amount", 480, tableTop, { align: "right" });
      doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

      // Table rows
      doc.font("Helvetica");
      let yPosition = tableTop + 25;

      order.items.forEach((item) => {
        doc.text(item.productName, 50, yPosition, { width: 180 });
        doc.text(item.quantity.toString(), 250, yPosition);
        doc.text(`₹${item.unitPrice.toFixed(2)}`, 300, yPosition);
        doc.text(`${item.discount}%`, 350, yPosition);
        doc.text(`${item.gstPercentage}%`, 400, yPosition);
        doc.text(`₹${item.total.toFixed(2)}`, 480, yPosition, { align: "right" });
        yPosition += 25;
      });

      // Line before totals
      doc.moveTo(50, yPosition).lineTo(550, yPosition).stroke();
      yPosition += 10;

      // Totals
      doc.font("Helvetica");
      doc.text("Subtotal:", 400, yPosition);
      doc.text(`₹${order.subtotal.toFixed(2)}`, 480, yPosition, { align: "right" });
      yPosition += 20;

      if (order.discount > 0) {
        doc.text("Discount:", 400, yPosition);
        doc.text(`-₹${order.discount.toFixed(2)}`, 480, yPosition, { align: "right" });
        yPosition += 20;
      }

      doc.text(`Tax (${order.taxRate}%):`, 400, yPosition);
      doc.text(`₹${order.tax.toFixed(2)}`, 480, yPosition, { align: "right" });
      yPosition += 20;

      if (order.roundingOff !== 0) {
        doc.text("Rounding Off:", 400, yPosition);
        doc.text(`₹${order.roundingOff.toFixed(2)}`, 480, yPosition, { align: "right" });
        yPosition += 20;
      }

      doc.font("Helvetica-Bold").fontSize(12);
      doc.text("Total:", 400, yPosition);
      doc.text(`₹${order.total.toFixed(2)}`, 480, yPosition, { align: "right" });

      // Payment details
      yPosition += 30;
      doc.font("Helvetica").fontSize(10);
      doc.text(`Payment Method: ${order.paymentMethod.toUpperCase()}`, 50, yPosition);
      doc.text(`Amount Received: ₹${order.amountReceived.toFixed(2)}`, 50, yPosition + 15);
      if (order.changeGiven > 0) {
        doc.text(`Change Given: ₹${order.changeGiven.toFixed(2)}`, 50, yPosition + 30);
      }

      // Footer
      doc.fontSize(8).text("Thank you for your business!", 50, 750, { align: "center" });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

// Download invoice PDF
const downloadInvoicePDF = async (req, res) => {
  try {
    const { orderNumber } = req.params;

    const order = await prisma.pOSOrder.findUnique({
      where: { orderNumber },
      include: { items: true },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: "Order not found",
      });
    }

    const company = await prisma.companySettings.findFirst();
    const pdfBuffer = await generateInvoicePDF(order, company);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=pos-invoice-${orderNumber}.pdf`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error("Error generating invoice PDF:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate invoice PDF",
      message: error.message,
    });
  }
};

// Preview invoice PDF
const previewInvoicePDF = async (req, res) => {
  try {
    const { orderNumber } = req.params;

    const order = await prisma.pOSOrder.findUnique({
      where: { orderNumber },
      include: { items: true },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: "Order not found",
      });
    }

    const company = await prisma.companySettings.findFirst();
    const pdfBuffer = await generateInvoicePDF(order, company);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=pos-invoice-${orderNumber}.pdf`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error("Error previewing invoice PDF:", error);
    res.status(500).json({
      success: false,
      error: "Failed to preview invoice PDF",
      message: error.message,
    });
  }
};

module.exports = {
  generatePOSInvoiceNumber,
  getInvoiceSettings,
  getInvoiceDetails,
  downloadInvoicePDF,
  previewInvoicePDF,
};
