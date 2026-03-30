const { prisma } = require("../../config/database");
const { generateInvoiceNumber: generateInvoiceNumberUtil } = require("../../utils/order/invoiceGenerator");

// Get invoice settings
const getInvoiceSettings = async (req, res) => {
  try {
    // Get the first (and should be only) settings record
    let settings = await prisma.invoiceSettings.findFirst();

    // If no settings exist, create default settings
    if (!settings) {
      const currentYear = new Date().getFullYear();
      const fyStart = new Date(currentYear, 3, 1); // April 1st of current year
      const fyEnd = new Date(currentYear + 1, 2, 31); // March 31st of next year
      
      settings = await prisma.invoiceSettings.create({
        data: {
          invoicePrefix: "INV",
          invoiceSequenceLength: 4,
          financialYearStart: fyStart,
          financialYearEnd: fyEnd,
          autoFinancialYear: true,
          invoiceFormat: "{PREFIX}-{FY}-{SEQ}",
          isActive: true,
        },
      });
    }

    // Get current sequence for the active financial year to show in UI
    const invoicePreview = await generateInvoiceNumberUtil({ increment: false });

    res.status(200).json({
      success: true,
      data: {
        ...settings,
        currentSequenceNo: invoicePreview?.currentSequenceNo || 1
      },
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

// Update invoice settings
const updateInvoiceSettings = async (req, res) => {
  try {
    const {
      invoicePrefix,
      invoiceSequenceLength,
      financialYearStart,
      financialYearEnd,
      autoFinancialYear,
      manualFinancialYear,
      invoiceFormat,
      isActive,
    } = req.body;

    // Validation
    if (!invoicePrefix || invoicePrefix.trim() === "") {
      return res.status(400).json({
        success: false,
        error: "Invoice prefix is required",
      });
    }

    if (invoiceSequenceLength < 1 || invoiceSequenceLength > 10) {
      return res.status(400).json({
        success: false,
        error: "Invoice sequence length must be between 1 and 10",
      });
    }

    // Validate dates - should be valid date strings
    if (!financialYearStart || !financialYearEnd) {
      return res.status(400).json({
        success: false,
        error: "Financial year start and end dates are required",
      });
    }

    const startDate = new Date(financialYearStart);
    const endDate = new Date(financialYearEnd);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format for financial year dates",
      });
    }

    // Get existing settings
    let settings = await prisma.invoiceSettings.findFirst();

    const settingsData = {
      invoicePrefix: invoicePrefix.trim().toUpperCase(),
      invoiceSequenceLength: parseInt(invoiceSequenceLength),
      financialYearStart: new Date(financialYearStart),
      financialYearEnd: new Date(financialYearEnd),
      autoFinancialYear: autoFinancialYear === true || autoFinancialYear === "true",
      manualFinancialYear: manualFinancialYear || null,
      invoiceFormat: invoiceFormat || "{PREFIX}-{FY}-{SEQ}",
      isActive: isActive === true || isActive === "true",
    };

    if (settings) {
      // Update existing settings
      settings = await prisma.invoiceSettings.update({
        where: { id: settings.id },
        data: settingsData,
      });
    } else {
      // Create new settings
      settings = await prisma.invoiceSettings.create({
        data: settingsData,
      });
    }

    // Get current sequence for the active financial year to show in UI
    const invoicePreview = await generateInvoiceNumberUtil({ increment: false });

    res.status(200).json({
      success: true,
      message: "Invoice settings updated successfully",
      data: {
        ...settings,
        currentSequenceNo: invoicePreview?.currentSequenceNo || 1
      },
    });
  } catch (error) {
    console.error("Error updating invoice settings:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update invoice settings",
      message: error.message,
    });
  }
};

// Generate next invoice number
const generateInvoiceNumber = async (req, res) => {
  try {
    // For settings display/preview, we should NEVER increment the sequence
    const result = await generateInvoiceNumberUtil({ increment: false });

    if (!result) {
      return res.status(400).json({
        success: false,
        error: "Invoice settings not configured or inactive",
      });
    }

    res.status(200).json({
      success: true,
      data: {
        invoiceNumber: result.invoiceNumber,
        nextSequenceNo: result.nextSequenceNo,
      },
    });
  } catch (error) {
    console.error("Error generating invoice number:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate invoice number",
      message: error.message,
    });
  }
};

module.exports = {
  getInvoiceSettings,
  updateInvoiceSettings,
  generateInvoiceNumber,
};
