const { prisma } = require("../../config/database");

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
 * Transform customer data from database to API response format
 */
const transformCustomer = (customer) => ({
  id: customer.id,
  userId: customer.userId,
  name: customer.name,
  email: customer.email,
  phone: customer.phoneNumber || "",
  image: customer.image || null,
  isVerified: customer.isVerified,
  provider: customer.provider,
  phoneNumber: customer.phoneNumber || null,
  address: customer.address || null,
  city: customer.city || null,
  state: customer.state || null,
  zipCode: customer.zipCode || null,
  country: customer.country || null,
  dateOfBirth: customer.dateOfBirth ? customer.dateOfBirth.toISOString() : null,
  // Purchase Analytics
  totalOrders: customer.totalOrders || 0,
  totalSpent: customer.totalSpent || 0,
  lastOrderDate: customer.lastOrderDate ? customer.lastOrderDate.toISOString() : null,
  // Metadata
  joinedDate: customer.createdAt.toISOString(), // Use createdAt as joinedDate
  createdAt: customer.createdAt.toISOString(),
  updatedAt: customer.updatedAt.toISOString(),
});

/**
 * Get all customers with optional search and pagination
 * GET /api/customer/customers
 */
const getAllCustomers = async (req, res) => {
  try {
    const { search, page = 1, limit = 100 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { phoneNumber: { contains: search } },
          ],
        }
      : {};

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: "desc" },
      }),
      prisma.customer.count({ where }),
    ]);

    res.json({
      success: true,
      data: customers.map(transformCustomer),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Get all customers error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch customers",
      message: error.message,
    });
  }
};

/**
 * Get customer by ID
 * GET /api/customer/customers/:id
 */
const getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await prisma.customer.findUnique({
      where: { id },
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: "Customer not found",
      });
    }

    res.json({
      success: true,
      data: transformCustomer(customer),
    });
  } catch (error) {
    console.error("Get customer by ID error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch customer",
      message: error.message,
    });
  }
};

/**
 * Search customers
 * GET /api/customer/customers/search
 */
const searchCustomers = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim() === "") {
      return res.json({
        success: true,
        data: [],
      });
    }

    const customers = await prisma.customer.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { phoneNumber: { contains: q } },
        ],
      },
      take: 20,
      orderBy: { name: "asc" },
    });

    res.json({
      success: true,
      data: customers.map(transformCustomer),
    });
  } catch (error) {
    console.error("Search customers error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to search customers",
      message: error.message,
    });
  }
};

/**
 * Get customer statistics
 * GET /api/customer/customers/stats
 */
const getCustomerStats = async (req, res) => {
  try {
    const [
      totalCustomers,
      activeCustomers,
      verifiedCustomers,
      localProviderCount,
      googleProviderCount,
    ] = await Promise.all([
      prisma.customer.count(),
      prisma.customer.count({ where: { isVerified: true } }),
      prisma.customer.count({ where: { provider: "local" } }),
      prisma.customer.count({ where: { provider: "google" } }),
    ]);

    const stats = {
      totalCustomers,
      activeCustomers,
      verifiedCustomers,
      inactiveCustomers: totalCustomers - activeCustomers,
      unverifiedCustomers: totalCustomers - verifiedCustomers,
      localProviderCount,
      googleProviderCount,
    };

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Get customer stats error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch customer statistics",
      message: error.message,
    });
  }
};

/**
 * Get customer order history (POS orders only)
 * GET /api/customer/customers/:id/orders
 */
const getCustomerOrders = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const customer = await prisma.customer.findUnique({
      where: { id },
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: "Customer not found",
      });
    }

    // Query POSOrder model with customerId
    const [orders, total] = await Promise.all([
      prisma.pOSOrder.findMany({
        where: { customerId: id },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: "desc" },
        include: {
          items: true, // Include order items
        },
      }),
      prisma.pOSOrder.count({ where: { customerId: id } }),
    ]);

    // Transform orders to match frontend expectations
    const transformedOrders = orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      invoiceNumber: order.invoiceNumber,
      orderType: order.orderType,
      subtotal: order.subtotal,
      tax: order.tax,
      discount: order.discount,
      total: order.total,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      itemCount: order.items.length,
      totalQuantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
      orderDate: order.createdAt.toISOString(),
      completedAt: order.completedAt ? order.completedAt.toISOString() : null,
    }));

    res.json({
      success: true,
      data: {
        customer: transformCustomer(customer),
        orders: transformedOrders,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get customer orders error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch customer orders",
      message: error.message,
    });
  }
};

/**
 * Get customer analytics
 * GET /api/customer/customers/:id/analytics
 */
const getCustomerAnalytics = async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await prisma.customer.findUnique({
      where: { id },
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: "Customer not found",
      });
    }

    // Fetch recent POS orders
    const recentOrders = await prisma.pOSOrder.findMany({
      where: { customerId: id },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: {
        items: true,
      },
    });

    // Transform recent orders
    const transformedRecentOrders = recentOrders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      invoiceNumber: order.invoiceNumber,
      orderType: order.orderType,
      subtotal: order.subtotal,
      tax: order.tax,
      discount: order.discount,
      total: order.total,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      itemCount: order.items.length,
      totalQuantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
      orderDate: order.createdAt.toISOString(),
      completedAt: order.completedAt ? order.completedAt.toISOString() : null,
    }));

    const analytics = {
      totalOrders: customer.totalOrders,
      totalSpent: customer.totalSpent,
      lastOrderDate: customer.lastOrderDate,
      averageOrderValue:
        customer.totalOrders > 0
          ? customer.totalSpent / customer.totalOrders
          : 0,
      recentOrders: transformedRecentOrders,
    };

    res.json({
      success: true,
      data: {
        customer: transformCustomer(customer),
        analytics,
      },
    });
  } catch (error) {
    console.error("Get customer analytics error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch customer analytics",
      message: error.message,
    });
  }
};

/**
 * Get customer's online orders
 * GET /api/customer/online-orders/customer/:customerId
 */
const getCustomerOnlineOrders = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: "Customer not found",
      });
    }

    const [orders, total] = await Promise.all([
      prisma.onlineOrder.findMany({
        where: { customerId: customerId },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: "desc" },
      }),
      prisma.onlineOrder.count({ where: { customerId: customerId } }),
    ]);

    // Transform orders to match frontend expectations
    const transformedOrders = orders.map((order) => {
      const normalizedOrder = normalizeOrderDiscount(order);
      // Parse items from JSON if needed
      const items = Array.isArray(order.items) ? order.items : [];
      
      return {
        id: normalizedOrder.id,
        orderNumber: normalizedOrder.orderNumber,
        invoiceNumber: normalizedOrder.invoiceNumber,
        orderType: normalizedOrder.orderType,
        subtotal: normalizedOrder.subtotal,
        tax: normalizedOrder.tax,
        discount: normalizedOrder.discount,
        couponDiscount: normalizedOrder.couponDiscount || 0,
        total: normalizedOrder.total,
        paymentMethod: normalizedOrder.paymentMethod,
        paymentStatus: normalizedOrder.paymentStatus,
        itemCount: items.length,
        totalQuantity: items.reduce((sum, item) => sum + (item.quantity || 0), 0),
        orderDate: normalizedOrder.createdAt.toISOString(),
        completedAt: normalizedOrder.deliveredAt ? normalizedOrder.deliveredAt.toISOString() : null,
      };
    });

    res.json({
      success: true,
      data: {
        customerId: customer.id,
        customerName: customer.name,
        orders: transformedOrders,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get customer online orders error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch customer online orders",
      message: error.message,
    });
  }
};

/**
 * Create new customer (for POS)
 * POST /api/customer/customers
 */
const createCustomer = async (req, res) => {
  try {
    const { name, phoneNumber, email } = req.body;

    // Validation
    if (!name) {
      return res.status(400).json({
        success: false,
        error: "Name is required",
      });
    }

    if (!phoneNumber && !email) {
      return res.status(400).json({
        success: false,
        error: "Phone number or email is required",
      });
    }

    // Check for existing customer by phone or email
    let existingCustomer = null;

    if (phoneNumber) {
      existingCustomer = await prisma.customer.findFirst({
        where: { phoneNumber },
      });
    }

    if (!existingCustomer && email) {
      existingCustomer = await prisma.customer.findFirst({
        where: { email },
      });
    }

    if (existingCustomer) {
      console.log(`Customer already exists: ${existingCustomer.name} (${existingCustomer.phoneNumber || existingCustomer.email})`);
      return res.status(200).json({
        success: true,
        message: "Customer already exists",
        data: transformCustomer(existingCustomer),
        isExisting: true,
      });
    }

    // Create new customer
    const customer = await prisma.customer.create({
      data: {
        name,
        phoneNumber: phoneNumber || null,
        email: email || null,
        provider: "local",
        isVerified: false,
        totalOrders: 0,
        totalSpent: 0,
      },
    });

    console.log(`Customer created: ${customer.name} (${customer.phoneNumber || customer.email})`);

    res.status(201).json({
      success: true,
      message: "Customer created successfully",
      data: transformCustomer(customer),
      isExisting: false,
    });
  } catch (error) {
    console.error("Create customer error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create customer",
      message: error.message,
    });
  }
};

module.exports = {
  getAllCustomers,
  getCustomerById,
  searchCustomers,
  getCustomerStats,
  getCustomerOrders,
  getCustomerAnalytics,
  getCustomerOnlineOrders,
  createCustomer,
};
