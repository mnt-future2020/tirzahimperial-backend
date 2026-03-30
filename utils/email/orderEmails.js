const { sendEmail: sendSMTPEmail, sendEmailWithEnv } = require("../../config/connectSMTP");
const { prisma } = require("../../config/database");

/**
 * Send email using centralized SMTP configuration
 */
async function sendOrderEmail(emailData) {
  try {
    // Get active email configuration from database
    const emailConfig = await prisma.emailConfiguration.findFirst({
      where: { isActive: true }
    });

    let result;
    
    if (emailConfig) {
      // Use database SMTP configuration
      result = await sendSMTPEmail(emailConfig, emailData);
    } else {
      // Fallback to environment variables
      result = await sendEmailWithEnv(emailData);
    }

    if (!result.success) {
      throw new Error(result.message || 'Failed to send email');
    }
    
    return result;
  } catch (error) {
    console.error("❌ Order email sending error:", error);
    throw error;
  }
}

/**
 * Send order status update email to customer
 */
async function sendOrderStatusEmail(customerEmail, orderData) {
  const { orderNumber, customerName, status, partnerName, partnerPhone } = orderData;
  
  const statusMessages = {
    confirmed: {
      subject: `Order ${orderNumber} Confirmed`,
      heading: 'Order Confirmed',
      message: 'Your order has been confirmed and will be processed soon.',
      color: '#3b82f6',
    },
    packing: {
      subject: `Order ${orderNumber} Being Prepared`,
      heading: 'Order Being Prepared',
      message: 'Your order is being packed and will be shipped soon.',
      color: '#f59e0b',
    },
    shipped: {
      subject: `Order ${orderNumber} Out for Delivery`,
      heading: 'Order Shipped',
      message: `Your order is on the way! ${partnerName ? `Delivered by ${partnerName}` : ''}`,
      color: '#8b5cf6',
    },
    delivered: {
      subject: `Order ${orderNumber} Delivered`,
      heading: 'Order Delivered',
      message: 'Your order has been delivered successfully. Thank you for shopping with us!',
      color: '#10b981',
    },
    cancelled: {
      subject: `Order ${orderNumber} Cancelled`,
      heading: 'Order Cancelled',
      message: 'Your order has been cancelled. Please contact support for more details.',
      color: '#ef4444',
    },
  };

  const statusInfo = statusMessages[status] || statusMessages.confirmed;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${statusInfo.subject}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Inter:wght@300;400;500&display=swap');
      </style>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Inter', Arial, sans-serif; background: linear-gradient(135deg, #faf7f4 0%, #f5f1eb 100%); min-height: 100vh;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        
        <!-- Luxury Header -->
        <div style="background: linear-gradient(135deg, #2d1f0e 0%, #1a1209 100%); position: relative; overflow: hidden;">
          <!-- Gold accent border -->
          <div style="height: 4px; background: linear-gradient(90deg, #c49a3c 0%, #d4af47 50%, #c49a3c 100%);"></div>
          
          <!-- Status-specific accent -->
          <div style="height: 2px; background: ${statusInfo.color}; opacity: 0.8;"></div>
          
          <!-- Header Content -->
          <div style="padding: 40px; text-align: center; position: relative;">
            <!-- Decorative elements -->
            <div style="position: absolute; top: 15px; left: 15px; width: 40px; height: 40px; border: 1px solid #c49a3c; opacity: 0.3; transform: rotate(45deg);"></div>
            <div style="position: absolute; bottom: 15px; right: 15px; width: 30px; height: 30px; border: 1px solid #c49a3c; opacity: 0.2; transform: rotate(45deg);"></div>
            
            <div style="display: inline-block; background: rgba(196, 154, 60, 0.15); padding: 15px; margin-bottom: 20px; border: 1px solid rgba(196, 154, 60, 0.3);">
              <div style="color: ${statusInfo.color}; font-size: 32px; margin-bottom: 5px;">
                ${status === 'confirmed' ? '✓' : status === 'packing' ? '📦' : status === 'shipped' ? '🚚' : status === 'delivered' ? '🎉' : '⚠️'}
              </div>
            </div>
            
            <h1 style="font-family: 'Playfair Display', serif; color: #c49a3c; margin: 0 0 10px 0; font-size: 28px; font-weight: 700; letter-spacing: 1.5px; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">
              ${statusInfo.heading.toUpperCase()}
            </h1>
            <p style="color: #faf7f4; font-size: 16px; font-weight: 300; letter-spacing: 0.8px; margin: 0; opacity: 0.9;">
              Order ${orderNumber}
            </p>
          </div>
        </div>

        <!-- Main Content -->
        <div style="background: #faf7f4; padding: 40px; border-left: 4px solid #c49a3c; border-right: 4px solid #c49a3c;">
          
          <!-- Greeting -->
          <div style="text-align: center; margin-bottom: 35px;">
            <div style="width: 60px; height: 2px; background: #c49a3c; margin: 0 auto 25px auto;"></div>
            <p style="color: #2d1f0e; font-size: 18px; font-weight: 400; letter-spacing: 0.5px; margin: 0 0 20px 0;">
              Dear <span style="color: #c49a3c; font-weight: 500;">${customerName}</span>,
            </p>
            <p style="color: #6b5040; font-size: 16px; font-weight: 300; letter-spacing: 0.3px; margin: 0; line-height: 1.7;">
              ${statusInfo.message}
            </p>
          </div>

          <!-- Order Details Card -->
          <div style="background: rgba(255, 255, 255, 0.8); border: 2px solid rgba(196, 154, 60, 0.2); padding: 30px; margin: 30px 0; position: relative;">
            <!-- Decorative corner -->
            <div style="position: absolute; top: -1px; left: -1px; width: 20px; height: 20px; background: #c49a3c;"></div>
            <div style="position: absolute; bottom: -1px; right: -1px; width: 20px; height: 20px; background: #c49a3c;"></div>
            
            <h3 style="font-family: 'Playfair Display', serif; color: #2d1f0e; font-size: 20px; font-weight: 600; margin: 0 0 25px 0; letter-spacing: 1px; text-align: center;">
              Order Details
            </h3>
            
            <div style="display: table; width: 100%;">
              <div style="display: table-row;">
                <div style="display: table-cell; padding: 12px 0; font-size: 14px; color: #6b5040; font-weight: 300; letter-spacing: 0.5px; width: 40%;">Order Number:</div>
                <div style="display: table-cell; padding: 12px 0; font-size: 14px; color: #2d1f0e; font-weight: 500; text-align: right; letter-spacing: 0.5px;">${orderNumber}</div>
              </div>
              <div style="display: table-row;">
                <div style="display: table-cell; padding: 12px 0; font-size: 14px; color: #6b5040; font-weight: 300; letter-spacing: 0.5px; border-top: 1px solid rgba(196, 154, 60, 0.2);">Status:</div>
                <div style="display: table-cell; padding: 12px 0; font-size: 14px; font-weight: 500; text-align: right; letter-spacing: 0.5px; text-transform: capitalize; border-top: 1px solid rgba(196, 154, 60, 0.2);">
                  <span style="color: ${statusInfo.color}; background: rgba(${statusInfo.color.replace('#', '').match(/.{2}/g).map(hex => parseInt(hex, 16)).join(', ')}, 0.1); padding: 4px 12px; border: 1px solid ${statusInfo.color}; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">
                    ${status}
                  </span>
                </div>
              </div>
              ${partnerName ? `
              <div style="display: table-row;">
                <div style="display: table-cell; padding: 12px 0; font-size: 14px; color: #6b5040; font-weight: 300; letter-spacing: 0.5px; border-top: 1px solid rgba(196, 154, 60, 0.2);">Delivery Partner:</div>
                <div style="display: table-cell; padding: 12px 0; font-size: 14px; color: #2d1f0e; font-weight: 400; text-align: right; letter-spacing: 0.3px; border-top: 1px solid rgba(196, 154, 60, 0.2);">${partnerName}</div>
              </div>
              ` : ''}
              ${partnerPhone ? `
              <div style="display: table-row;">
                <div style="display: table-cell; padding: 12px 0; font-size: 14px; color: #6b5040; font-weight: 300; letter-spacing: 0.5px; border-top: 1px solid rgba(196, 154, 60, 0.2);">Contact:</div>
                <div style="display: table-cell; padding: 12px 0; font-size: 14px; color: #2d1f0e; font-weight: 400; text-align: right; letter-spacing: 0.3px; border-top: 1px solid rgba(196, 154, 60, 0.2);">${partnerPhone}</div>
              </div>
              ` : ''}
            </div>
          </div>
          
          ${status === 'delivered' ? `
          <!-- Thank You Message for Delivered Orders -->
          <div style="text-align: center; margin: 40px 0; padding: 25px; background: rgba(196, 154, 60, 0.05); border: 1px solid rgba(196, 154, 60, 0.2);">
            <div style="color: #c49a3c; font-size: 24px; margin-bottom: 15px;">✨</div>
            <p style="color: #2d1f0e; font-size: 16px; font-weight: 400; margin: 0 0 10px 0; letter-spacing: 0.5px;">
              Thank you for choosing luxury
            </p>
            <p style="color: #6b5040; font-size: 14px; font-weight: 300; margin: 0; letter-spacing: 0.3px; line-height: 1.6;">
              We hope you love your new beauty essentials. Your satisfaction is our priority.
            </p>
          </div>
          ` : ''}

          <!-- Closing -->
          <div style="text-align: center; margin-top: 40px;">
            <div style="width: 60px; height: 2px; background: #c49a3c; margin: 0 auto 25px auto;"></div>
            <p style="color: #6b5040; font-size: 15px; font-weight: 300; letter-spacing: 0.3px; margin: 0 0 15px 0; line-height: 1.6;">
              Experience luxury. Experience beauty.
            </p>
            <p style="color: #2d1f0e; font-size: 16px; font-weight: 400; margin: 0; letter-spacing: 0.5px;">
              With elegance,<br>
              <span style="color: #c49a3c; font-weight: 500;">Your Beauty Team</span>
            </p>
          </div>
        </div>

        <!-- Footer -->
        <div style="background: #2d1f0e; padding: 25px 40px; text-align: center;">
          <div style="height: 2px; background: linear-gradient(90deg, transparent 0%, #c49a3c 50%, transparent 100%); margin-bottom: 15px;"></div>
          <p style="color: #6b5040; font-size: 12px; font-weight: 300; margin: 0; letter-spacing: 0.5px; opacity: 0.8;">
            This is an automated email. Please do not reply to this message.
          </p>
          
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendOrderEmail({
    to: customerEmail,
    subject: statusInfo.subject,
    html: html,
  });
}

/**
 * Send courier tracking email to customer
 */
async function sendCourierTrackingEmail(trackingData) {
  const { 
    customerEmail, 
    customerName, 
    orderNumber, 
    courierPartner, 
    trackingNumber, 
    trackingLink, 
    estimatedDelivery, 
    notes 
  } = trackingData;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Order ${orderNumber} - Tracking Information</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Inter:wght@300;400;500&display=swap');
      </style>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Inter', Arial, sans-serif; background: linear-gradient(135deg, #faf7f4 0%, #f5f1eb 100%); min-height: 100vh;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        
        <!-- Luxury Header -->
        <div style="background: linear-gradient(135deg, #2d1f0e 0%, #1a1209 100%); position: relative; overflow: hidden;">
          <!-- Gold accent border -->
          <div style="height: 4px; background: linear-gradient(90deg, #c49a3c 0%, #d4af47 50%, #c49a3c 100%);"></div>
          
          <!-- Shipping accent -->
          <div style="height: 2px; background: #8b5cf6; opacity: 0.8;"></div>
          
          <!-- Header Content -->
          <div style="padding: 40px; text-align: center; position: relative;">
            <!-- Decorative elements -->
            <div style="position: absolute; top: 15px; left: 15px; width: 40px; height: 40px; border: 1px solid #c49a3c; opacity: 0.3; transform: rotate(45deg);"></div>
            <div style="position: absolute; bottom: 15px; right: 15px; width: 30px; height: 30px; border: 1px solid #c49a3c; opacity: 0.2; transform: rotate(45deg);"></div>
            
            <div style="display: inline-block; background: rgba(196, 154, 60, 0.15); padding: 15px; margin-bottom: 20px; border: 1px solid rgba(196, 154, 60, 0.3);">
              <div style="color: #8b5cf6; font-size: 32px; margin-bottom: 5px;">🚚</div>
            </div>
            
            <h1 style="font-family: 'Playfair Display', serif; color: #c49a3c; margin: 0 0 10px 0; font-size: 28px; font-weight: 700; letter-spacing: 1.5px; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">
              YOUR ORDER IS ON THE WAY
            </h1>
            <p style="color: #faf7f4; font-size: 16px; font-weight: 300; letter-spacing: 0.8px; margin: 0; opacity: 0.9;">
              Order ${orderNumber}
            </p>
          </div>
        </div>

        <!-- Main Content -->
        <div style="background: #faf7f4; padding: 40px; border-left: 4px solid #c49a3c; border-right: 4px solid #c49a3c;">
          
          <!-- Greeting -->
          <div style="text-align: center; margin-bottom: 35px;">
            <div style="width: 60px; height: 2px; background: #c49a3c; margin: 0 auto 25px auto;"></div>
            <p style="color: #2d1f0e; font-size: 18px; font-weight: 400; letter-spacing: 0.5px; margin: 0 0 20px 0;">
              Dear <span style="color: #c49a3c; font-weight: 500;">${customerName}</span>,
            </p>
            <p style="color: #6b5040; font-size: 16px; font-weight: 300; letter-spacing: 0.3px; margin: 0; line-height: 1.7;">
              Great news! Your order has been shipped and is on its way to you. Here are your tracking details:
            </p>
          </div>

          <!-- Tracking Details Card -->
          <div style="background: rgba(255, 255, 255, 0.8); border: 2px solid rgba(196, 154, 60, 0.2); padding: 30px; margin: 30px 0; position: relative;">
            <!-- Decorative corner -->
            <div style="position: absolute; top: -1px; left: -1px; width: 20px; height: 20px; background: #c49a3c;"></div>
            <div style="position: absolute; bottom: -1px; right: -1px; width: 20px; height: 20px; background: #c49a3c;"></div>
            
            <h3 style="font-family: 'Playfair Display', serif; color: #2d1f0e; font-size: 20px; font-weight: 600; margin: 0 0 25px 0; letter-spacing: 1px; text-align: center;">
              Tracking Information
            </h3>
            
            <div style="display: table; width: 100%;">
              <div style="display: table-row;">
                <div style="display: table-cell; padding: 12px 0; font-size: 14px; color: #6b5040; font-weight: 300; letter-spacing: 0.5px; width: 40%;">Order Number:</div>
                <div style="display: table-cell; padding: 12px 0; font-size: 14px; color: #2d1f0e; font-weight: 500; text-align: right; letter-spacing: 0.5px;">${orderNumber}</div>
              </div>
              <div style="display: table-row;">
                <div style="display: table-cell; padding: 12px 0; font-size: 14px; color: #6b5040; font-weight: 300; letter-spacing: 0.5px; border-top: 1px solid rgba(196, 154, 60, 0.2);">Courier Partner:</div>
                <div style="display: table-cell; padding: 12px 0; font-size: 14px; color: #2d1f0e; font-weight: 500; text-align: right; letter-spacing: 0.5px; border-top: 1px solid rgba(196, 154, 60, 0.2);">${courierPartner}</div>
              </div>
              <div style="display: table-row;">
                <div style="display: table-cell; padding: 12px 0; font-size: 14px; color: #6b5040; font-weight: 300; letter-spacing: 0.5px; border-top: 1px solid rgba(196, 154, 60, 0.2);">Tracking Number:</div>
                <div style="display: table-cell; padding: 12px 0; font-size: 14px; color: #2d1f0e; font-weight: 500; text-align: right; letter-spacing: 0.5px; border-top: 1px solid rgba(196, 154, 60, 0.2); font-family: monospace;">${trackingNumber}</div>
              </div>
              ${estimatedDelivery ? `
              <div style="display: table-row;">
                <div style="display: table-cell; padding: 12px 0; font-size: 14px; color: #6b5040; font-weight: 300; letter-spacing: 0.5px; border-top: 1px solid rgba(196, 154, 60, 0.2);">Estimated Delivery:</div>
                <div style="display: table-cell; padding: 12px 0; font-size: 14px; color: #2d1f0e; font-weight: 500; text-align: right; letter-spacing: 0.5px; border-top: 1px solid rgba(196, 154, 60, 0.2);">${new Date(estimatedDelivery).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
              </div>
              ` : ''}
            </div>
          </div>

          <!-- Track Your Order Button -->
          <div style="text-align: center; margin: 40px 0;">
            <a href="${trackingLink}" 
               style="display: inline-block; background: linear-gradient(135deg, #c49a3c 0%, #d4af47 100%); color: #2d1f0e; text-decoration: none; padding: 15px 40px; font-size: 16px; font-weight: 500; letter-spacing: 1px; text-transform: uppercase; border: 2px solid #c49a3c; transition: all 0.3s ease; box-shadow: 0 4px 15px rgba(196, 154, 60, 0.3);"
               onmouseover="this.style.background='#2d1f0e'; this.style.color='#c49a3c';"
               onmouseout="this.style.background='linear-gradient(135deg, #c49a3c 0%, #d4af47 100%)'; this.style.color='#2d1f0e';">
              🔍 Track Your Order
            </a>
          </div>

          ${notes ? `
          <!-- Additional Notes -->
          <div style="background: rgba(196, 154, 60, 0.05); border: 1px solid rgba(196, 154, 60, 0.2); padding: 25px; margin: 30px 0;">
            <h4 style="color: #2d1f0e; font-size: 16px; font-weight: 500; margin: 0 0 15px 0; letter-spacing: 0.5px;">Additional Information:</h4>
            <p style="color: #6b5040; font-size: 14px; font-weight: 300; margin: 0; letter-spacing: 0.3px; line-height: 1.6;">
              ${notes}
            </p>
          </div>
          ` : ''}

          <!-- Delivery Tips -->
          <div style="background: rgba(139, 92, 246, 0.05); border: 1px solid rgba(139, 92, 246, 0.2); padding: 25px; margin: 30px 0;">
            <h4 style="color: #2d1f0e; font-size: 16px; font-weight: 500; margin: 0 0 15px 0; letter-spacing: 0.5px;">📋 Delivery Tips:</h4>
            <ul style="color: #6b5040; font-size: 14px; font-weight: 300; margin: 0; padding-left: 20px; letter-spacing: 0.3px; line-height: 1.6;">
              <li style="margin-bottom: 8px;">Keep your phone handy for delivery updates</li>
              <li style="margin-bottom: 8px;">Ensure someone is available at the delivery address</li>
              <li style="margin-bottom: 8px;">Have a valid ID ready for verification</li>
              <li>Check your package immediately upon delivery</li>
            </ul>
          </div>

          <!-- Closing -->
          <div style="text-align: center; margin-top: 40px;">
            <div style="width: 60px; height: 2px; background: #c49a3c; margin: 0 auto 25px auto;"></div>
            <p style="color: #6b5040; font-size: 15px; font-weight: 300; letter-spacing: 0.3px; margin: 0 0 15px 0; line-height: 1.6;">
              We can't wait for you to receive your luxury beauty essentials!
            </p>
            <p style="color: #2d1f0e; font-size: 16px; font-weight: 400; margin: 0; letter-spacing: 0.5px;">
              With elegance,<br>
              <span style="color: #c49a3c; font-weight: 500;">Your Beauty Team</span>
            </p>
          </div>
        </div>

        <!-- Footer -->
        <div style="background: #2d1f0e; padding: 25px 40px; text-align: center;">
          <div style="height: 2px; background: linear-gradient(90deg, transparent 0%, #c49a3c 50%, transparent 100%); margin-bottom: 15px;"></div>
          <p style="color: #6b5040; font-size: 12px; font-weight: 300; margin: 0; letter-spacing: 0.5px; opacity: 0.8;">
            This is an automated email. Please do not reply to this message.
          </p>
          
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendOrderEmail({
    to: customerEmail,
    subject: `📦 Order ${orderNumber} - Tracking Information Available`,
    html: html,
  });
}

module.exports = {
  sendOrderStatusEmail,
  sendCourierTrackingEmail,
};
