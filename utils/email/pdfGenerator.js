/**
 * PDF Generator for Purchase Orders
 * Uses puppeteer to convert HTML to PDF
 */

const puppeteer = require("puppeteer");

/**
 * Generate PDF from HTML
 * @param {string} html - HTML content
 * @param {object} options - PDF options
 * @returns {Promise<Buffer>} PDF buffer
 */
const generatePDFFromHTML = async (html, options = {}) => {
  let browser;
  try {
    // Launch browser
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();

    // Set content
    await page.setContent(html, {
      waitUntil: "networkidle0",
    });

    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: options.format || "A4",
      printBackground: true,
      margin: {
        top: "10mm",
        right: "10mm",
        bottom: "10mm",
        left: "10mm",
      },
      ...options,
    });

    return pdfBuffer;
  } catch (error) {
    console.error("Error generating PDF:", error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

/**
 * Check if puppeteer is available
 */
const isPuppeteerAvailable = async () => {
  try {
    require.resolve("puppeteer");
    return true;
  } catch (error) {
    return false;
  }
};

module.exports = {
  generatePDFFromHTML,
  isPuppeteerAvailable,
};
