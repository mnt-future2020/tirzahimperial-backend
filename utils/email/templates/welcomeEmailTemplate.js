const { prisma } = require("../../../config/database");
const { getPresignedUrl } = require("../../web/uploadsS3");

/**
 * Fetch company logo from web settings
 */
async function getCompanyLogo() {
  try {
    const webSettings = await prisma.webSettings.findFirst();
    if (webSettings && webSettings.logoUrl) {
      return getPresignedUrl(webSettings.logoUrl);
    }
    return null;
  } catch (error) {
    console.error("Error fetching company logo:", error);
    return null;
  }
}

/**
 * Fetch company name from company settings
 */
async function getCompanyName() {
  try {
    const companySettings = await prisma.companySettings.findFirst();
    if (companySettings && companySettings.companyName) {
      return companySettings.companyName;
    }
    return "Our Platform";
  } catch (error) {
    console.error("Error fetching company name:", error);
    return "Our Platform";
  }
}

/**
 * Welcome Email Template
 * Sent after user email verification
 */
const getWelcomeEmailTemplate = async (data) => {
  const { email, name } = data;
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const logoUrl = await getCompanyLogo();
  const companyName = await getCompanyName();

  return {
    subject: `Welcome to ${companyName} - Your Luxury Beauty Journey Begins`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to ${companyName}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Inter:wght@300;400;500&display=swap');
        </style>
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Inter', Arial, sans-serif; background: linear-gradient(135deg, #faf7f4 0%, #f5f1eb 100%); min-height: 100vh;">
        <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <!-- Luxury Header with Gold Accent -->
          <div style="background: linear-gradient(135deg, #2d1f0e 0%, #1a1209 100%); position: relative; overflow: hidden;">
            <!-- Gold accent border -->
            <div style="height: 4px; background: linear-gradient(90deg, #c49a3c 0%, #d4af47 50%, #c49a3c 100%);"></div>
            
            <!-- Header Content -->
            <div style="padding: 50px 40px; text-align: center; position: relative;">
              <!-- Decorative elements -->
              <div style="position: absolute; top: 20px; left: 20px; width: 60px; height: 60px; border: 1px solid #c49a3c; opacity: 0.3; transform: rotate(45deg);"></div>
              <div style="position: absolute; bottom: 20px; right: 20px; width: 40px; height: 40px; border: 1px solid #c49a3c; opacity: 0.2; transform: rotate(45deg);"></div>
              
              ${logoUrl ? `
              <div style="margin-bottom: 30px;">
                <img src="${logoUrl}" alt="${companyName}" style="max-width: 200px; max-height: 80px; filter: brightness(1.1);" />
              </div>
              ` : ''}
              
              <h1 style="font-family: 'Playfair Display', serif; color: #c49a3c; margin: 0 0 15px 0; font-size: 36px; font-weight: 700; letter-spacing: 2px; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">
                WELCOME
              </h1>
              <p style="color: #faf7f4; font-size: 18px; font-weight: 300; letter-spacing: 1px; margin: 0; opacity: 0.9;">
                Your luxury beauty journey begins now
              </p>
            </div>
          </div>

          <!-- Main Content -->
          <div style="background: #faf7f4; padding: 50px 40px; border-left: 4px solid #c49a3c; border-right: 4px solid #c49a3c;">
            <div style="text-align: center; margin-bottom: 40px;">
              <div style="width: 60px; height: 2px; background: #c49a3c; margin: 0 auto 30px auto;"></div>
              
              <p style="color: #2d1f0e; font-size: 18px; font-weight: 400; letter-spacing: 0.5px; margin: 0 0 20px 0; line-height: 1.6;">
                Hello <span style="color: #c49a3c; font-weight: 500;">${name || 'Beautiful'}</span>,
              </p>
              
              <p style="color: #6b5040; font-size: 16px; font-weight: 300; letter-spacing: 0.3px; margin: 0 0 25px 0; line-height: 1.7;">
                Your email has been verified successfully! Welcome to the exclusive world of <strong style="color: #2d1f0e;">${companyName}</strong> - where luxury meets beauty.
              </p>
              
              <p style="color: #6b5040; font-size: 16px; font-weight: 300; letter-spacing: 0.3px; margin: 0 0 40px 0; line-height: 1.7;">
                You now have access to our curated collection of premium cosmetics, exclusive offers, and personalized beauty experiences.
              </p>
            </div>

            <!-- CTA Button -->
            <div style="text-align: center; margin: 50px 0;">
              <a href="${frontendUrl}/" 
                 style="display: inline-block; background: linear-gradient(135deg, #c49a3c 0%, #d4af47 100%); color: #2d1f0e; padding: 18px 45px; text-decoration: none; font-weight: 500; font-size: 16px; letter-spacing: 1px; text-transform: uppercase; box-shadow: 0 8px 25px rgba(196, 154, 60, 0.3); transition: all 0.3s ease; border: 2px solid transparent;">
                Explore Collection
              </a>
            </div>

            <!-- Features Section -->
            <div style="margin: 50px 0; padding: 30px; background: rgba(196, 154, 60, 0.05); border: 1px solid rgba(196, 154, 60, 0.2);">
              <h3 style="font-family: 'Playfair Display', serif; color: #2d1f0e; font-size: 22px; font-weight: 600; text-align: center; margin: 0 0 25px 0; letter-spacing: 1px;">
                What Awaits You
              </h3>
              
              <div style="display: table; width: 100%; margin-top: 20px;">
                <div style="display: table-row;">
                  <div style="display: table-cell; width: 33.33%; text-align: center; padding: 15px; vertical-align: top;">
                    <div style="color: #c49a3c; font-size: 24px; margin-bottom: 10px;">✨</div>
                    <p style="color: #2d1f0e; font-size: 14px; font-weight: 500; margin: 0 0 8px 0; letter-spacing: 0.5px;">Premium Products</p>
                    <p style="color: #6b5040; font-size: 12px; font-weight: 300; margin: 0; line-height: 1.4;">Curated luxury cosmetics</p>
                  </div>
                  <div style="display: table-cell; width: 33.33%; text-align: center; padding: 15px; vertical-align: top;">
                    <div style="color: #c49a3c; font-size: 24px; margin-bottom: 10px;">🎁</div>
                    <p style="color: #2d1f0e; font-size: 14px; font-weight: 500; margin: 0 0 8px 0; letter-spacing: 0.5px;">Exclusive Offers</p>
                    <p style="color: #6b5040; font-size: 12px; font-weight: 300; margin: 0; line-height: 1.4;">Member-only discounts</p>
                  </div>
                  <div style="display: table-cell; width: 33.33%; text-align: center; padding: 15px; vertical-align: top;">
                    <div style="color: #c49a3c; font-size: 24px; margin-bottom: 10px;">💄</div>
                    <p style="color: #2d1f0e; font-size: 14px; font-weight: 500; margin: 0 0 8px 0; letter-spacing: 0.5px;">Beauty Expertise</p>
                    <p style="color: #6b5040; font-size: 12px; font-weight: 300; margin: 0; line-height: 1.4;">Professional guidance</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Closing -->
            <div style="text-align: center; margin-top: 40px;">
              <div style="width: 60px; height: 2px; background: #c49a3c; margin: 0 auto 25px auto;"></div>
              <p style="color: #6b5040; font-size: 15px; font-weight: 300; letter-spacing: 0.3px; margin: 0 0 15px 0; line-height: 1.6;">
                Thank you for choosing luxury. Thank you for choosing us.
              </p>
              <p style="color: #2d1f0e; font-size: 16px; font-weight: 400; margin: 0; letter-spacing: 0.5px;">
                With elegance,<br>
                <span style="color: #c49a3c; font-weight: 500;">The ${companyName} Team</span>
              </p>
            </div>
          </div>
``
          <!-- Footer -->
          <div style="background: #2d1f0e; padding: 30px 40px; text-align: center;">
            <div style="height: 2px; background: linear-gradient(90deg, transparent 0%, #c49a3c 50%, transparent 100%); margin-bottom: 20px;"></div>
            <p style="color: #6b5040; font-size: 12px; font-weight: 300; margin: 0; letter-spacing: 0.5px; opacity: 0.8;">
              This is an automated email. Please do not reply to this message.
            </p>
            <p style="color: #c49a3c; font-size: 11px; font-weight: 400; margin: 10px 0 0 0; letter-spacing: 1px; text-transform: uppercase;">
              ${companyName} - Luxury Redefined
            </p>
          </div>
        </div>
      </body>
      </html>
    `,
  };
};

module.exports = {
  getWelcomeEmailTemplate,
};
