const { prisma } = require("../../config/database");

// Get company settings
const getCompanySettings = async (req, res) => {
  try {
    console.log("Fetching company settings...");

    // Get the first (and should be only) company settings record
    let companySettings = await prisma.companySettings.findFirst();

    // If no settings exist, return default values
    if (!companySettings) {
      console.log("No company settings found, returning defaults");
      return res.status(200).json({
        success: true,
        data: {
          companyName: "",
          tagline: "",
          description: "",
          email: "",
          phone: "",
          address: "",
          city: "",
          state: "",
          zipCode: "",
          country: "",
          website: "",
          logoUrl: "",
          faviconUrl: "",
          mapIframe: "",
          affiliateEnabled: false,
          socialMedia: {
            facebook: "",
            twitter: "",
            instagram: "",
            linkedin: "",
            youtube: "",
          },
        },
      });
    }

    console.log("Company settings found");

    // Parse socialMedia JSON if it's a string
    const socialMedia =
      typeof companySettings.socialMedia === "string"
        ? JSON.parse(companySettings.socialMedia)
        : companySettings.socialMedia;

    res.status(200).json({
      success: true,
      data: {
        ...companySettings,
        socialMedia,
      },
    });
  } catch (error) {
    console.error("Error fetching company settings:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch company settings",
      message: error.message,
    });
  }
};

// Create or update company settings
const saveCompanySettings = async (req, res) => {
  try {
    const {
      companyName,
      tagline,
      description,
      email,
      phone,
      address,
      city,
      state,
      zipCode,
      country,
      website,
      logoUrl,
      faviconUrl,
      socialMedia,
      mapIframe,
      affiliateEnabled,
    } = req.body;

    // Validation
    if (!companyName || !companyName.trim()) {
      return res.status(400).json({
        success: false,
        error: "Company name is required",
      });
    }

    if (!email || !email.trim()) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      });
    }

    if (!phone || !phone.trim()) {
      return res.status(400).json({
        success: false,
        error: "Phone is required",
      });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: "Invalid email format",
      });
    }

    console.log("Saving company settings...");

    // Check if settings already exist
    const existingSettings = await prisma.companySettings.findFirst();

    const settingsData = {
      companyName: companyName.trim(),
      tagline: tagline?.trim() || "",
      description: description?.trim() || "",
      email: email.trim(),
      phone: phone.trim(),
      address: address?.trim() || "",
      city: city?.trim() || "",
      state: state?.trim() || "",
      zipCode: zipCode?.trim() || "",
      country: country?.trim() || "",
      website: website?.trim() || "",
      logoUrl: logoUrl?.trim() || "",
      faviconUrl: faviconUrl?.trim() || "",
      mapIframe: mapIframe?.trim() || "",
      affiliateEnabled: !!affiliateEnabled,
      socialMedia: socialMedia || {
        facebook: "",
        twitter: "",
        instagram: "",
        linkedin: "",
        youtube: "",
      },
    };

    let companySettings;

    if (existingSettings) {
      // Update existing settings
      companySettings = await prisma.companySettings.update({
        where: { id: existingSettings.id },
        data: settingsData,
      });
      console.log("Company settings updated");
    } else {
      // Create new settings
      companySettings = await prisma.companySettings.create({
        data: settingsData,
      });
      console.log("Company settings created");
    }

    // Parse socialMedia for response
    const responseSocialMedia =
      typeof companySettings.socialMedia === "string"
        ? JSON.parse(companySettings.socialMedia)
        : companySettings.socialMedia;

    res.status(200).json({
      success: true,
      message: "Company settings saved successfully",
      data: {
        ...companySettings,
        socialMedia: responseSocialMedia,
      },
    });
  } catch (error) {
    console.error("Error saving company settings:", error);
    res.status(500).json({
      success: false,
      error: "Failed to save company settings",
      message: error.message,
    });
  }
};

module.exports = {
  getCompanySettings,
  saveCompanySettings,
};
