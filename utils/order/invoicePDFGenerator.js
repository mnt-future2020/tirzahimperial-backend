/**
 * Invoice PDF Generator for Online Orders
 * Generates PDF invoices matching the purchase-details design
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Generate invoice PDF for an online order matching purchase-details design
 * @param {Object} orderData - Complete order data with customer and items
 * @param {Object} companyData - Company information for the invoice
 * @returns {Promise<Buffer>} PDF buffer
 */
const generateInvoicePDF = async (orderData, companyData) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Get logo data and currency symbol
      const [logoData, currencySymbol] = await Promise.all([
        getLogoData(),
        getCurrencySymbol()
      ]);
      
      // Create a new PDF document with A4 size
      const doc = new PDFDocument({ 
        size: 'A4',
        margin: 40,
        bufferPages: true
      });

      // Collect PDF data in chunks
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Start generating the PDF content matching purchase-details design
      generatePurchaseStyleInvoice(doc, orderData, companyData, logoData, currencySymbol);

      // Finalize the PDF
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

/**
 * Generate invoice content matching purchase-details design
 * @param {PDFDocument} doc - PDF document instance
 * @param {Object} orderData - Order data
 * @param {Object} companyData - Company data
 * @param {String} logoData - Base64 logo data
 * @param {String} currencySymbol - Currency symbol (₹, $, €, etc.)
 */
const generatePurchaseStyleInvoice = (doc, orderData, companyData, logoData, currencySymbol) => {
  const pageWidth = doc.page.width - 80; // Account for margins
  const leftMargin = 40;

  // Gold accent border at top with luxury styling
  doc.rect(leftMargin, 40, pageWidth, 6)
     .fillAndStroke('#c49a3c', '#c49a3c');

  // Subtle shadow effect
  doc.rect(leftMargin, 46, pageWidth, 2)
     .fillAndStroke('#00000008', '#00000008');

  // Header Section with beige background
  generatePurchaseStyleHeader(doc, orderData, companyData, pageWidth, leftMargin, logoData);

  // Address Section
  generatePurchaseStyleAddresses(doc, orderData, companyData, pageWidth, leftMargin);

  // Items Table
  generatePurchaseStyleItemsTable(doc, orderData, pageWidth, leftMargin, currencySymbol);

  // Summary Section
  generatePurchaseStyleSummary(doc, orderData, pageWidth, leftMargin, currencySymbol);

  // Signature Section
  generatePurchaseStyleSignature(doc, orderData, pageWidth, leftMargin);

  // Footer with accent border
  generatePurchaseStyleFooter(doc, orderData, pageWidth, leftMargin);
};

/**
 * Generate header section with luxury cosmetics design
 */
const generatePurchaseStyleHeader = (doc, orderData, companyData, pageWidth, leftMargin, logoData) => {
  const headerY = 60;
  const headerHeight = 140;

  // Luxury cream background for header
  doc.rect(leftMargin, headerY, pageWidth, headerHeight)
     .fillAndStroke('#faf7f4', '#e8ddd0');

  // Gold accent decorative elements
  doc.rect(leftMargin + 20, headerY + 15, 30, 2)
     .fillAndStroke('#c49a3c', '#c49a3c');
  doc.rect(pageWidth - 50, headerY + headerHeight - 17, 30, 2)
     .fillAndStroke('#c49a3c', '#c49a3c');

  // Logo section (left side) with luxury styling
  const logoX = leftMargin + 30;
  const logoY = headerY + 30;
  
  if (logoData) {
    try {
      // Logo with subtle shadow effect
      doc.rect(logoX - 2, logoY - 2, 144, 74)
         .fillAndStroke('#00000010', '#00000010');
      doc.image(logoData, logoX, logoY, {
        width: 140,
        height: 70,
        fit: [140, 70],
        align: 'left',
        valign: 'center'
      });
    } catch (error) {
      console.error('Error embedding logo:', error);
      // Luxury fallback logo placeholder
      doc.rect(logoX, logoY, 140, 70)
         .fillAndStroke('#ffffff', '#c49a3c');
      doc.fontSize(18)
         .fillColor('#c49a3c')
         .text('LUXURY', logoX + 35, logoY + 20, { characterSpacing: 3 });
      doc.fontSize(12)
         .fillColor('#2d1f0e')
         .text('COSMETICS', logoX + 30, logoY + 40, { characterSpacing: 2 });
    }
  } else {
    // Luxury fallback logo placeholder
    doc.rect(logoX, logoY, 140, 70)
       .fillAndStroke('#ffffff', '#c49a3c');
    doc.fontSize(18)
       .fillColor('#c49a3c')
       .text('LUXURY', logoX + 35, logoY + 20, { characterSpacing: 3 });
    doc.fontSize(12)
       .fillColor('#2d1f0e')
       .text('COSMETICS', logoX + 30, logoY + 40, { characterSpacing: 2 });
  }

  // INVOICE title (right side) with luxury typography
  const titleX = pageWidth - 250;
  
  doc.fontSize(42)
     .fillColor('#2d1f0e')
     .text('TAX INVOICE', titleX, headerY + 15, { 
       width: 250, 
       align: 'right',
       characterSpacing: 6
     });

  // Luxury subtitle
  doc.fontSize(12)
     .fillColor('#c49a3c')
     .text('LUXURY BEAUTY COLLECTION', titleX, headerY + 55, { 
       width: 250, 
       align: 'right',
       characterSpacing: 2
     });

  // Order details table (right side) with luxury styling
  const detailsY = headerY + 75;
  const detailsWidth = 220;
  const detailsX = pageWidth - detailsWidth + leftMargin;
  
  // Details table with luxury borders
  const tableData = [
    ['Invoice Number', orderData.invoiceNumber || orderData.orderNumber],
    ['Invoice Date', formatDate(orderData.createdAt)],
    ['Order Number', orderData.orderNumber]
  ];

  let currentDetailY = detailsY;
  
  // Luxury table background
  doc.rect(detailsX, currentDetailY, detailsWidth, 54)
     .fillAndStroke('#ffffff', '#c49a3c');
  
  tableData.forEach((row, index) => {
    // Alternating luxury row backgrounds
    if (index % 2 === 0) {
      doc.rect(detailsX + 1, currentDetailY, detailsWidth - 2, 18)
         .fillAndStroke('#faf7f4', '#faf7f4');
    }
    
    // Label with luxury typography
    doc.fontSize(9)
       .fillColor('#6b5040')
       .text(row[0], detailsX + 12, currentDetailY + 6, { 
         width: 100,
         characterSpacing: 0.5
       });
    
    // Value with luxury styling
    doc.fontSize(9)
       .fillColor('#2d1f0e')
       .text(row[1], detailsX + 110, currentDetailY + 6, { 
         width: 100, 
         align: 'right',
         characterSpacing: 0.3
       });
    
    currentDetailY += 18;
  });

  doc.y = headerY + headerHeight + 20;
};

/**
 * Generate address section with luxury cosmetics design
 */
const generatePurchaseStyleAddresses = (doc, orderData, companyData, pageWidth, leftMargin) => {
  const startY = doc.y;
  const columnWidth = (pageWidth - 60) / 2;

  // BILL FROM (Left Column) with luxury styling
  doc.fontSize(11)
     .fillColor('#c49a3c')
     .text('BILL FROM', leftMargin, startY, { 
       characterSpacing: 2
     });

  // Decorative underline
  doc.rect(leftMargin, startY + 15, 60, 1)
     .fillAndStroke('#c49a3c', '#c49a3c');

  let currentY = startY + 25;
  
  // Company name with luxury typography
  doc.fontSize(18)
     .fillColor('#2d1f0e')
     .text(companyData.companyName || 'Luxury Cosmetics', leftMargin, currentY, {
       characterSpacing: 1
     });
  currentY += 25;

  // Company address with refined styling
  if (companyData.address) {
    doc.fontSize(11)
       .fillColor('#6b5040')
       .text(companyData.address || 'Street Address', leftMargin, currentY, { 
         width: columnWidth - 20,
         lineGap: 3
       });
    currentY += 18;
  }

  // City, State, ZIP with luxury formatting
  const cityStateZip = [
    companyData.city || 'City',
    companyData.state || 'State', 
    companyData.zipCode || 'ZIP Code'
  ].filter(Boolean).join(', ');
  
  doc.fontSize(11)
     .fillColor('#6b5040')
     .text(cityStateZip, leftMargin, currentY);
  currentY += 18;

  // Contact details with luxury styling
  if (companyData.phone) {
    doc.fontSize(10)
       .fillColor('#6b5040')
       .text(`Phone: ${companyData.phone}`, leftMargin, currentY);
    currentY += 16;
  }

  if (companyData.email) {
    doc.fontSize(10)
       .fillColor('#6b5040')
       .text(`Email: ${companyData.email}`, leftMargin, currentY);
    currentY += 16;
  }

  // SHIP TO (Right Column) with luxury styling
  const rightColumnX = leftMargin + columnWidth + 60;
  doc.fontSize(11)
     .fillColor('#c49a3c')
     .text('SHIP TO', rightColumnX, startY, { 
       characterSpacing: 2
     });

  // Decorative underline
  doc.rect(rightColumnX, startY + 15, 50, 1)
     .fillAndStroke('#c49a3c', '#c49a3c');

  let rightCurrentY = startY + 25;
  
  // Customer name with luxury typography
  doc.fontSize(18)
     .fillColor('#2d1f0e')
     .text(orderData.customerName || 'Valued Customer', rightColumnX, rightCurrentY, {
       characterSpacing: 0.5
     });
  rightCurrentY += 25;

  // Delivery address - handle both object and JSON string formats
  let deliveryAddress = orderData.deliveryAddress || {};
  
  // If deliveryAddress is a JSON string, parse it
  if (typeof deliveryAddress === 'string') {
    try {
      deliveryAddress = JSON.parse(deliveryAddress);
    } catch (error) {
      console.error('❌ Error parsing delivery address:', error);
      deliveryAddress = {};
    }
  }
  
  // Display recipient name if available
  if (deliveryAddress.name) {
    doc.fontSize(11)
       .fillColor('#6b5040')
       .text(deliveryAddress.name, rightColumnX, rightCurrentY);
    rightCurrentY += 18;
  }
  
  // Address Line 1 with luxury formatting
  if (deliveryAddress.addressLine1) {
    doc.fontSize(11)
       .fillColor('#6b5040')
       .text(deliveryAddress.addressLine1, rightColumnX, rightCurrentY, { 
         width: columnWidth - 20,
         lineGap: 3
       });
    rightCurrentY += 18;
  }

  // Address Line 2
  if (deliveryAddress.addressLine2) {
    doc.text(deliveryAddress.addressLine2, rightColumnX, rightCurrentY, {
      width: columnWidth - 20
    });
    rightCurrentY += 18;
  }

  // Landmark with subtle styling
  if (deliveryAddress.landmark) {
    doc.fontSize(10)
       .fillColor('#6b5040')
       .text(`Near: ${deliveryAddress.landmark}`, rightColumnX, rightCurrentY, {
         width: columnWidth - 20
       });
    rightCurrentY += 16;
  }

  // City, State, PIN with luxury formatting
  const customerCityState = [
    deliveryAddress.city,
    deliveryAddress.state,
    deliveryAddress.pincode
  ].filter(Boolean).join(', ');
  
  if (customerCityState) {
    doc.fontSize(11)
       .fillColor('#6b5040')
       .text(customerCityState, rightColumnX, rightCurrentY);
    rightCurrentY += 18;
  }

  // Country
  if (deliveryAddress.country) {
    doc.text(deliveryAddress.country, rightColumnX, rightCurrentY);
    rightCurrentY += 18;
  }

  // Phone with luxury styling
  const phoneNumber = deliveryAddress.phone || orderData.customerPhone;
  if (phoneNumber) {
    doc.fontSize(10)
       .fillColor('#6b5040')
       .text(`Phone: ${phoneNumber}`, rightColumnX, rightCurrentY);
    rightCurrentY += 16;
  }

  // Email
  if (orderData.customerEmail) {
    doc.fontSize(10)
       .fillColor('#6b5040')
       .text(`Email: ${orderData.customerEmail}`, rightColumnX, rightCurrentY);
    rightCurrentY += 16;
  }

  // Set Y position to the maximum of both columns
  doc.y = Math.max(currentY, rightCurrentY) + 35;
};

/**
 * Generate items table with luxury cosmetics design
 */
const generatePurchaseStyleItemsTable = (doc, orderData, pageWidth, leftMargin, currencySymbol) => {
  const startY = doc.y;
  const tableWidth = pageWidth;
  
  // Table headers with luxury styling
  const headers = ['#', 'ITEM DESCRIPTION', 'HSN', 'QTY', 'RATE', 'GST', 'AMOUNT'];
  const columnWidths = [40, 220, 60, 60, 80, 60, 80];
  
  let currentX = leftMargin;
  const columnPositions = [];
  columnWidths.forEach(width => {
    columnPositions.push(currentX);
    currentX += width;
  });

  // Luxury header row with gold accent
  doc.rect(leftMargin, startY, tableWidth, 28)
     .fillAndStroke('#2d1f0e', '#c49a3c');

  // Gold accent line on top of header
  doc.rect(leftMargin, startY, tableWidth, 2)
     .fillAndStroke('#c49a3c', '#c49a3c');

  // Header text with luxury typography
  doc.fontSize(10)
     .fillColor('#faf7f4');
  
  headers.forEach((header, index) => {
    const xPos = columnPositions[index];
    const width = columnWidths[index];
    let align = 'left';
    
    if (index === 0 || index === 2 || index === 3 || index === 5) align = 'center'; // #, HSN, QTY, GST
    if (index === 4 || index === 6) align = 'right'; // RATE, AMOUNT
    
    doc.text(header, xPos + 8, startY + 9, { 
      width: width - 16, 
      align: align,
      characterSpacing: 1
    });
  });

  let currentY = startY + 32;

  // Items with luxury styling
  orderData.items.forEach((item, index) => {
    const rowHeight = 32;
    
    // Luxury alternating row backgrounds
    if (index % 2 === 1) {
      doc.rect(leftMargin, currentY - 2, tableWidth, rowHeight)
         .fillAndStroke('#faf7f4', '#faf7f4');
    }

    // Row data with refined typography
    doc.fontSize(10)
       .fillColor('#2d1f0e');

    // Index with luxury styling
    doc.text((index + 1).toString(), columnPositions[0] + 8, currentY + 10, { 
      width: columnWidths[0] - 16, 
      align: 'center' 
    });

    // Product name with luxury formatting
    let productName = item.productName || item.variantName || 'Product';
    
    // Append Variant Name / UOM if available
    const variantDetails = [];
    if (item.variantName && item.variantName !== item.productName) {
      variantDetails.push(item.variantName);
    }
    if (item.variantUom && item.variantUomValue) {
      variantDetails.push(`${item.variantUomValue}${item.variantUom}`);
    }
    
    if (variantDetails.length > 0) {
      productName += ` (${variantDetails.join(' - ')})`;
    }

    doc.fontSize(10)
       .fillColor('#2d1f0e')
       .text(productName, columnPositions[1] + 8, currentY + 6, { 
         width: columnWidths[1] - 16,
         ellipsis: true,
         lineGap: 2
       });
    
    // HSN Code with luxury styling
    doc.fontSize(10)
       .fillColor('#6b5040')
       .text(item.hsnCode || '-', columnPositions[2] + 8, currentY + 10, { 
         width: columnWidths[2] - 16, 
         align: 'center' 
       });

    // Quantity with refined display
    let quantityDisplay = item.quantity.toString();

    doc.fontSize(10)
       .fillColor('#2d1f0e')
       .text(quantityDisplay, columnPositions[3] + 8, currentY + 10, { 
         width: columnWidths[3] - 16, 
         align: 'center' 
       });

    // Rate with luxury currency formatting
    const unitPrice = item.unitPrice || item.variantSellingPrice || 0;
    doc.fontSize(10)
       .fillColor('#2d1f0e')
       .text(`${currencySymbol}${unitPrice.toFixed(2)}`, columnPositions[4] + 8, currentY + 10, { 
         width: columnWidths[4] - 16, 
         align: 'right' 
       });

    // GST with accent color
    const gstPercentage = item.gstPercentage || 0;
    doc.fontSize(10)
       .fillColor('#c49a3c')
       .text(`${Math.round(gstPercentage)}%`, columnPositions[5] + 8, currentY + 10, { 
         width: columnWidths[5] - 16, 
         align: 'center' 
       });

    // Amount with luxury formatting
    const totalAmount = item.total || (item.quantity * unitPrice);
    doc.fontSize(11)
       .fillColor('#2d1f0e')
       .text(`${currencySymbol}${totalAmount.toFixed(2)}`, columnPositions[6] + 8, currentY + 10, { 
         width: columnWidths[6] - 16, 
         align: 'right' 
       });

    currentY += rowHeight;
  });

  // Luxury table border
  doc.rect(leftMargin, startY, tableWidth, currentY - startY)
     .stroke('#c49a3c');

  // Column separators with gold accent
  columnPositions.slice(1).forEach((x) => {
    doc.moveTo(x, startY)
       .lineTo(x, currentY)
       .strokeColor('#e8ddd0')
       .stroke();
  });

  doc.y = currentY + 25;
};

/**
 * Generate summary section with luxury cosmetics design
 */
const generatePurchaseStyleSummary = (doc, orderData, pageWidth, leftMargin, currencySymbol) => {
  const startY = doc.y;
  const summaryX = pageWidth - 200;
  const summaryWidth = 200;

  // Luxury summary card background
  doc.rect(summaryX - 10, startY - 10, summaryWidth + 20, 200)
     .fillAndStroke('#faf7f4', '#e8ddd0');

  // Gold accent border
  doc.rect(summaryX - 10, startY - 10, summaryWidth + 20, 3)
     .fillAndStroke('#c49a3c', '#c49a3c');

  const summaryItems = [
    ['Subtotal', `${currencySymbol}${(orderData.subtotal || 0).toFixed(2)}`]
  ];

  // Determine if this is an inter-state transaction (IGST)
  const isInterState = orderData.gstType === 'igst' || (orderData.igstAmount || 0) > 0;

  // Add GST breakdown with luxury styling
  if (isInterState) {
    // Inter-state transaction - show IGST
    const igstAmount = orderData.igstAmount || orderData.totalGstAmount || orderData.tax || 0;
    if (igstAmount > 0) {
      summaryItems.push(['IGST', `${currencySymbol}${igstAmount.toFixed(2)}`]);
    }
  } else {
    // Intra-state transaction - show CGST + SGST
    const cgstAmount = orderData.cgstAmount || 0;
    const sgstAmount = orderData.sgstAmount || 0;
    
    if (cgstAmount > 0 || sgstAmount > 0) {
      if (cgstAmount > 0) {
        summaryItems.push(['CGST', `${currencySymbol}${cgstAmount.toFixed(2)}`]);
      }
      if (sgstAmount > 0) {
        summaryItems.push(['SGST', `${currencySymbol}${sgstAmount.toFixed(2)}`]);
      }
    } else if ((orderData.totalGstAmount || orderData.tax || 0) > 0) {
      // Fallback: split tax equally between CGST and SGST if no breakdown available
      const totalTax = orderData.totalGstAmount || orderData.tax || 0;
      const halfTax = totalTax / 2;
      if (halfTax > 0) {
        summaryItems.push(['CGST', `${currencySymbol}${halfTax.toFixed(2)}`]);
        summaryItems.push(['SGST', `${currencySymbol}${halfTax.toFixed(2)}`]);
      }
    }
  }

  // Add discount if present
  if ((orderData.discount || 0) > 0) {
    summaryItems.push(['Discount', `-${currencySymbol}${(orderData.discount || 0).toFixed(2)}`]);
  }

  if ((orderData.couponDiscount || 0) > 0) {
    summaryItems.push(['Coupon Discount', `-${currencySymbol}${(orderData.couponDiscount || 0).toFixed(2)}`]);
  }

  // Add shipping if present
  if ((orderData.shippingCharge || 0) > 0) {
    summaryItems.push(['Shipping', `${currencySymbol}${(orderData.shippingCharge || 0).toFixed(2)}`]);
  }

  // Summary items with luxury typography
  summaryItems.forEach((item, index) => {
    const yPos = startY + (index * 22);
    
    doc.fontSize(11)
       .fillColor('#6b5040')
       .text(item[0], summaryX, yPos, { 
         width: 120, 
         align: 'left',
         characterSpacing: 0.3
       });
    
    const isDiscount = item[0].toLowerCase().includes('discount');
    doc.fontSize(11)
       .fillColor(isDiscount ? '#dc3545' : '#2d1f0e')
       .text(item[1], summaryX + 130, yPos, { 
         width: 70, 
         align: 'right',
         characterSpacing: 0.2
       });
  });

  // Luxury total row with gold accent
  const totalY = startY + (summaryItems.length * 22) + 15;
  
  // Gold accent line above total
  doc.rect(summaryX, totalY - 8, summaryWidth, 2)
     .fillAndStroke('#c49a3c', '#c49a3c');

  // Total background
  doc.rect(summaryX - 5, totalY - 5, summaryWidth + 10, 35)
     .fillAndStroke('#2d1f0e', '#c49a3c');

  doc.fontSize(16)
     .fillColor('#c49a3c')
     .text('TOTAL', summaryX + 5, totalY + 5, { 
       width: 120, 
       align: 'left',
       characterSpacing: 2
     });
  
  doc.fontSize(18)
     .fillColor('#c49a3c')
     .text(`${currencySymbol}${(orderData.total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 
           summaryX + 130, totalY + 3, { 
             width: 70, 
             align: 'right',
             characterSpacing: 1
           });

  doc.y = totalY + 60;
};

/**
 * Generate signature section with luxury cosmetics design
 */
const generatePurchaseStyleSignature = (doc, orderData, pageWidth, leftMargin) => {
  const startY = doc.y;
  
  // Luxury signature section background
  doc.rect(leftMargin, startY, 280, 80)
     .fillAndStroke('#faf7f4', '#e8ddd0');

  // Gold accent line
  doc.rect(leftMargin, startY, 280, 2)
     .fillAndStroke('#c49a3c', '#c49a3c');
  
  // Signature line with luxury styling
  doc.moveTo(leftMargin + 20, startY + 50)
     .lineTo(leftMargin + 260, startY + 50)
     .lineWidth(1)
     .strokeColor('#c49a3c')
     .stroke();

  // Signature text with luxury typography
  doc.fontSize(14)
     .fillColor('#2d1f0e')
     .text('Authorized Signatory', leftMargin + 20, startY + 60, {
       characterSpacing: 1
     });
  
  doc.fontSize(11)
     .fillColor('#6b5040')
     .text('Beauty Consultant', leftMargin + 20, startY + 78, {
       characterSpacing: 0.5
     });

  doc.y = startY + 100;
};

/**
 * Generate footer section with luxury cosmetics design
 */
const generatePurchaseStyleFooter = (doc, orderData, pageWidth, leftMargin) => {
  const startY = doc.y;
  
  // Gold accent border with gradient effect
  doc.rect(leftMargin, startY, pageWidth, 4)
     .fillAndStroke('#c49a3c', '#c49a3c');

  // Subtle gradient effect
  doc.rect(leftMargin, startY + 4, pageWidth, 2)
     .fillAndStroke('#d4af47', '#d4af47');

  // Footer text with luxury typography
  doc.fontSize(11)
     .fillColor('#6b5040')
     .text(`TAX INVOICE • Invoice Number: ${orderData.invoiceNumber || orderData.orderNumber}`, 
           leftMargin, startY + 18, { 
             width: pageWidth, 
             align: 'center',
             characterSpacing: 1.5
           });

  // Luxury tagline
  doc.fontSize(9)
     .fillColor('#c49a3c')
     .text('TIRZAH IMPERIALS', 
           leftMargin, startY + 35, { 
             width: pageWidth, 
             align: 'center',
             characterSpacing: 2
           });
};

/**
 * Format date for display
 */
const formatDate = (date) => {
  if (!date) return new Date().toLocaleDateString('en-IN');
  return new Date(date).toLocaleDateString('en-IN');
};

/**
 * Format time for display
 */
const formatTime = (date) => {
  if (!date) return new Date().toLocaleTimeString('en-IN');
  return new Date(date).toLocaleTimeString('en-IN');
};

/**
 * Get currency symbol from admin settings
 */
const getCurrencySymbol = async () => {
  try {
    const axios = require('axios');
    const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:5001';
    
    const response = await axios.get(`${authServiceUrl}/api/auth/currency`);
    
    if (response.data.success && response.data.data?.currency) {
      const currency = response.data.data.currency;
      
      // Get currency symbol using Intl.NumberFormat
      const symbol = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency,
      })
        .formatToParts(0)
        .find(part => part.type === 'currency')?.value || '₹';
      
      return symbol;
    }
  } catch (error) {
    console.error('Error fetching currency symbol:', error);
  }
  
  // Fallback to INR symbol
  return '₹';
};

/**
 * Get company data from Admin profile
 */
const getCompanyData = async () => {
  try {
    const { prisma } = require('../../config/database');
    
    // Get admin data (first active admin)
    const admin = await prisma.admin.findFirst({
      where: {
        isActive: true,
      },
      select: {
        companyName: true,
        address: true,
        city: true,
        state: true,
        zipCode: true,
        country: true,
        phoneNumber: true,
        email: true,
        gstNumber: true,
      }
    });
    
    if (admin) {
      console.log('📄 Using admin data for invoice:', {
        companyName: admin.companyName,
        state: admin.state,
        city: admin.city
      });
      
      return {
        companyName: admin.companyName || 'Company Name',
        address: admin.address || 'Address',
        city: admin.city || 'City',
        state: admin.state || 'State',
        zipCode: admin.zipCode || 'ZIP Code',
        country: admin.country || 'India',
        phone: admin.phoneNumber || 'Phone',
        email: admin.email || 'email@company.com',
        gstNumber: admin.gstNumber || '',
        website: ''
      };
    }
  } catch (error) {
    console.error('Error fetching admin data from database:', error);
  }

  // Fallback to environment variables or defaults
  return {
    companyName: process.env.COMPANY_NAME || 'Ecommerce Surface',
    address: process.env.COMPANY_ADDRESS || 'Street Address',
    city: process.env.COMPANY_CITY || 'City',
    state: process.env.COMPANY_STATE || 'State',
    zipCode: process.env.COMPANY_ZIP || 'ZIP Code',
    country: process.env.COMPANY_COUNTRY || 'India',
    phone: process.env.COMPANY_PHONE || '+91 1234567890',
    email: process.env.COMPANY_EMAIL || 'contact@company.com',
    website: process.env.COMPANY_WEBSITE || 'www.company.com',
    gstNumber: ''
  };
};

/**
 * Get logo data from web settings
 */
const getLogoData = async () => {
  try {
    const { prisma } = require('../../config/database');
    const { getPresignedUrl } = require('../web/uploadsS3');
    
    const webSettings = await prisma.webSettings.findFirst();
    
    console.log('📄 Web settings found:', webSettings ? 'Yes' : 'No');
    
    if (webSettings) {
      let logoUrl = null;
      
      // Try logoUrl first (direct URL)
      if (webSettings.logoUrl) {
        console.log('📄 Using logoUrl from web settings');
        logoUrl = webSettings.logoUrl;
      }
      // Try logoKey (S3 key) if logoUrl not available
      else if (webSettings.logoKey) {
        console.log('📄 Using logoKey from web settings, generating proxy URL');
        logoUrl = getPresignedUrl(webSettings.logoKey, 3600);
      }
      
      console.log('📄 Final logo URL:', logoUrl ? 'Generated' : 'Not available');
      
      if (logoUrl) {
        // Convert URL to base64 for PDF embedding
        const logoBase64 = await urlToBase64(logoUrl);
        console.log('📄 Logo converted to base64:', logoBase64 ? 'Yes' : 'No');
        return logoBase64;
      }
    } else {
      console.log('📄 No web settings found in database');
    }
  } catch (error) {
    console.error('📄 Error fetching logo from web settings:', error);
  }
  
  return null;
};

/**
 * Convert URL to base64
 */
const urlToBase64 = async (url) => {
  try {
    const axios = require('axios');
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const base64 = Buffer.from(response.data, 'binary').toString('base64');
    const mimeType = response.headers['content-type'] || 'image/png';
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error('Error converting URL to base64:', error);
    return null;
  }
};

module.exports = {
  generateInvoicePDF,
  getCompanyData,
  getLogoData,
  getCurrencySymbol
};
