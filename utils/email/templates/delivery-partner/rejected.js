const { getCompanyData } = require("./helpers");

/**
 * Delivery Partner Rejection Email Template
 */
async function getRejectedEmailTemplate({ name, email, reason, note }) {
  // Fetch dynamic company data from database
  const companyData = await getCompanyData();
  
  const reapplyLink = `${companyData.frontendUrl}/partner/apply`;

  return {
    subject: `${companyData.companyName} - Delivery Partner Application Status Update`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            line-height: 1.6; 
            color: #333; 
            margin: 0;
            padding: 0;
          }
          .container { 
            max-width: 600px; 
            margin: 0 auto; 
            padding: 20px; 
          }
          .header { 
            background: #dc3545; 
            color: white; 
            padding: 30px; 
            border-radius: 10px 10px 0 0;
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
          .header-left {
            flex: 0 0 auto;
          }
          .header-logo {
            max-width: 180px;
            max-height: 80px;
          }
          .header-right {
            flex: 1;
            text-align: right;
          }
          .header h1 {
            margin: 0;
            font-size: 24px;
          }
          .content { 
            background: #f9f9f9; 
            padding: 30px; 
            border-radius: 0 0 10px 10px; 
          }
          .reason-box { 
            background: white; 
            padding: 20px; 
            border-left: 4px solid #dc3545; 
            margin: 20px 0; 
            border-radius: 5px;
          }
          .reason-box h3 {
            margin-top: 0;
            color: #dc3545;
          }
          .info-box {
            background: #e7f3ff;
            border-left: 4px solid #2196F3;
            padding: 15px;
            margin: 20px 0;
            border-radius: 5px;
          }
          .button { 
            display: inline-block; 
            padding: 12px 30px; 
            background: #2196F3; 
            color: white !important; 
            text-decoration: none; 
            border-radius: 5px; 
            margin: 10px 5px;
            font-weight: bold;
          }
          .button-container {
            text-align: center;
            margin: 30px 0;
          }
          .contact-info {
            background: white;
            padding: 20px;
            border-radius: 5px;
            margin: 20px 0;
          }
          .footer { 
            text-align: center; 
            margin-top: 30px; 
            color: #666; 
            font-size: 12px; 
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="header-left">
              ${companyData.logoUrl ? `<img src="${companyData.logoUrl}" alt="${companyData.companyName}" class="header-logo" />` : ''}
            </div>
            <div class="header-right">
              <h1>Application Status Update</h1>
            </div>
          </div>
          
          <div class="content">
            <p>Dear <strong>${name}</strong>,</p>
            
            <p>Thank you for your interest in joining <strong>${companyData.companyName}</strong> delivery partner network.</p>
            
            <p>After careful review, we are unable to approve your application at this time.</p>
            
            <div class="reason-box">
              <h3>Reason for Rejection:</h3>
              <p><strong>${reason}</strong></p>
              ${note ? `<p style="margin-top: 15px; color: #666;">${note}</p>` : ''}
            </div>
            
            <div class="info-box">
              <strong>📋 What This Means:</strong>
              <p style="margin: 10px 0 0 0;">We encourage you to address the concerns mentioned above and reapply in the future.</p>
            </div>
            
            <div class="contact-info">
              <h3>Need More Information?</h3>
              <p>If you have questions, please contact our support team:</p>
              <p><strong>Email:</strong> ${companyData.supportEmail}</p>
              <p><strong>Phone:</strong> ${companyData.supportPhone}</p>
            </div>
            
            <div class="button-container">
              <a href="${reapplyLink}" class="button">Reapply in the Future</a>
            </div>
            
            <p>Thank you for your understanding.</p>
            
            <p>Best regards,<br>
            <strong>${companyData.companyName} Delivery Team</strong></p>
          </div>
          
          <div class="footer">
            <p>This is an automated email. Please do not reply to this message.</p>
            <p>For inquiries, please contact ${companyData.supportEmail} or call ${companyData.supportPhone}</p>
          </div>
        </div>
      </body>
      </html>
    `,
  };
}

module.exports = { getRejectedEmailTemplate };
