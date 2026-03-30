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
    wallet = await prisma.rewardWallet.create({
      data: { userId },
    });
  }
  return wallet;
};

const listRewardWallets = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = "" } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const take = parseInt(limit, 10);

    const whereUser = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { phoneNumber: { contains: search, mode: "insensitive" } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where: whereUser,
        select: { id: true, name: true, email: true, phoneNumber: true, image: true },
        skip,
        take,
        orderBy: { createdAt: "desc" },
      }),
      prisma.user.count({ where: whereUser }),
    ]);

    const walletMap = new Map();
    const wallets = await prisma.rewardWallet.findMany({
      where: { userId: { in: users.map((u) => u.id) } },
    });
    wallets.forEach((wallet) => walletMap.set(wallet.userId, wallet));

    res.json({
      success: true,
      data: users.map((user) => ({
        user,
        wallet: walletMap.get(user.id) || {
          userId: user.id,
          balance: 0,
          totalEarned: 0,
          totalRedeemed: 0,
          lastEarnedAt: null,
        },
      })),
      pagination: {
        page: parseInt(page, 10),
        limit: take,
        total,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (error) {
    console.error("Reward wallets list error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch reward wallets" });
  }
};

const getRewardWalletByUser = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ success: false, error: "User ID is required" });
    }
    const wallet = await getRewardWallet(userId);
    const recent = await prisma.rewardTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    res.json({ success: true, data: { wallet, recent } });
  } catch (error) {
    console.error("Reward wallet detail error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch reward wallet" });
  }
};

const adjustRewardBalance = async (req, res) => {
  try {
    const { userId, points, note } = req.body || {};
    if (!userId) {
      return res.status(400).json({ success: false, error: "User ID is required" });
    }
    const delta = Number(points);
    if (Number.isNaN(delta) || delta === 0) {
      return res.status(400).json({ success: false, error: "Points must be a non-zero number" });
    }

    const wallet = await getRewardWallet(userId);
    const nextBalance = Math.max(0, wallet.balance + delta);

    const updatedWallet = await prisma.rewardWallet.update({
      where: { userId },
      data: {
        balance: nextBalance,
        totalEarned: delta > 0 ? wallet.totalEarned + delta : wallet.totalEarned,
        totalRedeemed: delta < 0 ? wallet.totalRedeemed + Math.abs(delta) : wallet.totalRedeemed,
      },
    });

    const transaction = await prisma.rewardTransaction.create({
      data: {
        userId,
        adminId: req.userId,
        type: "adjust",
        points: delta,
        balanceAfter: nextBalance,
        note: note ? String(note).trim() : null,
      },
    });

    res.json({ success: true, data: { wallet: updatedWallet, transaction } });
  } catch (error) {
    console.error("Reward adjust error:", error);
    res.status(500).json({ success: false, error: "Failed to adjust reward balance" });
  }
};

const getRewardStats = async (req, res) => {
  try {
    const settings = await getSettingsRecord();
    const [walletCount, totalBalance, totalEarned, totalRedeemed] = await Promise.all([
      prisma.rewardWallet.count(),
      prisma.rewardWallet.aggregate({ _sum: { balance: true } }),
      prisma.rewardWallet.aggregate({ _sum: { totalEarned: true } }),
      prisma.rewardWallet.aggregate({ _sum: { totalRedeemed: true } }),
    ]);

    res.json({
      success: true,
      data: {
        enabled: settings.enabled,
        walletCount,
        totalBalance: totalBalance._sum.balance || 0,
        totalEarned: totalEarned._sum.totalEarned || 0,
        totalRedeemed: totalRedeemed._sum.totalRedeemed || 0,
      },
    });
  } catch (error) {
    console.error("Reward stats error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch reward stats" });
  }
};

module.exports = {
  listRewardWallets,
  getRewardWalletByUser,
  adjustRewardBalance,
  getRewardStats,
};
