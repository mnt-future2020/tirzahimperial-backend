const { prisma } = require("../../config/database");

/**
 * Get all transactions
 * GET /api/finance/transactions
 */
const getAllTransactions = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      paymentStatus,
      transactionType,
      accountingPeriod,
      financialYear,
      startDate,
      endDate,
      search,
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const where = {};

    if (paymentStatus && paymentStatus !== "all") {
      where.paymentStatus = paymentStatus;
    }

    if (transactionType && transactionType !== "all") {
      where.transactionType = transactionType;
    }

    if (accountingPeriod) {
      where.accountingPeriod = accountingPeriod;
    }

    if (financialYear) {
      where.financialYear = financialYear;
    }

    if (startDate && endDate) {
      where.transactionDate = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    if (search) {
      where.OR = [
        { transactionId: { contains: search, mode: "insensitive" } },
        { referenceNumber: { contains: search, mode: "insensitive" } },
        { customerName: { contains: search, mode: "insensitive" } },
        { customerEmail: { contains: search, mode: "insensitive" } },
      ];
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: { transactionDate: "desc" },
        skip,
        take,
      }),
      prisma.transaction.count({ where }),
    ]);

    res.json({
      success: true,
      data: transactions,
      pagination: {
        page: parseInt(page),
        limit: take,
        total,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (error) {
    console.error("Error fetching transactions:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch transactions",
      message: error.message,
    });
  }
};

/**
 * Get transaction by ID
 * GET /api/finance/transactions/:transactionId
 */
const getTransactionById = async (req, res) => {
  try {
    const { transactionId } = req.params;

    const transaction = await prisma.transaction.findUnique({
      where: { transactionId },
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: "Transaction not found",
      });
    }

    // Get related order if exists
    let relatedOrder = null;
    if (transaction.referenceType === "online_order" && transaction.referenceNumber) {
      relatedOrder = await prisma.onlineOrder.findUnique({
        where: { orderNumber: transaction.referenceNumber },
      });
    } else if (transaction.referenceType === "pos_order" && transaction.referenceNumber) {
      relatedOrder = await prisma.pOSOrder.findUnique({
        where: { orderNumber: transaction.referenceNumber },
        include: { items: true },
      });
    }

    res.json({
      success: true,
      data: {
        transaction,
        relatedOrder,
      },
    });
  } catch (error) {
    console.error("Error fetching transaction:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch transaction",
      message: error.message,
    });
  }
};

module.exports = {
  getAllTransactions,
  getTransactionById,
};
