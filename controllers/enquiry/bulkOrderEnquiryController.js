const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { sendToAllAdmins } = require("../../utils/notification/sendNotification");

// Create bulk order enquiry (Public - no auth required)
const createBulkOrderEnquiry = async (req, res) => {
  try {
    const {
      name,
      phone,
      companyName,
      productDetails,
      quantity,
      deliveryDate,
      message,
    } = req.body;

    // Validation
    if (!name || !phone || !productDetails || !quantity) {
      return res.status(400).json({
        success: false,
        error: "Name, phone, product details, and quantity are required",
      });
    }

    // Phone validation (10 digits)
    const phoneRegex = /^[0-9]{10}$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({
        success: false,
        error: "Please provide a valid 10-digit phone number",
      });
    }

    const enquiry = await prisma.bulkOrderEnquiry.create({
      data: {
        name,
        phone,
        companyName: companyName || null,
        productDetails,
        quantity,
        deliveryDate: deliveryDate || null,
        message: message || null,
        status: "pending",
      },
    });

    // Send notification to all admins
    try {
      const notification = {
        title: '📦 New Bulk Order Enquiry',
        body: `${name}${companyName ? ` from ${companyName}` : ''} submitted a bulk order enquiry!\n\n📦 Product: ${productDetails.substring(0, 50)}${productDetails.length > 50 ? '...' : ''}\n📊 Quantity: ${quantity}\n📞 Phone: ${phone}`,
      };

      const data = {
        type: 'NEW_BULK_ORDER_ENQUIRY',
        enquiryId: enquiry.id,
        customerName: name,
        companyName: companyName || '',
        phone,
        quantity,
        link: '/dashboard/enquiries?tab=bulk-orders',
        urgency: 'high',
        vibrate: [200, 100, 200, 100, 200],
        requireInteraction: true,
        color: '#2196F3',
        backgroundColor: '#E3F2FD',
        actions: [
          {
            action: 'view',
            title: '👁️ View Enquiry',
          },
          {
            action: 'dismiss',
            title: '✖️ Dismiss',
          },
        ],
      };

      await sendToAllAdmins(notification, data);
      console.log('✅ Bulk order enquiry notification sent to admins');
    } catch (notificationError) {
      console.error('⚠️ Failed to send notification:', notificationError);
      // Don't fail the request if notification fails
    }

    res.status(201).json({
      success: true,
      message: "Bulk order enquiry submitted successfully",
      data: enquiry,
    });
  } catch (error) {
    console.error("Error creating bulk order enquiry:", error);
    res.status(500).json({
      success: false,
      error: "Failed to submit bulk order enquiry",
    });
  }
};

// Get all bulk order enquiries (Admin only)
const getAllBulkOrderEnquiries = async (req, res) => {
  try {
    const enquiries = await prisma.bulkOrderEnquiry.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

    res.status(200).json({
      success: true,
      data: enquiries,
    });
  } catch (error) {
    console.error("Error fetching bulk order enquiries:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch bulk order enquiries",
    });
  }
};

// Get single bulk order enquiry by ID (Admin only)
const getBulkOrderEnquiryById = async (req, res) => {
  try {
    const { id } = req.params;

    const enquiry = await prisma.bulkOrderEnquiry.findUnique({
      where: { id },
    });

    if (!enquiry) {
      return res.status(404).json({
        success: false,
        error: "Bulk order enquiry not found",
      });
    }

    res.status(200).json({
      success: true,
      data: enquiry,
    });
  } catch (error) {
    console.error("Error fetching bulk order enquiry:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch bulk order enquiry",
    });
  }
};

// Update bulk order enquiry status (Admin only)
const updateBulkOrderEnquiryStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Validate status
    const validStatuses = ["pending", "contacted", "completed", "cancelled"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status. Must be one of: pending, contacted, completed, cancelled",
      });
    }

    const enquiry = await prisma.bulkOrderEnquiry.update({
      where: { id },
      data: { status },
    });

    res.status(200).json({
      success: true,
      message: "Status updated successfully",
      data: enquiry,
    });
  } catch (error) {
    console.error("Error updating bulk order enquiry status:", error);
    
    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        error: "Bulk order enquiry not found",
      });
    }

    res.status(500).json({
      success: false,
      error: "Failed to update status",
    });
  }
};

// Delete bulk order enquiry (Admin only)
const deleteBulkOrderEnquiry = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.bulkOrderEnquiry.delete({
      where: { id },
    });

    res.status(200).json({
      success: true,
      message: "Bulk order enquiry deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting bulk order enquiry:", error);
    
    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        error: "Bulk order enquiry not found",
      });
    }

    res.status(500).json({
      success: false,
      error: "Failed to delete bulk order enquiry",
    });
  }
};

module.exports = {
  createBulkOrderEnquiry,
  getAllBulkOrderEnquiries,
  getBulkOrderEnquiryById,
  updateBulkOrderEnquiryStatus,
  deleteBulkOrderEnquiry,
};
