const { prisma } = require("../../config/database");

// Get all GST rates
const getAllGSTRates = async (req, res) => {
  try {
    const gstRates = await prisma.gSTRate.findMany({
      orderBy: { gstPercentage: "asc" },
    });

    res.status(200).json({
      success: true,
      data: gstRates,
      count: gstRates.length,
    });
  } catch (error) {
    console.error("Error fetching GST rates:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch GST rates",
      message: error.message,
    });
  }
};

// Get GST rate by ID
const getGSTRateById = async (req, res) => {
  try {
    const { id } = req.params;

    const gstRate = await prisma.gSTRate.findUnique({
      where: { id },
    });

    if (!gstRate) {
      return res.status(404).json({
        success: false,
        error: "GST rate not found",
      });
    }

    res.status(200).json({
      success: true,
      data: gstRate,
    });
  } catch (error) {
    console.error("Error fetching GST rate:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch GST rate",
      message: error.message,
    });
  }
};

// Create GST rate
const createGSTRate = async (req, res) => {
  try {
    const { name, gstPercentage, isActive } = req.body;

    // Validation
    if (!name || gstPercentage === undefined) {
      return res.status(400).json({
        success: false,
        error: "Name and GST percentage are required",
      });
    }

    if (gstPercentage < 0 || gstPercentage > 100) {
      return res.status(400).json({
        success: false,
        error: "GST percentage must be between 0 and 100",
      });
    }

    const gstRate = await prisma.gSTRate.create({
      data: {
        name: name.trim(),
        gstPercentage: parseFloat(gstPercentage),
        isActive: isActive !== undefined ? isActive : true,
      },
    });


    res.status(201).json({
      success: true,
      message: "GST rate created successfully",
      data: gstRate,
    });
  } catch (error) {
    console.error("Error creating GST rate:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create GST rate",
      message: error.message,
    });
  }
};

// Update GST rate
const updateGSTRate = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, gstPercentage, isActive } = req.body;

    // Check if GST rate exists
    const existingRate = await prisma.gSTRate.findUnique({
      where: { id },
    });

    if (!existingRate) {
      return res.status(404).json({
        success: false,
        error: "GST rate not found",
      });
    }

    // Validation
    if (gstPercentage !== undefined && (gstPercentage < 0 || gstPercentage > 100)) {
      return res.status(400).json({
        success: false,
        error: "GST percentage must be between 0 and 100",
      });
    }

    const updateData = {
      name: name !== undefined ? name.trim() : existingRate.name,
      gstPercentage: gstPercentage !== undefined ? parseFloat(gstPercentage) : existingRate.gstPercentage,
      isActive: isActive !== undefined ? isActive : existingRate.isActive,
    };

    const gstRate = await prisma.gSTRate.update({
      where: { id },
      data: updateData,
    });


    res.status(200).json({
      success: true,
      message: "GST rate updated successfully",
      data: gstRate,
    });
  } catch (error) {
    console.error("Error updating GST rate:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update GST rate",
      message: error.message,
    });
  }
};

// Delete GST rate
const deleteGSTRate = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if GST rate exists
    const existingRate = await prisma.gSTRate.findUnique({
      where: { id },
    });

    if (!existingRate) {
      return res.status(404).json({
        success: false,
        error: "GST rate not found",
      });
    }

    await prisma.gSTRate.delete({
      where: { id },
    });


    res.status(200).json({
      success: true,
      message: "GST rate deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting GST rate:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete GST rate",
      message: error.message,
    });
  }
};

// Toggle GST rate status
const toggleGSTRateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    const gstRate = await prisma.gSTRate.update({
      where: { id },
      data: { isActive },
    });


    res.status(200).json({
      success: true,
      message: "GST rate status updated successfully",
      data: gstRate,
    });
  } catch (error) {
    console.error("Error updating GST rate status:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update GST rate status",
      message: error.message,
    });
  }
};

module.exports = {
  getAllGSTRates,
  getGSTRateById,
  createGSTRate,
  updateGSTRate,
  deleteGSTRate,
  toggleGSTRateStatus,
};
