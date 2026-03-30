const { prisma } = require("../../config/database");
const { uploadToS3, deleteFromS3, getPresignedUrl } = require("../../utils/web/uploadsS3");

// Define important public pages only (removed unnecessary pages)
const PUBLIC_PAGES = [
  { path: "/", name: "Home", description: "Homepage of the website", important: true },
  { path: "/about", name: "About Us", description: "About us page", important: true },
  { path: "/products", name: "Products", description: "All products listing page", important: true },
  { path: "/category", name: "Categories", description: "All categories listing page", important: true },
  { path: "/contact", name: "Contact Us", description: "Contact us page", important: true },
  { path: "/privacy", name: "Privacy Policy", description: "Privacy policy page", important: true },
  { path: "/terms", name: "Terms & Conditions", description: "Terms and conditions page", important: true },
  { path: "/shipping", name: "Shipping Policy", description: "Shipping policy page", important: true },
  { path: "/returns", name: "Returns & Refunds", description: "Returns and refunds policy page", important: true },
];

// Get all page SEO settings
const getAllPageSEO = async (req, res) => {
  try {
    console.log("Fetching all page SEO settings...");

    const pageSEOList = await prisma.pageSEO.findMany({
      orderBy: {
        pagePath: "asc",
      },
    });

    console.log(`Found ${pageSEOList.length} page SEO records`);

    // Generate pre-signed URLs for OG images
    const pageSEOWithUrls = await Promise.all(
      pageSEOList.map((pageSEO) => {
        try {
          const ogImageUrl = pageSEO.ogImage
            ? getPresignedUrl(pageSEO.ogImage, 3600)
            : null;
          return {
            ...pageSEO,
            ogImage: ogImageUrl,
          };
        } catch (error) {
          console.error(`Error generating URL for page ${pageSEO.pagePath}:`, error);
          return {
            ...pageSEO,
            ogImage: pageSEO.ogImage, // Return original key if pre-signed URL fails
          };
        }
      })
    );

    // Merge with PUBLIC_PAGES to ensure all pages are represented
    const allPages = PUBLIC_PAGES.map((publicPage) => {
      const existingSEO = pageSEOWithUrls.find((seo) => seo.pagePath === publicPage.path);
      if (existingSEO) {
        return existingSEO;
      }
      // Return default values for pages without SEO data
      return {
        id: null,
        pagePath: publicPage.path,
        pageName: publicPage.name,
        description: publicPage.description,
        metaTitle: "",
        metaDescription: "",
        metaKeywords: "",
        ogImage: null,
        isActive: true,
        createdAt: null,
        updatedAt: null,
      };
    });

    res.status(200).json({
      success: true,
      data: allPages,
    });
  } catch (error) {
    console.error("Error fetching page SEO settings:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch page SEO settings",
      message: error.message,
    });
  }
};

// Get single page SEO by path
const getPageSEOByPath = async (req, res) => {
  try {
    const { path } = req.params;
    const decodedPath = decodeURIComponent(path);

    console.log(`Fetching SEO for page: ${decodedPath}`);

    const pageSEO = await prisma.pageSEO.findUnique({
      where: { pagePath: decodedPath },
    });

    if (!pageSEO) {
      // Return default values if not found
      const publicPage = PUBLIC_PAGES.find((p) => p.path === decodedPath);
      if (!publicPage) {
        return res.status(404).json({
          success: false,
          error: "Page not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          pagePath: publicPage.path,
          pageName: publicPage.name,
          description: publicPage.description,
          metaTitle: "",
          metaDescription: "",
          metaKeywords: "",
          ogImage: null,
          isActive: true,
        },
      });
    }

    // Generate proxy URL for OG image
    const ogImageUrl = pageSEO.ogImage
      ? getPresignedUrl(pageSEO.ogImage, 3600)
      : null;

    res.status(200).json({
      success: true,
      data: {
        ...pageSEO,
        ogImage: ogImageUrl,
      },
    });
  } catch (error) {
    console.error("Error fetching page SEO:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch page SEO",
      message: error.message,
    });
  }
};

// Create or update page SEO
const savePageSEO = async (req, res) => {
  try {
    const {
      pagePath,
      pageName,
      description,
      metaTitle,
      metaDescription,
      metaKeywords,
      isActive,
    } = req.body;
    const ogImageFile = req.file;

    // Validation
    if (!pagePath || !pagePath.trim()) {
      return res.status(400).json({
        success: false,
        error: "Page path is required",
      });
    }

    if (!pageName || !pageName.trim()) {
      return res.status(400).json({
        success: false,
        error: "Page name is required",
      });
    }

    console.log(`Saving SEO for page: ${pagePath}`);

    // Check if SEO already exists for this page
    const existingSEO = await prisma.pageSEO.findUnique({
      where: { pagePath: pagePath.trim() },
    });

    let ogImageKey = existingSEO?.ogImage || null;

    // If new OG image is uploaded
    if (ogImageFile) {
      // Delete old image from S3 if exists
      if (existingSEO?.ogImage) {
        try {
          await deleteFromS3(existingSEO.ogImage);
        } catch (error) {
          console.error("Error deleting old OG image:", error);
          // Continue even if delete fails
        }
      }

      // Upload new image to S3
      ogImageKey = await uploadToS3(ogImageFile, "seo");
    }

    const seoData = {
      pagePath: pagePath.trim(),
      pageName: pageName.trim(),
      description: description?.trim() || null,
      metaTitle: metaTitle?.trim() || "",
      metaDescription: metaDescription?.trim() || "",
      metaKeywords: metaKeywords?.trim() || "",
      ogImage: ogImageKey,
      isActive: isActive !== undefined ? Boolean(isActive) : true,
    };

    let pageSEO;

    if (existingSEO) {
      // Update existing SEO
      pageSEO = await prisma.pageSEO.update({
        where: { id: existingSEO.id },
        data: seoData,
      });
      console.log(`Page SEO updated for: ${pagePath}`);
    } else {
      // Create new SEO
      pageSEO = await prisma.pageSEO.create({
        data: seoData,
      });
      console.log(`Page SEO created for: ${pagePath}`);
    }

    // Generate proxy URL for response
    const ogImageUrl = pageSEO.ogImage
      ? getPresignedUrl(pageSEO.ogImage, 3600)
      : null;

    res.status(200).json({
      success: true,
      message: "Page SEO saved successfully",
      data: {
        ...pageSEO,
        ogImage: ogImageUrl,
      },
    });
  } catch (error) {
    console.error("Error saving page SEO:", error);
    res.status(500).json({
      success: false,
      error: "Failed to save page SEO",
      message: error.message,
    });
  }
};

// Delete page SEO
const deletePageSEO = async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`Deleting page SEO: ${id}`);

    // Check if SEO exists
    const pageSEO = await prisma.pageSEO.findUnique({
      where: { id },
    });

    if (!pageSEO) {
      return res.status(404).json({
        success: false,
        error: "Page SEO not found",
      });
    }

    // Delete OG image from S3 if exists
    if (pageSEO.ogImage) {
      try {
        await deleteFromS3(pageSEO.ogImage);
      } catch (error) {
        console.error("Error deleting OG image from S3:", error);
        // Continue even if delete fails
      }
    }

    // Delete SEO from database
    await prisma.pageSEO.delete({
      where: { id },
    });

    res.status(200).json({
      success: true,
      message: "Page SEO deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting page SEO:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete page SEO",
      message: error.message,
    });
  }
};

// Function to detect company name from existing SEO titles
const detectCompanyName = async () => {
  try {
    // First, try to get from company settings
    const companySettings = await prisma.companySettings.findFirst();
    if (companySettings?.companyName?.trim()) {
      return companySettings.companyName.trim();
    }

    // Try to find existing categories with SEO titles that contain company names
    const existingCategory = await prisma.category.findFirst({
      where: {
        metaTitle: {
          contains: "|",
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    if (existingCategory && existingCategory.metaTitle) {
      const titleParts = existingCategory.metaTitle.split("|");
      if (titleParts.length > 1) {
        const detectedName = titleParts[titleParts.length - 1].trim();
        if (detectedName && detectedName !== "Your Company" && detectedName !== "ECommerce") {
          return detectedName;
        }
      }
    }

    // Also check subcategories
    const existingSubcategory = await prisma.subcategory.findFirst({
      where: {
        metaTitle: {
          contains: "|",
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    if (existingSubcategory && existingSubcategory.metaTitle) {
      const titleParts = existingSubcategory.metaTitle.split("|");
      if (titleParts.length > 1) {
        const detectedName = titleParts[titleParts.length - 1].trim();
        if (detectedName && detectedName !== "Your Company" && detectedName !== "ECommerce") {
          return detectedName;
        }
      }
    }

    // Check existing page SEO
    const existingPageSEO = await prisma.pageSEO.findFirst({
      where: {
        metaTitle: {
          contains: "|",
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    if (existingPageSEO && existingPageSEO.metaTitle) {
      const titleParts = existingPageSEO.metaTitle.split("|");
      if (titleParts.length > 1) {
        const detectedName = titleParts[titleParts.length - 1].trim();
        if (detectedName && detectedName !== "Your Company" && detectedName !== "ECommerce") {
          return detectedName;
        }
      }
    }

    return null; // Return null if nothing found
  } catch (error) {
    console.error("Error detecting company name:", error);
    return null;
  }
};

// Generate SEO using Groq AI
const generatePageSEO = async (req, res) => {
  try {
    const { pagePath, pageName, description } = req.body;

    if (!pagePath || !pageName) {
      return res.status(400).json({
        success: false,
        error: "Page path and name are required",
      });
    }

    console.log(`Generating SEO for page: ${pageName} (${pagePath})`);

    // Check if GROQ_API_KEY is configured
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "Groq API key is not configured",
        message: "Please add GROQ_API_KEY to your .env file. Get your API key from https://console.groq.com/keys",
      });
    }

    // Detect company name from existing data
    const companyName = await detectCompanyName();
    
    console.log('Company name detected:', companyName);

    // Import Groq
    const Groq = require("groq-sdk");
    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });

    const prompt = `Generate SEO metadata for an e-commerce website page.

Page Details:
- Page Name: ${pageName}
- Page Path: ${pagePath}
- Description: ${description || "N/A"}
${companyName ? `- Company Name: ${companyName}` : ''}

Generate the following in JSON format:
{
  "metaTitle": "SEO-optimized title (50-60 characters${companyName ? ', must include company name: ' + companyName : ''})",
  "metaDescription": "Compelling meta description (150-160 characters)",
  "metaKeywords": "relevant, keywords, separated, by, commas (8-12 keywords)"
}

Requirements:
- Meta title should be engaging${companyName ? ' and MUST include the company name "' + companyName + '"' : ''}
- Meta description should be compelling and include a call-to-action
- Keywords should be relevant to the page content and e-commerce
- Use proper capitalization and grammar
- Make it conversion-focused for e-commerce
${companyName ? '- IMPORTANT: The meta title MUST contain "' + companyName + '"' : ''}

Return ONLY the JSON object, no additional text.`;

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.7,
      max_tokens: 500,
    });

    const responseText = chatCompletion.choices[0]?.message?.content || "";
    console.log("Groq AI Response:", responseText);

    // Parse JSON response
    let seoData;
    try {
      // Try to extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        seoData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      console.error("Error parsing Groq response:", parseError);
      return res.status(500).json({
        success: false,
        error: "Failed to parse AI response",
        message: "The AI response was not in the expected format",
      });
    }

    res.status(200).json({
      success: true,
      data: {
        metaTitle: seoData.metaTitle || "",
        metaDescription: seoData.metaDescription || "",
        metaKeywords: seoData.metaKeywords || "",
      },
    });
  } catch (error) {
    console.error("Error generating SEO with Groq:", error);
    
    // Handle specific Groq API errors
    if (error.status === 401) {
      return res.status(500).json({
        success: false,
        error: "Invalid Groq API key",
        message: "Your Groq API key is invalid or expired. Please get a new API key from https://console.groq.com/keys and update your .env file.",
      });
    }
    
    if (error.status === 429) {
      return res.status(500).json({
        success: false,
        error: "Rate limit exceeded",
        message: "Groq API rate limit exceeded. Please try again in a few moments.",
      });
    }
    
    res.status(500).json({
      success: false,
      error: "Failed to generate SEO",
      message: error.message || "An unexpected error occurred while generating SEO",
    });
  }
};

module.exports = {
  getAllPageSEO,
  getPageSEOByPath,
  savePageSEO,
  deletePageSEO,
  generatePageSEO,
};
