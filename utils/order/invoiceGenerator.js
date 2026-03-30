/**
 * Generate invoice number from settings
 */
const { prisma } = require("../../config/database");

/**
 * Generate invoice number from settings
 * @param {Object} options - Options object
 * @param {Object} [options.tx] - Prisma transaction client
 * @param {boolean} [options.increment=true] - Whether to increment sequence number
 * @returns {Promise<Object>} Object containing invoiceNumber and metadata
 */
const generateInvoiceNumber = async (txOrOptions = null) => {
  // Support both (tx) and ({ tx, increment }) signatures for backward compatibility
  let tx = null;
  let increment = true;

  if (txOrOptions) {
    if (txOrOptions && (txOrOptions.constructor && txOrOptions.constructor.name === "PrismaClient" || txOrOptions.$transaction)) {
      // It's a prisma instance/transaction
      tx = txOrOptions;
    } else {
      // It's an options object
      tx = txOrOptions.tx || null;
      if (txOrOptions.increment !== undefined) increment = txOrOptions.increment;
    }
  }
  const db = tx || prisma;
  
  const settings = await db.invoiceSettings.findFirst();

  if (!settings || !settings.isActive) {
    return null;
  }

  // Calculate financial year string and handle auto-rollover
  let financialYear = "";
  let fyStart = new Date(settings.financialYearStart);
  let fyEnd = new Date(settings.financialYearEnd);
  const now = new Date();

  if (settings.autoFinancialYear) {
    // Check if current date has passed the current financial year period
    // If so, we need to roll forward to the current active period
    if (now > fyEnd) {
      let tempStart = new Date(fyStart);
      let tempEnd = new Date(fyEnd);
      
      // Roll forward as many years as needed to reach current period
      while (now > tempEnd) {
        tempStart.setFullYear(tempStart.getFullYear() + 1);
        tempEnd.setFullYear(tempEnd.getFullYear() + 1);
      }

      // Update settings in database to reflect current period
      const updatedSettings = await db.invoiceSettings.update({
        where: { id: settings.id },
        data: {
          financialYearStart: tempStart,
          financialYearEnd: tempEnd
        }
      });
      
      fyStart = updatedSettings.financialYearStart;
      fyEnd = updatedSettings.financialYearEnd;
    }

    const startYear = fyStart.getFullYear();
    const endYear = startYear + 1;
    financialYear = `${startYear}-${endYear.toString().slice(-2)}`;
  } else {
    // If auto is OFF, we use manualFinancialYear text if provided, 
    // otherwise fallback to the year of the settings dates
    if (settings.manualFinancialYear) {
      financialYear = settings.manualFinancialYear;
    } else {
      const startYear = fyStart.getFullYear();
      const endYear = startYear + 1;
      financialYear = `${startYear}-${endYear.toString().slice(-2)}`;
    }
  }

  // Get or initialize sequence for the current financial year
  let sequenceRecord = await db.invoiceSequence.findUnique({
    where: { financialYear }
  });

  // Atomic increment or initial creation
  let sequenceNumberToUse;
  let nextSequenceNo;

  if (increment) {
    if (!sequenceRecord) {
      // Initialize sequence for new FY - we use 1 and then next is 2
      sequenceRecord = await db.invoiceSequence.create({
        data: { financialYear, currentSequenceNo: 2 }
      });
      sequenceNumberToUse = 1;
      nextSequenceNo = 2;
    } else {
      // Increment existing sequence
      const updatedSequence = await db.invoiceSequence.update({
        where: { financialYear },
        data: { currentSequenceNo: { increment: 1 } }
      });
      sequenceNumberToUse = updatedSequence.currentSequenceNo - 1;
      nextSequenceNo = updatedSequence.currentSequenceNo;
    }
  } else {
    // Just read the current number without incrementing
    sequenceNumberToUse = sequenceRecord ? sequenceRecord.currentSequenceNo : 1;
    nextSequenceNo = sequenceNumberToUse + 1;
  }

  const sequence = String(sequenceNumberToUse).padStart(
    settings.invoiceSequenceLength,
    "0"
  );
  
  let invoiceNumber = settings.invoiceFormat
    .replace(/\{PREFIX\}|\[PREFIX\]/gi, settings.invoicePrefix)
    .replace(/\{FY\}|\[FY\]/gi, financialYear)
    .replace(/\{SEQ\}|\[SEQ\]/gi, sequence);

  // Return full object to satisfy all controllers
  return {
    invoiceNumber,
    financialYear,
    sequence,
    currentSequenceNo: sequenceNumberToUse,
    nextSequenceNo: nextSequenceNo,
    settings: {
        prefix: settings.invoicePrefix,
        format: settings.invoiceFormat,
    }
  };
};

module.exports = {
  generateInvoiceNumber,
};
