const { prisma } = require("../../config/database");

// Get all warehouses
const getAllWarehouses = async (req, res) => {
  try {
    const { status } = req.query;

    const filter = {};
    if (status) {
      filter.status = status;
    }

    const warehouses = await prisma.warehouse.findMany({
      where: filter,
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      success: true,
      data: warehouses,
      count: warehouses.length,
    });
  } catch (error) {
    console.error("Error fetching warehouses:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch warehouses",
      message: error.message,
    });
  }
};

// Get warehouse by ID
const getWarehouseById = async (req, res) => {
  try {
    const { id } = req.params;

    const warehouse = await prisma.warehouse.findUnique({
      where: { id },
    });

    if (!warehouse) {
      return res.status(404).json({
        success: false,
        error: "Warehouse not found",
      });
    }

    res.status(200).json({
      success: true,
      data: warehouse,
    });
  } catch (error) {
    console.error("Error fetching warehouse:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch warehouse",
      message: error.message,
    });
  }
};

// Create new warehouse
const createWarehouse = async (req, res) => {
  try {
    const { name, address, city, state, postalCode, country, manager, phone, status } = req.body;

    if (!name || !address || !city || !state || !postalCode || !country || !manager || !phone) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
        required: ["name", "address", "city", "state", "postalCode", "country", "manager", "phone"],
      });
    }

    const warehouse = await prisma.warehouse.create({
      data: {
        name,
        address,
        city,
        state,
        postalCode,
        country,
        manager,
        phone,
        status: status || "active",
      },
    });

    res.status(201).json({
      success: true,
      message: "Warehouse created successfully",
      data: warehouse,
    });
  } catch (error) {
    console.error("Error creating warehouse:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create warehouse",
      message: error.message,
    });
  }
};

// Update warehouse
const updateWarehouse = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, city, state, postalCode, country, manager, phone, status } = req.body;

    const existingWarehouse = await prisma.warehouse.findUnique({
      where: { id },
    });

    if (!existingWarehouse) {
      return res.status(404).json({
        success: false,
        error: "Warehouse not found",
      });
    }

    const warehouse = await prisma.warehouse.update({
      where: { id },
      data: {
        name,
        address,
        city,
        state,
        postalCode,
        country,
        manager,
        phone,
        status,
      },
    });

    res.status(200).json({
      success: true,
      message: "Warehouse updated successfully",
      data: warehouse,
    });
  } catch (error) {
    console.error("Error updating warehouse:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update warehouse",
      message: error.message,
    });
  }
};

module.exports = {
  getAllWarehouses,
  getWarehouseById,
  createWarehouse,
  updateWarehouse,
};
