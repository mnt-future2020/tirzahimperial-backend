const { prisma } = require("../../config/database");
const { sendToAllUsers } = require("../../utils/notification/sendNotification");


// Default settings object
const DEFAULT_SETTINGS = {
  liveOrderEnabled: true,
  liveOrderStartTime: "05:00",
  liveOrderEndTime: "11:59",
  liveOrderLabel: "Live Order",
  preOrderEnabled: true,
  preOrderStartTime: "12:00",
  preOrderEndTime: "23:59",
  preOrderLabel: "Pre-Order",
  countdownEnabled: true,
  deliverySlots: ["09:00 AM - 12:00 PM", "12:00 PM - 03:00 PM", "03:00 PM - 06:00 PM", "06:00 PM - 09:00 PM"],
  schedulingEnabled: true,
};

// Helper: get or create single settings document
const getOrCreateSettings = async () => {
  let settings = await prisma.orderScheduleSettings.findFirst();
  if (!settings) {
    settings = await prisma.orderScheduleSettings.create({
      data: DEFAULT_SETTINGS,
    });
  }
  return settings;
};

// Helper: compute current order window status (IST aware)
const computeWindowStatus = (settings) => {
  // Get IST time
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset);
  const currentHour = ist.getUTCHours();
  const currentMin = ist.getUTCMinutes();
  const currentTotal = currentHour * 60 + currentMin; // minutes since midnight

  const parseTime = (t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };

  const liveStart = parseTime(settings.liveOrderStartTime);
  const liveEnd = parseTime(settings.liveOrderEndTime);
  const preStart = parseTime(settings.preOrderStartTime);
  const preEnd = parseTime(settings.preOrderEndTime);

  let activeWindow = "CLOSED";
  let nextWindowLabel = "";
  let nextWindowTime = "";

  if (settings.liveOrderEnabled && currentTotal >= liveStart && currentTotal <= liveEnd) {
    activeWindow = "LIVE";
  } else if (settings.preOrderEnabled && currentTotal >= preStart && currentTotal <= preEnd) {
    activeWindow = "PRE_ORDER";
  } else {
    // Determine next window
    if (settings.liveOrderEnabled && currentTotal < liveStart) {
      nextWindowLabel = settings.liveOrderLabel;
      nextWindowTime = settings.liveOrderStartTime;
    } else if (settings.preOrderEnabled && currentTotal < preStart) {
      nextWindowLabel = settings.preOrderLabel;
      nextWindowTime = settings.preOrderStartTime;
    } else if (settings.liveOrderEnabled) {
      // Tomorrow's live order
      nextWindowLabel = settings.liveOrderLabel;
      nextWindowTime = settings.liveOrderStartTime;
    }
  }

  return {
    activeWindow,
    nextWindowLabel,
    nextWindowTime,
    currentTime: `${String(currentHour).padStart(2, "0")}:${String(currentMin).padStart(2, "0")}`,
  };
};

// GET /api/settings/order-schedule (Admin)
const getOrderSchedule = async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    const windowStatus = computeWindowStatus(settings);
    res.json({ success: true, data: { ...settings, windowStatus } });
  } catch (error) {
    console.error("Error fetching order schedule:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/settings/order-schedule (Admin)
const updateOrderSchedule = async (req, res) => {
  try {
    const {
      liveOrderEnabled,
      liveOrderStartTime,
      liveOrderEndTime,
      liveOrderLabel,
      preOrderEnabled,
      preOrderStartTime,
      preOrderEndTime,
      preOrderLabel,
      countdownEnabled,
      deliverySlots,
      schedulingEnabled,
    } = req.body;

    const settings = await getOrCreateSettings();

    const updated = await prisma.orderScheduleSettings.update({
      where: { id: settings.id },
      data: {
        ...(liveOrderEnabled !== undefined && { liveOrderEnabled }),
        ...(liveOrderStartTime && { liveOrderStartTime }),
        ...(liveOrderEndTime && { liveOrderEndTime }),
        ...(liveOrderLabel && { liveOrderLabel }),
        ...(preOrderEnabled !== undefined && { preOrderEnabled }),
        ...(preOrderStartTime && { preOrderStartTime }),
        ...(preOrderEndTime && { preOrderEndTime }),
        ...(preOrderLabel && { preOrderLabel }),
        ...(countdownEnabled !== undefined && { countdownEnabled }),
        ...(deliverySlots !== undefined && { deliverySlots }),
        ...(schedulingEnabled !== undefined && { schedulingEnabled }),
      },
    });

    const windowStatus = computeWindowStatus(updated);

    // Notify all users about the schedule change
    const notification = {
      title: "Order Timing Updated! 🕒",
      body: `${updated.liveOrderLabel}: ${updated.liveOrderStartTime} - ${updated.liveOrderEndTime}. ${updated.preOrderLabel}: ${updated.preOrderStartTime} - ${updated.preOrderEndTime}.`,
    };
    
    // Send background notification (don't await to avoid delaying the response)
    sendToAllUsers(notification, { 
      type: "SCHEDULE_UPDATE",
      liveStart: updated.liveOrderStartTime,
      liveEnd: updated.liveOrderEndTime,
      preStart: updated.preOrderStartTime,
      preEnd: updated.preOrderEndTime
    });

    res.json({

      success: true,
      message: "Order schedule settings updated successfully",
      data: { ...updated, windowStatus },
    });
  } catch (error) {
    console.error("Error updating order schedule:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/settings/order-schedule/public (Public — no auth required)
const getPublicOrderSchedule = async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    const windowStatus = computeWindowStatus(settings);

    // Only expose necessary fields to public
    res.json({
      success: true,
      data: {
        liveOrderEnabled: settings.liveOrderEnabled,
        liveOrderStartTime: settings.liveOrderStartTime,
        liveOrderEndTime: settings.liveOrderEndTime,
        liveOrderLabel: settings.liveOrderLabel,
        preOrderEnabled: settings.preOrderEnabled,
        preOrderStartTime: settings.preOrderStartTime,
        preOrderEndTime: settings.preOrderEndTime,
        preOrderLabel: settings.preOrderLabel,
        countdownEnabled: settings.countdownEnabled,
        deliverySlots: settings.deliverySlots,
        schedulingEnabled: settings.schedulingEnabled,
        windowStatus,
      },
    });
  } catch (error) {
    console.error("Error fetching public order schedule:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getOrderSchedule, updateOrderSchedule, getPublicOrderSchedule };
