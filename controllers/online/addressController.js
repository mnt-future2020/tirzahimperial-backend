const { prisma } = require('../../config/database');

/**
 * Get all addresses for the authenticated user
 * GET /api/online/addresses
 */
const getAddresses = async (req, res) => {
  try {
    const userId = req.query.userId || req.body.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    // Find customer by userId
    const customer = await prisma.customer.findUnique({
      where: { userId },
      include: {
        customerAddresses: {
          orderBy: [
            { isDefault: 'desc' },
            { createdAt: 'desc' }
          ]
        }
      }
    });

    if (!customer) {
      return res.json({
        success: true,
        data: []
      });
    }

    res.json({
      success: true,
      data: customer.customerAddresses
    });
  } catch (error) {
    console.error('Error fetching addresses:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch addresses'
    });
  }
};

/**
 * Get a single address by ID
 * GET /api/online/addresses/:id
 */
const getAddressById = async (req, res) => {
  try {
    const userId = req.query.userId || req.body.userId;
    const { id } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    // Find customer by userId
    const customer = await prisma.customer.findUnique({
      where: { userId }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    const address = await prisma.customerAddress.findFirst({
      where: {
        id,
        customerId: customer.id
      }
    });

    if (!address) {
      return res.status(404).json({
        success: false,
        error: 'Address not found'
      });
    }

    res.json({
      success: true,
      data: address
    });
  } catch (error) {
    console.error('Error fetching address:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch address'
    });
  }
};

/**
 * Create a new address
 * POST /api/online/addresses
 */
const createAddress = async (req, res) => {
  try {
    const userId = req.query.userId || req.body.userId;
    const {
      name,
      phone,
      alternatePhone,
      addressLine1,
      addressLine2,
      landmark,
      city,
      state,
      pincode,
      country = 'India',
      addressType = 'home',
      isDefault = false
    } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    // Validate required fields
    if (!name || !phone || !addressLine1 || !city || !state || !pincode) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, phone, addressLine1, city, state, pincode'
      });
    }

    // Find customer
    const customer = await prisma.customer.findUnique({
      where: { userId }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found. Please ensure user is registered.'
      });
    }

    // Check address limit (5 addresses max)
    const existingAddressCount = await prisma.customerAddress.count({
      where: { customerId: customer.id }
    });

    const MAX_ADDRESSES = 5;
    if (existingAddressCount >= MAX_ADDRESSES) {
      return res.status(400).json({
        success: false,
        error: `Maximum ${MAX_ADDRESSES} addresses allowed. Please edit an existing address instead.`,
        code: 'ADDRESS_LIMIT_REACHED'
      });
    }

    // If this is the first address or isDefault is true, handle default logic
    const shouldBeDefault = existingAddressCount === 0 || isDefault;

    // If setting as default, unset other defaults
    if (shouldBeDefault) {
      await prisma.customerAddress.updateMany({
        where: { customerId: customer.id },
        data: { isDefault: false }
      });
    }

    // Create the address
    const address = await prisma.customerAddress.create({
      data: {
        customerId: customer.id,
        name,
        phone,
        alternatePhone: alternatePhone || null,
        addressLine1,
        addressLine2: addressLine2 || null,
        landmark: landmark || null,
        city,
        state,
        pincode,
        country,
        addressType,
        isDefault: shouldBeDefault
      }
    });

    res.status(201).json({
      success: true,
      data: address,
      message: 'Address created successfully'
    });
  } catch (error) {
    console.error('Error creating address:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create address'
    });
  }
};

/**
 * Update an existing address
 * PUT /api/online/addresses/:id
 */
const updateAddress = async (req, res) => {
  try {
    const userId = req.query.userId || req.body.userId;
    const { id } = req.params;
    const {
      name,
      phone,
      alternatePhone,
      addressLine1,
      addressLine2,
      landmark,
      city,
      state,
      pincode,
      country,
      addressType,
      isDefault
    } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    // Find customer by userId
    const customer = await prisma.customer.findUnique({
      where: { userId }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    // Check if address exists and belongs to customer
    const existingAddress = await prisma.customerAddress.findFirst({
      where: {
        id,
        customerId: customer.id
      }
    });

    if (!existingAddress) {
      return res.status(404).json({
        success: false,
        error: 'Address not found'
      });
    }

    // If setting as default, unset other defaults
    if (isDefault === true) {
      await prisma.customerAddress.updateMany({
        where: {
          customerId: customer.id,
          id: { not: id }
        },
        data: { isDefault: false }
      });
    }

    // Build update data
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (alternatePhone !== undefined) updateData.alternatePhone = alternatePhone || null;
    if (addressLine1 !== undefined) updateData.addressLine1 = addressLine1;
    if (addressLine2 !== undefined) updateData.addressLine2 = addressLine2 || null;
    if (landmark !== undefined) updateData.landmark = landmark || null;
    if (city !== undefined) updateData.city = city;
    if (state !== undefined) updateData.state = state;
    if (pincode !== undefined) updateData.pincode = pincode;
    if (country !== undefined) updateData.country = country;
    if (addressType !== undefined) updateData.addressType = addressType;
    if (isDefault !== undefined) updateData.isDefault = isDefault;

    const address = await prisma.customerAddress.update({
      where: { id },
      data: updateData
    });

    res.json({
      success: true,
      data: address,
      message: 'Address updated successfully'
    });
  } catch (error) {
    console.error('Error updating address:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update address'
    });
  }
};

/**
 * Delete an address
 * DELETE /api/online/addresses/:id
 */
const deleteAddress = async (req, res) => {
  try {
    const userId = req.query.userId || req.body.userId;
    const { id } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    // Find customer by userId
    const customer = await prisma.customer.findUnique({
      where: { userId }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    // Check if address exists and belongs to customer
    const existingAddress = await prisma.customerAddress.findFirst({
      where: {
        id,
        customerId: customer.id
      }
    });

    if (!existingAddress) {
      return res.status(404).json({
        success: false,
        error: 'Address not found'
      });
    }

    // Delete the address
    await prisma.customerAddress.delete({
      where: { id }
    });

    // If deleted address was default, set another address as default
    if (existingAddress.isDefault) {
      const firstAddress = await prisma.customerAddress.findFirst({
        where: { customerId: customer.id },
        orderBy: { createdAt: 'asc' }
      });

      if (firstAddress) {
        await prisma.customerAddress.update({
          where: { id: firstAddress.id },
          data: { isDefault: true }
        });
      }
    }

    res.json({
      success: true,
      message: 'Address deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting address:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete address'
    });
  }
};

/**
 * Set an address as default
 * PATCH /api/online/addresses/:id/default
 */
const setDefaultAddress = async (req, res) => {
  try {
    const userId = req.query.userId || req.body.userId;
    const { id } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    // Find customer by userId
    const customer = await prisma.customer.findUnique({
      where: { userId }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    // Check if address exists and belongs to customer
    const existingAddress = await prisma.customerAddress.findFirst({
      where: {
        id,
        customerId: customer.id
      }
    });

    if (!existingAddress) {
      return res.status(404).json({
        success: false,
        error: 'Address not found'
      });
    }

    // Unset all other defaults
    await prisma.customerAddress.updateMany({
      where: { customerId: customer.id },
      data: { isDefault: false }
    });

    // Set this address as default
    const address = await prisma.customerAddress.update({
      where: { id },
      data: { isDefault: true }
    });

    res.json({
      success: true,
      data: address,
      message: 'Default address updated successfully'
    });
  } catch (error) {
    console.error('Error setting default address:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to set default address'
    });
  }
};

module.exports = {
  getAddresses,
  getAddressById,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress
};
