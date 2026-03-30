const { prisma } = require("../../config/database");

// Default static badges configuration
const DEFAULT_STATIC_BADGES = [
  { name: "New Arrival", sortOrder: 0, enabledForHomepage: true },
  { name: "Bestseller", sortOrder: 1, enabledForHomepage: true },
  { name: "Trending", sortOrder: 2, enabledForHomepage: true },
  { name: "Hot Deal", sortOrder: 3, enabledForHomepage: true },
  { name: "Limited Stock", sortOrder: 4, enabledForHomepage: true },
  { name: "Sale", sortOrder: 5, enabledForHomepage: true },
];

/**
 * Initialize static badges in database if they don't exist
 * Only creates missing badges, does NOT update existing ones
 */
const initializeStaticBadges = async () => {
  try {
    for (const badge of DEFAULT_STATIC_BADGES) {
      const existing = await prisma.badge.findFirst({
        where: { name: badge.name },
      });

      // Only create if badge doesn't exist
      // Do NOT update existing badges to preserve user customizations
      if (!existing) {
        await prisma.badge.create({
          data: {
            name: badge.name,
            isStatic: true,
            sortOrder: badge.sortOrder,
            enabledForHomepage: badge.enabledForHomepage,
          },
        });
        console.log(`✅ Created static badge: ${badge.name} (sortOrder: ${badge.sortOrder})`);
      }
    }
  } catch (error) {
    console.error("Error initializing static badges:", error);
  }
};

// Initialize on module load
initializeStaticBadges();

/**
 * Get all badges (static + custom) sorted by sortOrder
 * GET /api/online/badges
 */
const getAllBadges = async (req, res) => {
  try {
    // Get all badges from database
    const allBadges = await prisma.badge.findMany({
      orderBy: [
        { sortOrder: "asc" },
        { name: "asc" },
      ],
      select: {
        id: true,
        name: true,
        isStatic: true,
        sortOrder: true,
        enabledForHomepage: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Separate static and custom badges
    const staticBadges = allBadges.filter(badge => badge.isStatic);
    const customBadges = allBadges.filter(badge => !badge.isStatic);

    res.json({
      success: true,
      data: {
        static: staticBadges,
        custom: customBadges,
        all: allBadges,
      },
    });
  } catch (error) {
    console.error("Error fetching badges:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch badges",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

/**
 * Create custom badge
 * POST /api/online/badges
 */
const createBadge = async (req, res) => {
  try {
    const { name, sortOrder, enabledForHomepage } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Badge name is required",
      });
    }

    // Check if badge already exists
    const existingBadge = await prisma.badge.findFirst({
      where: { 
        name: { 
          equals: name.trim(), 
          mode: "insensitive" 
        } 
      },
    });

    if (existingBadge) {
      return res.status(400).json({
        success: false,
        message: "Badge already exists",
      });
    }

    // Get max sortOrder if not provided
    let badgeSortOrder = sortOrder !== undefined ? parseInt(sortOrder) : 0;
    if (sortOrder === undefined) {
      const maxBadge = await prisma.badge.findFirst({
        orderBy: { sortOrder: "desc" },
      });
      badgeSortOrder = maxBadge ? maxBadge.sortOrder + 1 : 0;
    }

    const badge = await prisma.badge.create({
      data: {
        name: name.trim(),
        isStatic: false,
        sortOrder: badgeSortOrder,
        enabledForHomepage: enabledForHomepage !== undefined ? enabledForHomepage : true,
      },
    });

    res.status(201).json({
      success: true,
      message: "Badge created successfully",
      data: badge,
    });
  } catch (error) {
    console.error("Error creating badge:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create badge",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

/**
 * Update badge (both static and custom)
 * PUT /api/online/badges/:id
 */
const updateBadge = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, sortOrder, enabledForHomepage, confirmSwap } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Badge name is required",
      });
    }

    // Check if badge exists
    const existingBadge = await prisma.badge.findUnique({
      where: { id },
    });

    if (!existingBadge) {
      return res.status(404).json({
        success: false,
        message: "Badge not found",
      });
    }

    // Check if another badge with same name exists
    const duplicateBadge = await prisma.badge.findFirst({
      where: {
        name: { 
          equals: name.trim(), 
          mode: "insensitive" 
        },
        id: { not: id },
      },
    });

    if (duplicateBadge) {
      return res.status(400).json({
        success: false,
        message: "Badge name already exists",
      });
    }

    // Check if sortOrder is being changed and if it conflicts with another badge
    if (sortOrder !== undefined && sortOrder !== existingBadge.sortOrder) {
      const badgeWithSameSortOrder = await prisma.badge.findFirst({
        where: {
          sortOrder: parseInt(sortOrder),
          id: { not: id }
        },
        select: {
          id: true,
          name: true,
          sortOrder: true
        }
      });

      if (badgeWithSameSortOrder) {
        // If confirmSwap is not true, return conflict info
        if (!confirmSwap) {
          return res.status(409).json({
            success: false,
            message: "Sort order already exists",
            conflict: true,
            conflictBadge: badgeWithSameSortOrder,
            requiresConfirmation: true
          });
        }

        // Swap sortOrder values
        // First, set the conflicting badge to a temporary sortOrder
        const tempSortOrder = 9999;
        await prisma.badge.update({
          where: { id: badgeWithSameSortOrder.id },
          data: { sortOrder: tempSortOrder }
        });

        // Update current badge to new sortOrder
        await prisma.badge.update({
          where: { id },
          data: { sortOrder: parseInt(sortOrder) }
        });

        // Update conflicting badge to old sortOrder
        await prisma.badge.update({
          where: { id: badgeWithSameSortOrder.id },
          data: { sortOrder: existingBadge.sortOrder }
        });

        // Fetch updated badge
        const updatedBadge = await prisma.badge.findUnique({
          where: { id }
        });

        return res.json({
          success: true,
          message: `Badge updated successfully. Sort order swapped with "${badgeWithSameSortOrder.name}"`,
          data: updatedBadge,
          swapped: true
        });
      }
    }

    // Prepare update data
    const updateData = {
      name: name.trim(),
    };

    if (sortOrder !== undefined) {
      updateData.sortOrder = parseInt(sortOrder);
    }

    if (enabledForHomepage !== undefined) {
      updateData.enabledForHomepage = enabledForHomepage;
    }

    const badge = await prisma.badge.update({
      where: { id },
      data: updateData,
    });

    res.json({
      success: true,
      message: "Badge updated successfully",
      data: badge,
    });
  } catch (error) {
    console.error("Error updating badge:", error);
    
    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: "Badge not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to update badge",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

/**
 * Reset static badge to default name
 * POST /api/online/badges/:id/reset
 */
const resetStaticBadge = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if badge exists and is static
    const badge = await prisma.badge.findUnique({
      where: { id },
    });

    if (!badge) {
      return res.status(404).json({
        success: false,
        message: "Badge not found",
      });
    }

    if (!badge.isStatic) {
      return res.status(400).json({
        success: false,
        message: "Only static badges can be reset",
      });
    }

    // Find default configuration for this badge by sortOrder
    const defaultBadge = DEFAULT_STATIC_BADGES.find(
      db => db.sortOrder === badge.sortOrder
    );

    if (!defaultBadge) {
      return res.status(400).json({
        success: false,
        message: "Default configuration not found for this badge",
      });
    }

    // If badge already has the default name, just update other fields
    if (badge.name.toLowerCase() === defaultBadge.name.toLowerCase()) {
      const updatedBadge = await prisma.badge.update({
        where: { id },
        data: {
          sortOrder: defaultBadge.sortOrder,
          enabledForHomepage: defaultBadge.enabledForHomepage,
        },
      });

      return res.json({
        success: true,
        message: "Badge reset to default successfully",
        data: updatedBadge,
      });
    }

    // Check if another badge already has the default name
    const existingBadgeWithDefaultName = await prisma.badge.findFirst({
      where: {
        name: {
          equals: defaultBadge.name,
          mode: "insensitive"
        },
        id: { not: id }
      }
    });

    // If another badge has the default name, swap names using transaction
    if (existingBadgeWithDefaultName) {
      // Use transaction to ensure atomic swap
      const [updatedBadge] = await prisma.$transaction([
        // Step 1: Update the other badge to current badge's old name
        prisma.badge.update({
          where: { id: existingBadgeWithDefaultName.id },
          data: { name: badge.name }
        }),
        // Step 2: Update current badge to default name
        prisma.badge.update({
          where: { id },
          data: {
            name: defaultBadge.name,
            sortOrder: defaultBadge.sortOrder,
            enabledForHomepage: defaultBadge.enabledForHomepage,
          },
        }),
      ]);
      
      return res.json({
        success: true,
        message: `Badge reset to default successfully. "${badge.name}" and "${defaultBadge.name}" names swapped.`,
        data: updatedBadge,
      });
    }

    // No conflict, just reset to default
    const updatedBadge = await prisma.badge.update({
      where: { id },
      data: {
        name: defaultBadge.name,
        sortOrder: defaultBadge.sortOrder,
        enabledForHomepage: defaultBadge.enabledForHomepage,
      },
    });

    res.json({
      success: true,
      message: "Badge reset to default successfully",
      data: updatedBadge,
    });
  } catch (error) {
    console.error("Error resetting badge:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reset badge",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

/**
 * Delete custom badge
 * DELETE /api/online/badges/:id
 */
const deleteBadge = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if badge is static
    const badge = await prisma.badge.findUnique({
      where: { id },
    });

    if (!badge) {
      return res.status(404).json({
        success: false,
        message: "Badge not found",
      });
    }

    if (badge.isStatic) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete static badges",
      });
    }

    await prisma.badge.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: "Badge deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting badge:", error);
    
    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: "Badge not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to delete badge",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

/**
 * Get enabled badges for homepage (sorted by sortOrder)
 * GET /api/online/badges/homepage
 */
const getHomepageBadges = async (req, res) => {
  try {
    const badges = await prisma.badge.findMany({
      where: {
        enabledForHomepage: true,
      },
      orderBy: [
        { sortOrder: "asc" },
        { name: "asc" },
      ],
      select: {
        id: true,
        name: true,
        sortOrder: true,
      },
    });

    res.json({
      success: true,
      data: badges,
    });
  } catch (error) {
    console.error("Error fetching homepage badges:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch homepage badges",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

module.exports = {
  getAllBadges,
  getHomepageBadges,
  createBadge,
  updateBadge,
  resetStaticBadge,
  deleteBadge,
};
