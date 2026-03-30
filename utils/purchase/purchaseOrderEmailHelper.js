const { sendEmail: sendSMTPEmail, sendEmailWithEnv } = require("../../config/connectSMTP");
const { prisma } = require("../../config/database");
const { getPresignedUrl } = require("../web/uploadsS3");
const { getS3Object } = require("../common/imageProxy");
const puppeteer = require("puppeteer");
const { formatUOMDisplay, getUOMSymbol } = require("../inventory/uomConverter");

/**
 * Purchase Order Invoice Template
 * Unified template for both email body and PDF attachment
 * Now includes company logo from web settings
 */

/**
 * Get action-specific styling and message
 */
const getActionStyle = (action) => {
  const styles = {
    sent: {
      color: "#10B981",
      bgColor: "#10B98115",
      text: "A new purchase order has been created and sent to you.",
      title: "New Purchase Order",
      badge: "NEW ORDER",
    },
    updated: {
      color: "#F59E0B",
      bgColor: "#F59E0B15",
      text: "The purchase order has been updated. Please review the changes.",
      title: "Purchase Order Updated",
      badge: "UPDATED",
    },
    cancelled: {
      color: "#EF4444",
      bgColor: "#EF444415",
      text: "The purchase order has been cancelled.",
      title: "Purchase Order Cancelled",
      badge: "CANCELLED",
    },
  };

  return styles[action] || styles.sent;
};

/**
 * Generate complete PO invoice HTML
 * Used for both email body and PDF generation
 * @param {object} purchaseOrderData - Purchase order data
 * @param {string} action - Action type (sent, updated, cancelled)
 * @param {boolean} isForPDF - Whether this is for PDF generation (removes action banner)
 */
const getPurchaseOrderInvoiceHTML = (
  purchaseOrderData,
  action = "sent",
  isForPDF = false
) => {
  const {
    poId,
    poDate,
    expectedDeliveryDate,
    supplierName,
    contactPersonName,
    supplierPhone,
    supplierEmail,
    supplierGSTIN,
    billingAddress,
    shippingAddress,
    warehouseName,
    currency,
    currencySymbol,
    items = [],
    subTotal,
    discount,
    discountType,
    totalCGST,
    totalSGST,
    totalIGST,
    totalGST,
    otherCharges,
    roundingAdjustment,
    grandTotal,
    poNotes,
  } = purchaseOrderData;

  // Use currency symbol from data, fallback to 
  const symbol = currencySymbol || "";

  


  // Calculate discount amount
  let discountAmount = discount || 0;
  if (discountType === "percentage" && subTotal) {
    discountAmount = (subTotal * discount) / 100;
  }

  // Get action styling
  const style = getActionStyle(action);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Purchase Order - ${poId}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f5f5f5;
    }
    .container {
      max-width: 900px;
      margin: 20px auto;
      background: white;
      box-shadow: 0 0 20px rgba(0,0,0,0.1);
    }
    .header-table {
      width: 100%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      border-collapse: collapse;
    }
    .header-logo {
      max-width: 180px;
      max-height: 80px;
      display: block;
    }
    .header-center-text {
      font-size: 32px;
      margin: 0;
      text-align: center;
      font-weight: bold;
      letter-spacing: 2px;
    }
    .po-number-display {
      font-size: 24px;
      font-weight: bold;
      text-align: right;
    }
    .status-badge {
      display: inline-block;
      padding: 6px 12px;
      background: ${style.color};
      color: white;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.5px;
      margin-top: 5px;
    }
    .content {
      padding: 30px;
    }
    .info-section {
      display: table;
      width: 100%;
      margin-bottom: 30px;
    }
    .info-box {
      display: table-cell;
      width: 50%;
      vertical-align: top;
      padding: 15px;
    }
    .info-box h3 {
      color: #667eea;
      font-size: 14px;
      text-transform: uppercase;
      margin-bottom: 10px;
      border-bottom: 2px solid #667eea;
      padding-bottom: 5px;
    }
    .info-box p {
      margin: 5px 0;
      font-size: 13px;
    }
    .info-box strong {
      color: #555;
      display: inline-block;
      min-width: 120px;
    }
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 13px;
    }
    .items-table thead {
      background: #667eea;
      color: white;
    }
    .items-table th {
      padding: 12px 8px;
      text-align: left;
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
    }
    .items-table td {
      padding: 10px 8px;
      border-bottom: 1px solid #e0e0e0;
    }
    .items-table tbody tr:hover {
      background-color: #f9f9f9;
    }
    .text-right {
      text-align: right;
    }
    .text-center {
      text-align: center;
    }
    .summary-section {
      margin-top: 30px;
      display: table;
      width: 100%;
    }
    .summary-left {
      display: table-cell;
      width: 50%;
      vertical-align: top;
      padding-right: 20px;
    }
    .summary-right {
      display: table-cell;
      width: 50%;
      vertical-align: top;
    }
    .summary-table {
      width: 100%;
      font-size: 13px;
    }
    .summary-table td {
      padding: 8px 0;
      border-bottom: 1px solid #e0e0e0;
    }
    .summary-table .label {
      color: #666;
    }
    .summary-table .value {
      text-align: right;
      font-weight: 600;
    }
    .summary-table .total-row {
      background: #f0f0f0;
      font-size: 16px;
      font-weight: bold;
    }
    .summary-table .total-row td {
      padding: 12px 10px;
      border: none;
      color: #667eea;
    }
    .gst-breakdown {
      background: #f9f9f9;
      padding: 15px;
      border-radius: 5px;
      margin-bottom: 15px;
    }
    .gst-breakdown h4 {
      color: #667eea;
      font-size: 13px;
      margin-bottom: 10px;
      text-transform: uppercase;
    }
    .gst-breakdown table {
      width: 100%;
      font-size: 12px;
    }
    .gst-breakdown td {
      padding: 5px 0;
    }
    .notes-section {
      margin-top: 30px;
      padding: 15px;
      background: #fff9e6;
      border-left: 4px solid #ffc107;
      border-radius: 4px;
    }
    .notes-section h4 {
      color: #f57c00;
      margin-bottom: 8px;
      font-size: 14px;
    }
    .notes-section p {
      color: #666;
      font-size: 13px;
      line-height: 1.6;
    }
    .footer {
      background: #f5f5f5;
      padding: 20px 30px;
      text-align: center;
      border-top: 3px solid #667eea;
    }
    .footer p {
      color: #666;
      font-size: 12px;
      margin: 5px 0;
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-success {
      background: #d4edda;
      color: #155724;
    }
    .action-banner {
      background-color: ${style.bgColor};
      padding: 20px;
      border-left: 4px solid ${style.color};
      margin-bottom: 20px;
      border-radius: 4px;
    }
    .action-banner p {
      margin: 0;
      color: #374151;
      font-size: 16px;
      font-weight: 600;
    }
    .status-badge {
      display: inline-block;
      padding: 6px 12px;
      background: ${style.color};
      color: white;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.5px;
      margin-left: 10px;
    }
    @media print {
      body {
        background: white;
      }
      .container {
        box-shadow: none;
        margin: 0;
      }
      .action-banner {
        display: none;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    ${
      !isForPDF
        ? `
    <!-- Action Banner (only in email, not in PDF) -->
    <div class="action-banner">
      <p>${style.text}</p>
    </div>
    `
        : ""
    }

    <!-- Header -->
    <table class="header-table">
      <tr>
        <td style="width: 30%; vertical-align: middle;">
          ${
            purchaseOrderData.logoUrl
              ? `<img src="${purchaseOrderData.logoUrl}" alt="Logo" class="header-logo" />`
              : `<h2 style="margin:0; font-size: 24px;">${
                  purchaseOrderData.companyName || "COMPANY"
                }</h2>`
          }
        </td>
        <td style="width: 40%; vertical-align: middle; text-align: center;">
          <h1 style="margin:0; font-size: 28px; letter-spacing: 2px; color: white;">PURCHASE ORDER</h1>
          <div style="margin-top: 5px; font-weight: bold; background: rgba(255,255,255,0.2); display: inline-block; padding: 2px 10px; border-radius: 3px; color: white;">
            ${poId}
          </div>
        </td>
        <td style="width: 30%; vertical-align: middle; text-align: right;">
          <div class="status-badge">${style.badge}</div>
        </td>
      </tr>
    </table>

    <!-- Content -->
    <div class="content">
      <!-- Info Section -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
        <tr>
          <td class="info-box" style="width: 50%;">
            <h3>📋 Order Information</h3>
            <p><strong>PO Number:</strong> ${poId}</p>
            <p><strong>PO Date:</strong> ${new Date(poDate).toLocaleDateString(
              "en-IN",
              {
                day: "2-digit",
                month: "short",
                year: "numeric",
              }
            )}</p>
            <p><strong>Expected Delivery:</strong> ${new Date(
              expectedDeliveryDate
            ).toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}</p>
          </td>
          <td class="info-box" style="width: 50%;">
            <h3>🏢 Supplier Details</h3>
            <p><strong>Name:</strong> ${supplierName}</p>
            ${
              contactPersonName
                ? `<p><strong>Contact Person:</strong> ${contactPersonName}</p>`
                : ""
            }
            <p><strong>Phone:</strong> ${supplierPhone}</p>
            <p><strong>Email:</strong> ${supplierEmail}</p>
            <p><strong>GSTIN:</strong> ${supplierGSTIN || "N/A"}</p>
          </td>
        </tr>
      </table>

      <table class="info-section">
        <tr>
          <td class="info-box">
            <h3>📍 Billing Address</h3>
            <p>${billingAddress}</p>
          </td>
          <td class="info-box">
            <h3>📦 Shipping Address</h3>
            <p><strong>Warehouse:</strong> ${warehouseName}</p>
            <p>${shippingAddress}</p>
          </td>
        </tr>
      </table>

      <!-- Items Table -->
      <table class="items-table">
        <thead>
          <tr>
            <th style="width: 5%; text-align: center;">#</th>
            <th style="width: 30%;">Product Name</th>
            <th style="width: 15%;">SKU</th>
            <th style="width: 8%; text-align: center;">Qty</th>
            <th style="width: 8%; text-align: center;">UOM</th>
            <th style="width: 10%; text-align: right;">Price</th>
            <th style="width: 12%; text-align: right;">GST Amt</th>
            <th style="width: 12%; text-align: right;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map(
              (item, index) => `
            <tr>
              <td class="text-center">${index + 1}</td>
              <td style="vertical-align: top;">
                <div style="font-weight: 600;">${item.productName}</div>
                ${
                  item.category
                    ? `<div style="font-size: 11px; color: #666; margin-top: 2px;">${item.category}</div>`
                    : ""
                }
              </td>
              <td style="vertical-align: top;">${item.sku || "-"}</td>
              <td class="text-center" style="vertical-align: top;">${item.quantity}</td>
              <td class="text-center" style="vertical-align: top;">${getUOMSymbol(item.uom)}</td>
              <td class="text-right" style="vertical-align: top;">${symbol}${item.price.toFixed(
                2
              )}</td>
              <td class="text-right" style="vertical-align: top;">
                ${symbol}${item.totalGstAmount.toFixed(2)}<br>
                <small style="color: #888; font-size: 10px;">(${
                  item.gstPercentage
                }%)</small>
              </td>
              <td class="text-right" style="font-weight: 600; vertical-align: top;">${symbol}${item.totalPrice.toFixed(
                2
              )}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>

      <!-- Summary Section -->
      <!-- Summary Section -->
      <table style="width: 100%; border-collapse: collapse; margin-top: 30px;">
        <tr>
          <td style="width: 50%; vertical-align: top;">
            ${
              totalCGST > 0 || totalSGST > 0 || totalIGST > 0
                ? `
            <div class="gst-breakdown">
              <h4>📊 GST Breakdown</h4>
              <table>
                ${
                  totalCGST > 0
                    ? `
                <tr>
                  <td>CGST:</td>
                  <td class="text-right"><strong>${symbol}${totalCGST.toFixed(
                        2
                      )}</strong></td>
                </tr>
                `
                    : ""
                }
                ${
                  totalSGST > 0
                    ? `
                <tr>
                  <td>SGST:</td>
                  <td class="text-right"><strong>${symbol}${totalSGST.toFixed(
                        2
                      )}</strong></td>
                </tr>
                `
                    : ""
                }
                ${
                  totalIGST > 0
                    ? `
                <tr>
                  <td>IGST:</td>
                  <td class="text-right"><strong>${symbol}${totalIGST.toFixed(
                        2
                      )}</strong></td>
                </tr>
                `
                    : ""
                }
                <tr style="border-top: 1px solid #ddd; font-weight: bold;">
                  <td>Total GST:</td>
                  <td class="text-right">${symbol}${totalGST.toFixed(2)}</td>
                </tr>
              </table>
            </div>
            `
                : ""
            }
          </td>
          <td style="width: 50%; vertical-align: top;">
            <table class="summary-table">
              <tr>
                <td class="label">Subtotal:</td>
                <td class="value">${symbol}${subTotal.toFixed(2)}</td>
              </tr>
              ${
                discount > 0
                  ? `
              <tr>
                <td class="label">Discount ${
                  discountType === "percentage" ? `(${discount}%)` : ""
                }:</td>
                <td class="value">- ${symbol}${discountAmount.toFixed(2)}</td>
              </tr>
              `
                  : ""
              }
              <tr>
                <td class="label">Total GST:</td>
                <td class="value">${symbol}${totalGST.toFixed(2)}</td>
              </tr>
              ${
                otherCharges > 0
                  ? `
              <tr>
                <td class="label">Other Charges:</td>
                <td class="value">${symbol}${otherCharges.toFixed(2)}</td>
              </tr>
              `
                  : ""
              }
              ${
                roundingAdjustment !== 0
                  ? `
              <tr>
                <td class="label">Rounding Adjustment:</td>
                <td class="value">${symbol}${roundingAdjustment.toFixed(2)}</td>
              </tr>
              `
                  : ""
              }
              <tr class="total-row">
                <td style="color: #333;">GRAND TOTAL:</td>
                <td class="text-right">${symbol}${grandTotal.toLocaleString("en-IN", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      ${
        poNotes
          ? `
      <!-- Notes Section -->
      <div class="notes-section">
        <h4>📝 Notes</h4>
        <p>${poNotes}</p>
      </div>
      `
          : ""
      }
    </div>

    <!-- Footer -->
    <div class="footer">
      <p><strong>Thank you for your business!</strong></p>
    </div>
  </div>
</body>
</html>
  `;
};

/**
 * Get Purchase Order Email with Invoice
 * Returns both email HTML and subject
 */
const getPurchaseOrderInvoiceEmailTemplate = (data) => {
  const { action, purchaseOrderData } = data;
  const style = getActionStyle(action);

  // Generate HTML for email (includes action banner)
  const emailHTML = getPurchaseOrderInvoiceHTML(
    purchaseOrderData,
    action,
    false
  );

  return {
    subject: `Purchase Order ${purchaseOrderData.poId} - ${style.title}`,
    html: emailHTML,
  };
};

/**
 * Send Purchase Order Email using centralized SMTP configuration
 * Now includes PDF attachment with company logo
 */
async function sendPurchaseOrderEmail(purchaseOrderData, action = "sent") {
  try {
    const { supplierEmail } = purchaseOrderData;

    if (!supplierEmail) {
      console.warn(`⚠️ No supplier email for PO: ${purchaseOrderData.poId}`);
      return { success: false, message: "No supplier email provided" };
    }

    // Fetch company logo and settings
    let logoUrl = null;
    let companyName = "COMPANY";
    try {
      const webSettings = await prisma.webSettings.findFirst();
      const companySettings = await prisma.companySettings.findFirst();
      
      // Determine which logo key to use (priority: webSettings -> companySettings)
      const logoKey = webSettings?.logoUrl || companySettings?.logoUrl;
      
      if (logoKey) {
        let rawLogoUrl = getPresignedUrl(logoKey);
        
        // If it's a relative proxy URL, prepend BACKEND_URL and ensure /api prefix
        if (rawLogoUrl && rawLogoUrl.startsWith('/image/')) {
          logoUrl = `${process.env.BACKEND_URL}/api${rawLogoUrl}`;
        } else if (rawLogoUrl && !rawLogoUrl.startsWith('http')) {
          // If it's just a key or a path without leading slash
          logoUrl = `${process.env.BACKEND_URL}/api/image/${rawLogoUrl.startsWith('/') ? rawLogoUrl.slice(1) : rawLogoUrl}`;
        } else {
          logoUrl = rawLogoUrl;
        }

        // For emails, we'll embed the logo as a CID attachment to ensure it shows up 
        // even if the backend is on localhost or behind a firewall
        try {
          const s3Object = await getS3Object(logoKey);
          const chunks = [];
          for await (const chunk of s3Object.Body) {
            chunks.push(chunk);
          }
          const logoBuffer = Buffer.concat(chunks);
          const logoMimeType = s3Object.ContentType || "image/png";

          // We'll store this in the poData specifically for the email
          purchaseOrderData.logoCid = {
            content: logoBuffer,
            contentType: logoMimeType,
            cid: 'company-logo'
          };
        } catch (logoError) {
          console.error("Error fetching logo for CID attachment:", logoError);
        }
      }

      if (companySettings && companySettings.companyName) {
        companyName = companySettings.companyName;
      }
    } catch (error) {
      console.error("Error fetching settings:", error);
    }

    // Add settings to purchase order data
    const poDataWithLogo = { ...purchaseOrderData, logoUrl, companyName };

    // Get action styling
    const style = getActionStyle(action);

    // Generate HTML for email (uses CID if available, fallback to absolute URL)
    const emailData = { 
      ...poDataWithLogo, 
      logoUrl: purchaseOrderData.logoCid ? 'cid:company-logo' : logoUrl 
    };
    const emailHTML = getPurchaseOrderInvoiceHTML(emailData, action, false);

    // Generate PDF attachment
    let pdfBuffer = null;
    try {
      const pdfHTML = getPurchaseOrderInvoiceHTML(poDataWithLogo, action, true);
      
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      const page = await browser.newPage();
      await page.setContent(pdfHTML, { waitUntil: 'networkidle0' });
      
      pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '10mm',
          right: '10mm',
          bottom: '10mm',
          left: '10mm'
        }
      });
      
      await browser.close();
      console.log(`✅ PDF generated for PO ${purchaseOrderData.poId}`);
    } catch (pdfError) {
      console.error("❌ PDF generation error:", pdfError);
      // Continue without PDF if generation fails
    }

    // Get active email configuration from database
    const emailConfig = await prisma.emailConfiguration.findFirst({
      where: { isActive: true },
    });

    // Prepare email options
    const emailOptions = {
      to: supplierEmail,
      subject: `Purchase Order ${purchaseOrderData.poId} - ${style.title}`,
      html: emailHTML,
      attachments: []
    };

    // Add CID logo attachment if available
    if (purchaseOrderData.logoCid) {
      emailOptions.attachments.push({
        filename: 'logo.png',
        content: purchaseOrderData.logoCid.content,
        cid: purchaseOrderData.logoCid.cid,
        contentType: purchaseOrderData.logoCid.contentType
      });
    }

    // Add PDF attachment if generated
    if (pdfBuffer) {
      emailOptions.attachments.push({
        filename: `PO-${purchaseOrderData.poId}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      });
    }

    let result;

    if (emailConfig) {
      // Use database SMTP configuration
      console.log("📧 Using database SMTP configuration");
      result = await sendSMTPEmail(emailConfig, emailOptions);
    } else {
      // Fallback to environment variables
      console.log("📧 Using environment SMTP configuration");
      result = await sendEmailWithEnv(emailOptions);
    }

    if (result.success) {
      console.log(`✅ Purchase order email sent to ${supplierEmail} for PO ${purchaseOrderData.poId}`);
    } else {
      console.error(`❌ Failed to send purchase order email: ${result.message}`);
    }

    return result;
  } catch (error) {
    console.error("❌ Purchase order email sending error:", error);
    return { success: false, message: error.message };
  }
}

module.exports = {
  sendPurchaseOrderEmail,
  getPurchaseOrderInvoiceHTML,
  getPurchaseOrderInvoiceEmailTemplate,
};
