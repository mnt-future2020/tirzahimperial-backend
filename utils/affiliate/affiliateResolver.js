const { prisma } = require("../../config/database");

const getAffiliateCodeStatus = async (affiliateCode) => {
  if (!affiliateCode) return { status: "invalid", affiliate: null };
  const code = affiliateCode.toUpperCase();

  const companySettings = await prisma.companySettings.findFirst();
  if (companySettings && companySettings.affiliateEnabled === false) {
    return { status: "disabled", affiliate: null };
  }

  const history = await prisma.affiliateCodeHistory.findUnique({ where: { code } });
  if (history) {
    if (history.status !== "active") {
      return { status: "expired", affiliate: null, history };
    }
    const affiliate = await prisma.affiliate.findUnique({ where: { id: history.affiliateId } });
    if (!affiliate || affiliate.status !== "active") {
      return { status: "inactive", affiliate: null, history };
    }
    return { status: "active", affiliate, history };
  }

  const affiliate = await prisma.affiliate.findUnique({ where: { affiliateCode: code } });
  if (!affiliate || affiliate.status !== "active") return { status: "invalid", affiliate: null };
  return { status: "active", affiliate };
};

const resolveAffiliateByCode = async (affiliateCode) => {
  const result = await getAffiliateCodeStatus(affiliateCode);
  return result.status === "active" ? result.affiliate : null;
};

module.exports = {
  resolveAffiliateByCode,
  getAffiliateCodeStatus,
};
