const { prisma } = require('../../config/database');

/**
 * Get courier settings
 */
const getCourierSettings = async (req, res) => {
  try {
    let settings = await prisma.courierSettings.findFirst();
    
    // Create default settings if none exist
    if (!settings) {
      settings = await prisma.courierSettings.create({
        data: {
          isEnabled: false,
          courierLinks: []
        }
      });
    }

    return res.status(200).json({
      success: true,
      data: settings
    });

  } catch (error) {
    console.error("❌ Error getting courier settings:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to get courier settings"
    });
  }
};

/**
 * Update courier settings
 */
const updateCourierSettings = async (req, res) => {
  try {
    const { isEnabled, courierLinks } = req.body;

    // Find existing settings or create new
    let settings = await prisma.courierSettings.findFirst();
    
    if (settings) {
      // Update existing
      settings = await prisma.courierSettings.update({
        where: { id: settings.id },
        data: {
          isEnabled: isEnabled !== undefined ? isEnabled : settings.isEnabled,
          courierLinks: courierLinks !== undefined ? courierLinks : settings.courierLinks,
          updatedAt: new Date()
        }
      });
    } else {
      // Create new
      settings = await prisma.courierSettings.create({
        data: {
          isEnabled: isEnabled || false,
          courierLinks: courierLinks || []
        }
      });
    }

    console.log(`✅ Courier settings updated: enabled=${settings.isEnabled}`);

    return res.status(200).json({
      success: true,
      data: settings,
      message: "Courier settings updated successfully"
    });

  } catch (error) {
    console.error("❌ Error updating courier settings:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to update courier settings"
    });
  }
};

module.exports = {
  getCourierSettings,
  updateCourierSettings,
};