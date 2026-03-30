const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { sendToAllAdmins } = require("../../utils/notification/sendNotification");

// Create catering service enquiry (Public - no auth required)
const createCateringServiceEnquiry = async (req, res) => {
  try {
    const {
      name,
      phone,
      eventType,
      eventDate,
      eventTime,
      guestCount,
      venue,
      menuPreferences,
      budget,
      message,
    } = req.body;

    // Validation
    if (!name || !phone || !eventType || !eventDate || !guestCount) {
      return res.status(400).json({
        success: false,
        error: "Name, phone, event type, event date, and guest count are required",
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

    const enquiry = await prisma.cateringServiceEnquiry.create({
      data: {
        name,
        phone,
        eventType,
        eventDate,
        eventTime: eventTime || null,
        guestCount,
        venue: venue || null,
        menuPreferences: menuPreferences || null,
        budget: budget || null,
        message: message || null,
        status: "pending",
      },
    });

    // Send notification to all admins
    try {
      const formattedDate = new Date(eventDate).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });

      const notification = {
        title: '🍽️ New Catering Service Enquiry',
        body: `${name} requested catering for ${eventType}!\n\n📅 Event Date: ${formattedDate}${eventTime ? ` at ${eventTime}` : ''}\n👥 Guests: ${guestCount}\n📞 Phone: ${phone}${venue ? `\n📍 Venue: ${venue}` : ''}`,
      };

      const data = {
        type: 'NEW_CATERING_ENQUIRY',
        enquiryId: enquiry.id,
        customerName: name,
        eventType,
        eventDate: formattedDate,
        guestCount,
        phone,
        link: '/dashboard/enquiries?tab=catering-services',
        urgency: 'high',
        vibrate: [200, 100, 200, 100, 200],
        requireInteraction: true,
        color: '#FF9800',
        backgroundColor: '#FFF3E0',
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
      console.log('✅ Catering service enquiry notification sent to admins');
    } catch (notificationError) {
      console.error('⚠️ Failed to send notification:', notificationError);
      // Don't fail the request if notification fails
    }

    res.status(201).json({
      success: true,
      message: "Catering service enquiry submitted successfully",
      data: enquiry,
    });
  } catch (error) {
    console.error("Error creating catering service enquiry:", error);
    res.status(500).json({
      success: false,
      error: "Failed to submit catering service enquiry",
    });
  }
};

// Get all catering service enquiries (Admin only)
const getAllCateringServiceEnquiries = async (req, res) => {
  try {
    const enquiries = await prisma.cateringServiceEnquiry.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

    res.status(200).json({
      success: true,
      data: enquiries,
    });
  } catch (error) {
    console.error("Error fetching catering service enquiries:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch catering service enquiries",
    });
  }
};

// Get single catering service enquiry by ID (Admin only)
const getCateringServiceEnquiryById = async (req, res) => {
  try {
    const { id } = req.params;

    const enquiry = await prisma.cateringServiceEnquiry.findUnique({
      where: { id },
    });

    if (!enquiry) {
      return res.status(404).json({
        success: false,
        error: "Catering service enquiry not found",
      });
    }

    res.status(200).json({
      success: true,
      data: enquiry,
    });
  } catch (error) {
    console.error("Error fetching catering service enquiry:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch catering service enquiry",
    });
  }
};

// Update catering service enquiry status (Admin only)
const updateCateringServiceEnquiryStatus = async (req, res) => {
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

    const enquiry = await prisma.cateringServiceEnquiry.update({
      where: { id },
      data: { status },
    });

    res.status(200).json({
      success: true,
      message: "Status updated successfully",
      data: enquiry,
    });
  } catch (error) {
    console.error("Error updating catering service enquiry status:", error);
    
    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        error: "Catering service enquiry not found",
      });
    }

    res.status(500).json({
      success: false,
      error: "Failed to update status",
    });
  }
};

// Delete catering service enquiry (Admin only)
const deleteCateringServiceEnquiry = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.cateringServiceEnquiry.delete({
      where: { id },
    });

    res.status(200).json({
      success: true,
      message: "Catering service enquiry deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting catering service enquiry:", error);
    
    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        error: "Catering service enquiry not found",
      });
    }

    res.status(500).json({
      success: false,
      error: "Failed to delete catering service enquiry",
    });
  }
};

module.exports = {
  createCateringServiceEnquiry,
  getAllCateringServiceEnquiries,
  getCateringServiceEnquiryById,
  updateCateringServiceEnquiryStatus,
  deleteCateringServiceEnquiry,
};
