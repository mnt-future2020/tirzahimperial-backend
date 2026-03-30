const { getCompanyData } = require("./helpers");

/**
 * Delivery Partner Suspension Email Template
 */
async function getSuspendedEmailTemplate({ name, email, partnerId, reason, note }) {
  // Fetch dynamic company data from database
  const companyData = await getCompanyData();

  return {
    subject: `Important: Your ${companyData.companyName} Delivery Partner Account Has Been Suspended`,
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
            background: #ffc107; 
            color: #333; 
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
          .warning-icon {
            font-size: 32px;
          }
          .content { 
            background: #f9f9f9; 
            padding: 30px; 
            border-radius: 0 0 10px 10px; 
          }
          .suspension-box { 
            background: white; 
            padding: 20px; 
            border-left: 4px solid #ffc107; 
            margin: 20px 0; 
            border-radius: 5px;
          }
          .suspension-box h3 {
            margin-top: 0;
            color: #f57c00;
          }
          .restrictions-box {
            background: #ffebee;
            border-left: 4px solid #f44336;
            padding: 15px;
            margin: 20px 0;
            border-radius: 5px;
          }
          .restrictions-box h3 {
            margin-top: 0;
            color: #c62828;
          }
          .contact-box {
            background: white;
            padding: 20px;
            border-radius: 5px;
            margin: 20px 0;
            border: 2px solid #2196F3;
          }
          .contact-box h3 {
            margin-top: 0;
            color: #2196F3;
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
              <div class="warning-icon">⚠️</div>
              <h1>Account Suspended</h1>
            </div>
          </div>
          
          <div class="content">
            <p>Dear <strong>${name}</strong>,</p>
            
            <p>Your <strong>${companyData.companyName}</strong> delivery partner account (<strong>${partnerId}</strong>) has been temporarily suspended.</p>
            
            <div class="suspension-box">
              <h3>Suspension Details:</h3>
              <p><strong>Partner ID:</strong> ${partnerId}</p>
              <p><strong>Reason:</strong> ${reason}</p>
              <p style="margin-top: 15px;"><strong>Additional Information:</strong></p>
              <p style="color: #666;">${note}</p>
            </div>
            
            <div class="restrictions-box">
              <h3>🚫 Account Restrictions:</h3>
              <p>During suspension, you cannot:</p>
              <ul>
                <li>Accept new delivery requests</li>
                <li>Access your partner dashboard</li>
                <li>Receive delivery assignments</li>
                <li>View earnings and payment information</li>
              </ul>
            </div>
            
            <div class="contact-box">
              <h3>📞 Need to Discuss This?</h3>
              <p>Contact our support team:</p>
              <p><strong>Email:</strong> ${companyData.supportEmail}</p>
              <p><strong>Phone:</strong> ${companyData.supportPhone}</p>
              <p><strong>Partner ID:</strong> ${partnerId}</p>
            </div>
            
            <div class="button-container">
              <a href="mailto:${companyData.supportEmail}?subject=Account Suspension Appeal - ${partnerId}" class="button">Contact Support</a>
            </div>
            
            <p>Our team will review your case and contact you with further instructions.</p>
            
            <p>Best regards,<br>
            <strong>${companyData.companyName} Delivery Team</strong></p>
          </div>
          
          <div class="footer">
            <p>This is an automated email. Please do not reply to this message.</p>
            <p>For assistance, contact ${companyData.supportEmail} or call ${companyData.supportPhone}</p>
          </div>
        </div>
      </body>
      </html>
    `,
  };
}

module.exports = { getSuspendedEmailTemplate };
