const { prisma } = require("../../config/database");

const getSettingsRecord = async () => {
  let settings = await prisma.rewardSettings.findFirst();
  if (!settings) {
    settings = await prisma.rewardSettings.create({ data: {} });
  }
  return settings;
};

const getRewardWallet = async (userId) => {
  let wallet = await prisma.rewardWallet.findUnique({ where: { userId } });
  if (!wallet) {
    wallet = await prisma.rewardWallet.create({ data: { userId } });
  }
  return wallet;
};

const getMyRewards = async (req, res) => {
  try {
    const settings = await getSettingsRecord();
    if (!settings.enabled) {
      return res.json({
        success: true,
        data: {
          enabled: false,
          wallet: null,
          transactions: [],
        },
      });
    }

    const wallet = await getRewardWallet(req.userId);
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const take = parseInt(limit, 10);

    const [transactions, total] = await Promise.all([
      prisma.rewardTransaction.findMany({
        where: { userId: req.userId },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.rewardTransaction.count({ where: { userId: req.userId } }),
    ]);

    res.json({
      success: true,
      data: {
        enabled: true,
        wallet,
        transactions,
      },
      pagination: {
        page: parseInt(page, 10),
        limit: take,
        total,
        totalPages: Math.ceil(total / take),
      },
      settings: {
        programName: settings.programName,
        currencyUnit: settings.currencyUnit,
        pointsPerUnit: settings.pointsPerUnit,
      },
    });
  } catch (error) {
    console.error("Reward wallet user error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch rewards" });
  }
};

module.exports = {
  getMyRewards,
};
