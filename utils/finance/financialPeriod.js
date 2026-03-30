/**
 * Financial Period Utilities
 * Calculate financial year and accounting period based on invoice settings
 */

const { prisma } = require("../../config/database");

/**
 * Get financial year and accounting period for a given date
 * @param {Date} date - The date to calculate for
 * @returns {Promise<{financialYear: string, accountingPeriod: string}>}
 */
const getFinancialPeriod = async (date = new Date()) => {
  try {
    // Get invoice settings to determine financial year start
    const settings = await prisma.invoiceSettings.findFirst({
      where: { isActive: true },
    });

    let financialYear = "";
    let fyStartMonth = 3; // Default: April (0-indexed, so 3 = April)

    if (settings && settings.autoFinancialYear) {
      const fyStart = new Date(settings.financialYearStart);
      fyStartMonth = fyStart.getMonth();

      // Determine financial year based on FY start month
      const currentYear = date.getFullYear();
      const currentMonth = date.getMonth();

      if (currentMonth >= fyStartMonth) {
        // Current FY
        financialYear = `${currentYear}-${(currentYear + 1).toString().slice(-2)}`;
      } else {
        // Previous FY
        financialYear = `${currentYear - 1}-${currentYear.toString().slice(-2)}`;
      }
    } else if (settings && settings.manualFinancialYear) {
      financialYear = settings.manualFinancialYear;
    } else {
      // Fallback: April-March cycle
      const currentYear = date.getFullYear();
      const currentMonth = date.getMonth();

      if (currentMonth >= 3) {
        // April onwards
        financialYear = `${currentYear}-${(currentYear + 1).toString().slice(-2)}`;
      } else {
        // Jan-March
        financialYear = `${currentYear - 1}-${currentYear.toString().slice(-2)}`;
      }
    }

    // Calculate accounting period (YYYY-MM format)
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const accountingPeriod = `${year}-${month}`;

    return {
      financialYear,
      accountingPeriod,
    };
  } catch (error) {
    console.error("Error calculating financial period:", error);
    // Fallback to current year
    const currentYear = new Date().getFullYear();
    const currentMonth = String(new Date().getMonth() + 1).padStart(2, "0");
    return {
      financialYear: `${currentYear}-${(currentYear + 1).toString().slice(-2)}`,
      accountingPeriod: `${currentYear}-${currentMonth}`,
    };
  }
};

/**
 * Get all available financial years from orders
 * @returns {Promise<string[]>}
 */
const getAvailableFinancialYears = async () => {
  try {
    const posYears = await prisma.pOSOrder.findMany({
      where: { financialYear: { not: null } },
      select: { financialYear: true },
      distinct: ["financialYear"],
      orderBy: { financialYear: "desc" },
    });

    const onlineYears = await prisma.onlineOrder.findMany({
      where: { financialYear: { not: null } },
      select: { financialYear: true },
      distinct: ["financialYear"],
      orderBy: { financialYear: "desc" },
    });

    // Combine and deduplicate
    const allYears = [
      ...new Set([
        ...posYears.map((y) => y.financialYear),
        ...onlineYears.map((y) => y.financialYear),
      ]),
    ]
      .filter(Boolean)
      .sort()
      .reverse();

    return allYears;
  } catch (error) {
    console.error("Error fetching financial years:", error);
    return [];
  }
};

module.exports = {
  getFinancialPeriod,
  getAvailableFinancialYears,
};
