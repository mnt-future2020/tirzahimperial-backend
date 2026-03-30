const { prisma } = require("../../config/database");

const getSettingsRecord = async () => {
  let settings = await prisma.rewardSettings.findFirst();
  if (!settings) {
    settings = await prisma.rewardSettings.create({ data: {} });
  }
  return settings;
};

const getPublicRewardSettings = async (req, res) => {
  try {
    const settings = await getSettingsRecord();
    res.json({
      success: true,
      data: {
        enabled: settings.enabled,
        programName: settings.programName,
        currencyUnit: settings.currencyUnit,
        pointsPerUnit: settings.pointsPerUnit,
        minOrderValue: settings.minOrderValue,
        maxPointsPerOrder: settings.maxPointsPerOrder,
        redeemEnabled: settings.redeemEnabled,
        redeemMinPoints: settings.redeemMinPoints,
        redeemMaxPoints: settings.redeemMaxPoints,
        redeemValuePerPoint: settings.redeemValuePerPoint,
        refundRedeemOnCancel: settings.refundRedeemOnCancel,
      },
    });
  } catch (error) {
    console.error("Reward settings public error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch reward settings" });
  }
};

const getAdminRewardSettings = async (req, res) => {
  try {
    const settings = await getSettingsRecord();
    res.json({ success: true, data: settings });
  } catch (error) {
    console.error("Reward settings admin error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch reward settings" });
  }
};

const updateAdminRewardSettings = async (req, res) => {
  try {
    const {
      enabled,
      programName,
      currencyUnit,
      pointsPerUnit,
      minOrderValue,
      maxPointsPerOrder,
      signupBonus,
      redeemEnabled,
      redeemMinPoints,
      redeemMaxPoints,
      redeemValuePerPoint,
      refundRedeemOnCancel,
    } = req.body || {};

    const settings = await getSettingsRecord();

    const updated = await prisma.rewardSettings.update({
      where: { id: settings.id },
      data: {
        ...(enabled !== undefined && { enabled: !!enabled }),
        ...(programName !== undefined && { programName: String(programName).trim() || "Rewards" }),
        ...(currencyUnit !== undefined && { currencyUnit: Number(currencyUnit) || 100 }),
        ...(pointsPerUnit !== undefined && { pointsPerUnit: Math.max(0, Number(pointsPerUnit) || 0) }),
        ...(minOrderValue !== undefined && { minOrderValue: Math.max(0, Number(minOrderValue) || 0) }),
        ...(maxPointsPerOrder !== undefined && {
          maxPointsPerOrder: maxPointsPerOrder === null || maxPointsPerOrder === ""
            ? null
            : Math.max(0, Number(maxPointsPerOrder) || 0),
        }),
        ...(signupBonus !== undefined && { signupBonus: Math.max(0, Number(signupBonus) || 0) }),
        ...(redeemEnabled !== undefined && { redeemEnabled: !!redeemEnabled }),
        ...(redeemMinPoints !== undefined && { redeemMinPoints: Math.max(0, Number(redeemMinPoints) || 0) }),
        ...(redeemMaxPoints !== undefined && {
          redeemMaxPoints: redeemMaxPoints === null || redeemMaxPoints === ""
            ? null
            : Math.max(0, Number(redeemMaxPoints) || 0),
        }),
        ...(redeemValuePerPoint !== undefined && { redeemValuePerPoint: Math.max(0, Number(redeemValuePerPoint) || 0) }),
        ...(refundRedeemOnCancel !== undefined && { refundRedeemOnCancel: !!refundRedeemOnCancel }),
      },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Reward settings update error:", error);
    res.status(500).json({ success: false, error: "Failed to update reward settings" });
  }
};

module.exports = {
  getPublicRewardSettings,
  getAdminRewardSettings,
  updateAdminRewardSettings,
};
