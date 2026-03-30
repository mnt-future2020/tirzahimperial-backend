const { prisma } = require('../../config/database');

// Get all cutting styles
const getAllCuttingStyles = async (req, res) => {
  try {
    const cuttingStyles = await prisma.cuttingStyle.findMany({
      orderBy: [
        { sortOrder: 'asc' },
        { name: 'asc' }
      ]
    });

    res.json({
      success: true,
      data: cuttingStyles
    });
  } catch (error) {
    console.error('Error fetching cutting styles:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch cutting styles'
    });
  }
};

// Get active cutting styles only (for dropdowns)
const getActiveCuttingStyles = async (req, res) => {
  try {
    const cuttingStyles = await prisma.cuttingStyle.findMany({
      where: { isActive: true },
      orderBy: [
        { sortOrder: 'asc' },
        { name: 'asc' }
      ],
      select: {
        id: true,
        name: true
      }
    });

    res.json({
      success: true,
      data: cuttingStyles
    });
  } catch (error) {
    console.error('Error fetching active cutting styles:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch cutting styles'
    });
  }
};

// Get cutting style by ID
const getCuttingStyleById = async (req, res) => {
  try {
    const { id } = req.params;

    const cuttingStyle = await prisma.cuttingStyle.findUnique({
      where: { id }
    });

    if (!cuttingStyle) {
      return res.status(404).json({
        success: false,
        error: 'Cutting style not found'
      });
    }

    res.json({
      success: true,
      data: cuttingStyle
    });
  } catch (error) {
    console.error('Error fetching cutting style:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch cutting style'
    });
  }
};

// Create cutting style
const createCuttingStyle = async (req, res) => {
  try {
    const { name, description, isActive = true, sortOrder = 0 } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Cutting style name is required'
      });
    }

    // Check for duplicate name
    const existing = await prisma.cuttingStyle.findUnique({
      where: { name: name.trim() }
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Cutting style with this name already exists'
      });
    }

    const cuttingStyle = await prisma.cuttingStyle.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        isActive,
        sortOrder: parseInt(sortOrder) || 0
      }
    });

    console.log(`✅ Created cutting style: ${cuttingStyle.name}`);

    res.status(201).json({
      success: true,
      data: cuttingStyle,
      message: 'Cutting style created successfully'
    });
  } catch (error) {
    console.error('Error creating cutting style:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create cutting style'
    });
  }
};

// Update cutting style
const updateCuttingStyle = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, isActive, sortOrder } = req.body;

    // Check if cutting style exists
    const existing = await prisma.cuttingStyle.findUnique({
      where: { id }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Cutting style not found'
      });
    }

    // Check for duplicate name (if name is being changed)
    if (name && name.trim() !== existing.name) {
      const duplicate = await prisma.cuttingStyle.findUnique({
        where: { name: name.trim() }
      });

      if (duplicate) {
        return res.status(400).json({
          success: false,
          error: 'Cutting style with this name already exists'
        });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description?.trim() || null;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (sortOrder !== undefined) updateData.sortOrder = parseInt(sortOrder) || 0;

    const cuttingStyle = await prisma.cuttingStyle.update({
      where: { id },
      data: updateData
    });

    console.log(`✅ Updated cutting style: ${cuttingStyle.name}`);

    res.json({
      success: true,
      data: cuttingStyle,
      message: 'Cutting style updated successfully'
    });
  } catch (error) {
    console.error('Error updating cutting style:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update cutting style'
    });
  }
};

// Delete cutting style
const deleteCuttingStyle = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if cutting style exists
    const existing = await prisma.cuttingStyle.findUnique({
      where: { id }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Cutting style not found'
      });
    }

    // Check if any products are using this cutting style
    const productsUsingStyle = await prisma.onlineProduct.count({
      where: {
        cuttingStyles: {
          has: id
        }
      }
    });

    if (productsUsingStyle > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete: ${productsUsingStyle} product(s) are using this cutting style. Remove it from products first or deactivate instead.`
      });
    }

    await prisma.cuttingStyle.delete({
      where: { id }
    });

    console.log(`✅ Deleted cutting style: ${existing.name}`);

    res.json({
      success: true,
      message: 'Cutting style deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting cutting style:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete cutting style'
    });
  }
};

// Toggle cutting style active status
const toggleCuttingStyleStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await prisma.cuttingStyle.findUnique({
      where: { id }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Cutting style not found'
      });
    }

    const cuttingStyle = await prisma.cuttingStyle.update({
      where: { id },
      data: { isActive: !existing.isActive }
    });

    console.log(`✅ Toggled cutting style status: ${cuttingStyle.name} -> ${cuttingStyle.isActive ? 'Active' : 'Inactive'}`);

    res.json({
      success: true,
      data: cuttingStyle,
      message: `Cutting style ${cuttingStyle.isActive ? 'activated' : 'deactivated'} successfully`
    });
  } catch (error) {
    console.error('Error toggling cutting style status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to toggle cutting style status'
    });
  }
};

module.exports = {
  getAllCuttingStyles,
  getActiveCuttingStyles,
  getCuttingStyleById,
  createCuttingStyle,
  updateCuttingStyle,
  deleteCuttingStyle,
  toggleCuttingStyleStatus
};
