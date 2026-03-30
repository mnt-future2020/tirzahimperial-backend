const { prisma } = require("../../config/database");
const { uploadToS3, deleteFromS3, getPresignedUrl } = require("../../utils/purchase/uploadsS3");

// Generate Expense Number from database
const generateExpenseNumber = async () => {
  const currentYear = new Date().getFullYear();
  
  const latestExpense = await prisma.expense.findFirst({
    where: {
      expenseNumber: {
        startsWith: `EXP-${currentYear}-`,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  let nextNumber = 1;
  if (latestExpense) {
    const parts = latestExpense.expenseNumber.split("-");
    const lastNumber = parseInt(parts[2], 10);
    nextNumber = lastNumber + 1;
  }

  const paddedNumber = nextNumber.toString().padStart(3, "0");
  return `EXP-${currentYear}-${paddedNumber}`;
};

// Get all expenses
const getAllExpenses = async (req, res) => {
  try {
    const { categoryId, status, startDate, endDate, supplierId } = req.query;

    const filter = {};

    if (categoryId) filter.categoryId = categoryId;
    if (status) filter.status = status;
    if (supplierId) filter.supplierId = supplierId;

    if (startDate || endDate) {
      filter.expenseDate = {};
      if (startDate) filter.expenseDate.gte = new Date(startDate);
      if (endDate) filter.expenseDate.lte = new Date(endDate);
    }

    const expenses = await prisma.expense.findMany({
      where: filter,
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { expenseDate: "desc" },
    });

    // Generate pre-signed URLs for receipts
    const expensesWithUrls = await Promise.all(
      expenses.map(async (expense) => ({
        ...expense,
        receiptUrl: expense.receiptUrl 
          ? getPresignedUrl(expense.receiptUrl)
          : null,
      }))
    );

    res.status(200).json({
      success: true,
      count: expensesWithUrls.length,
      data: expensesWithUrls,
    });
  } catch (error) {
    console.error("Error fetching expenses:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch expenses",
      message: error.message,
    });
  }
};

// Get expense by ID
const getExpenseById = async (req, res) => {
  try {
    const { id } = req.params;

    const expense = await prisma.expense.findUnique({
      where: { id },
      include: {
        category: true,
      },
    });

    if (!expense) {
      return res.status(404).json({
        success: false,
        error: "Expense not found",
      });
    }

    // Generate proxy URL for receipt
    if (expense.receiptUrl) {
      expense.receiptUrl = getPresignedUrl(expense.receiptUrl);
    }

    res.status(200).json({
      success: true,
      data: expense,
    });
  } catch (error) {
    console.error("Error fetching expense:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch expense",
      message: error.message,
    });
  }
};

// Get next expense number (for frontend)
const getNextExpenseNumber = async (req, res) => {
  try {
    const expenseNumber = await generateExpenseNumber();
    
    res.status(200).json({
      success: true,
      data: { expenseNumber },
    });
  } catch (error) {
    console.error("Error generating expense number:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate expense number",
      message: error.message,
    });
  }
};

// Create expense
const createExpense = async (req, res) => {
  try {
    const {
      categoryId,
      expense,
      description,
      amount,
      expenseDate,
      paymentMethod,
      supplierId,
      supplierName,
      vendor,
      status,
      notes,
      receiptUrl,
    } = req.body;

    // Validation
    if (!categoryId || !expense || !amount || !expenseDate) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
        required: ["categoryId", "expense", "amount", "expenseDate"],
      });
    }

    // Validate status
    const validStatuses = ["pending", "paid"];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status. Must be one of: pending, paid",
      });
    }

    // Verify category exists
    const category = await prisma.expenseCategory.findUnique({
      where: { id: categoryId },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: "Expense category not found",
      });
    }

    // If supplierId is provided and not "other" or manual ID, verify supplier exists
    if (supplierId && supplierId !== "other" && !supplierId.startsWith("manual_")) {
      const supplier = await prisma.supplier.findUnique({
        where: { id: supplierId },
      });

      if (!supplier) {
        return res.status(404).json({
          success: false,
          error: "Supplier not found",
        });
      }
    }

    // Handle receipt upload
    let uploadedReceiptUrl = receiptUrl || null;
    if (req.file) {
      uploadedReceiptUrl = await uploadToS3(req.file, "expense-receipts");
    }

    // Generate expense number from database
    const expenseNumber = await generateExpenseNumber();

    const expenseData = await prisma.expense.create({
      data: {
        expenseNumber,
        categoryId,
        categoryName: category.name,
        expense,
        description: description || null,
        amount: parseFloat(amount),
        expenseDate: new Date(expenseDate),
        paymentMethod: paymentMethod || null,
        supplierId: supplierId && supplierId !== "other" && !supplierId.startsWith("manual_") ? supplierId : null,
        supplierName: supplierName || null,
        vendor: vendor || supplierName || null,
        receiptUrl: uploadedReceiptUrl,
        status: status || "pending",
        notes: notes || null,
      },
      include: {
        category: true,
      },
    });

    res.status(201).json({
      success: true,
      message: "Expense created successfully",
      data: expenseData,
    });
  } catch (error) {
    console.error("Error creating expense:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create expense",
      message: error.message,
    });
  }
};

// Update expense
const updateExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      categoryId,
      expense,
      description,
      amount,
      expenseDate,
      paymentMethod,
      supplierId,
      supplierName,
      vendor,
      status,
      notes,
      receiptUrl,
      removeReceipt,
      existingReceipt,
    } = req.body;

    const existingExpense = await prisma.expense.findUnique({
      where: { id },
    });

    if (!existingExpense) {
      return res.status(404).json({
        success: false,
        error: "Expense not found",
      });
    }

    // Validate status if provided
    if (status) {
      const validStatuses = ["pending", "paid"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          error: "Invalid status. Must be one of: pending, paid",
        });
      }
    }

    // If category is being changed, verify new category exists
    let categoryName = existingExpense.categoryName;
    if (categoryId && categoryId !== existingExpense.categoryId) {
      const category = await prisma.expenseCategory.findUnique({
        where: { id: categoryId },
      });

      if (!category) {
        return res.status(404).json({
          success: false,
          error: "Expense category not found",
        });
      }

      categoryName = category.name;
    }

    // If supplierId is provided and not "other" or manual ID, verify supplier exists
    if (supplierId && supplierId !== "other" && !supplierId.startsWith("manual_")) {
      const supplier = await prisma.supplier.findUnique({
        where: { id: supplierId },
      });

      if (!supplier) {
        return res.status(404).json({
          success: false,
          error: "Supplier not found",
        });
      }
    }

    // Handle receipt upload
    let uploadedReceiptUrl = existingExpense.receiptUrl;
    
    if (removeReceipt) {
      if (existingExpense.receiptUrl) {
        await deleteFromS3(existingExpense.receiptUrl);
      }
      uploadedReceiptUrl = null;
    } else if (req.file) {
      if (existingExpense.receiptUrl) {
        await deleteFromS3(existingExpense.receiptUrl);
      }
      uploadedReceiptUrl = await uploadToS3(req.file, "expense-receipts");
    } else if (receiptUrl !== undefined && receiptUrl !== existingExpense.receiptUrl) {
      if (existingExpense.receiptUrl && receiptUrl !== existingExpense.receiptUrl) {
        await deleteFromS3(existingExpense.receiptUrl);
      }
      uploadedReceiptUrl = receiptUrl;
    } else if (receiptUrl === "") {
      if (existingExpense.receiptUrl) {
        await deleteFromS3(existingExpense.receiptUrl);
      }
      uploadedReceiptUrl = null;
    }

    const updatedExpense = await prisma.expense.update({
      where: { id },
      data: {
        categoryId: categoryId || existingExpense.categoryId,
        categoryName,
        expense: expense || existingExpense.expense,
        description: description !== undefined ? description : existingExpense.description,
        amount: amount !== undefined ? parseFloat(amount) : existingExpense.amount,
        expenseDate: expenseDate ? new Date(expenseDate) : existingExpense.expenseDate,
        paymentMethod: paymentMethod !== undefined ? paymentMethod : existingExpense.paymentMethod,
        supplierId: supplierId !== undefined ? (supplierId && supplierId !== "other" && !supplierId.startsWith("manual_") ? supplierId : null) : existingExpense.supplierId,
        supplierName: supplierName !== undefined ? supplierName : existingExpense.supplierName,
        vendor: vendor !== undefined ? vendor : (supplierName || existingExpense.vendor),
        receiptUrl: uploadedReceiptUrl,
        status: status || existingExpense.status,
        notes: notes !== undefined ? notes : existingExpense.notes,
      },
      include: {
        category: true,
      },
    });

    res.status(200).json({
      success: true,
      message: "Expense updated successfully",
      data: updatedExpense,
    });
  } catch (error) {
    console.error("Error updating expense:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update expense",
      message: error.message,
    });
  }
};

// Get expense statistics
const getExpenseStats = async (req, res) => {
  try {
    const totalExpenses = await prisma.expense.count();
    
    const pendingExpenses = await prisma.expense.count({
      where: { status: "pending" },
    });

    const paidExpenses = await prisma.expense.count({
      where: { status: "paid" },
    });

    // Calculate total amounts
    const totalAmount = await prisma.expense.aggregate({
      _sum: { amount: true },
    });

    const pendingAmount = await prisma.expense.aggregate({
      where: { status: "pending" },
      _sum: { amount: true },
    });

    const paidAmount = await prisma.expense.aggregate({
      where: { status: "paid" },
      _sum: { amount: true },
    });

    // Get expenses by category
    const expensesByCategory = await prisma.expense.groupBy({
      by: ["categoryName"],
      _sum: { amount: true },
      _count: true,
      orderBy: {
        _sum: {
          amount: "desc",
        },
      },
    });

    // Get recent expenses
    const recentExpenses = await prisma.expense.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        expense: true,
        categoryName: true,
        amount: true,
        status: true,
        expenseDate: true,
      },
    });

    res.status(200).json({
      success: true,
      data: {
        total: totalExpenses,
        pending: pendingExpenses,
        paid: paidExpenses,
        totalAmount: totalAmount._sum.amount || 0,
        pendingAmount: pendingAmount._sum.amount || 0,
        paidAmount: paidAmount._sum.amount || 0,
        expensesByCategory,
        recentExpenses,
      },
    });
  } catch (error) {
    console.error("Error fetching expense stats:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch expense statistics",
      message: error.message,
    });
  }
};

// Get expenses by category
const getExpensesByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;

    const expenses = await prisma.expense.findMany({
      where: { categoryId },
      orderBy: { expenseDate: "desc" },
    });

    res.status(200).json({
      success: true,
      count: expenses.length,
      data: expenses,
    });
  } catch (error) {
    console.error("Error fetching expenses by category:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch expenses",
      message: error.message,
    });
  }
};

module.exports = {
  getAllExpenses,
  getExpenseById,
  getNextExpenseNumber,
  createExpense,
  updateExpense,
  getExpenseStats,
  getExpensesByCategory,
};
