const { prisma } = require("../../../../config/database");
const { getPresignedUrl } = require("../../../web/uploadsS3");

/**
 * Fetch dynamic company and admin data from database
 * This replaces hardcoded environment variables with database values
 */
async function getCompanyData() {
  try {
    // Fetch company settings
    const companySettings = await prisma.companySettings.findFirst();
    
    // Fetch admin data (first active admin)
    const admin = await prisma.admin.findFirst({
      where: { isActive: true },
      select: {
        email: true,
        phoneNumber: true,
        companyName: true,
      },
    });

    // Fetch web settings for logo
    const webSettings = await prisma.webSettings.findFirst();
    let logoUrl = null;
    if (webSettings && webSettings.logoUrl) {
      logoUrl = getPresignedUrl(webSettings.logoUrl);
    }

    // Build dynamic data object
    const data = {
      // Company information
      companyName: companySettings?.companyName || admin?.companyName || "Our Company",
      companyEmail: companySettings?.email || admin?.email || "support@example.com",
      companyPhone: companySettings?.phone || admin?.phoneNumber || "+91 1800-XXX-XXXX",
      companyWebsite: companySettings?.website || process.env.FRONTEND_URL || "https://tirzahimperial.com",
      
      // Logo
      logoUrl: logoUrl,
      
      // URLs
      frontendUrl: process.env.FRONTEND_URL || "https://tirzahimperial.com",
      
      // Support contact (use company email as support email)
      supportEmail: companySettings?.email || admin?.email || "support@example.com",
      supportPhone: companySettings?.phone || admin?.phoneNumber || "+91 1800-XXX-XXXX",
    };

    return data;
  } catch (error) {
    console.error("Error fetching company data:", error);
    
    // Return fallback data if database fetch fails
    return {
      companyName: "Our Company",
      companyEmail: "support@example.com",
      companyPhone: "+91 1800-XXX-XXXX",
      companyWebsite: process.env.FRONTEND_URL || "https://tirzahimperial.com",
      logoUrl: null,
      frontendUrl: process.env.FRONTEND_URL || "https://tirzahimperial.com",
      supportEmail: "support@example.com",
      supportPhone: "+91 1800-XXX-XXXX",
    };
  }
}

module.exports = { getCompanyData };
