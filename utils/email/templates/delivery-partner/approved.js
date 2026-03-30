const { getCompanyData } = require("./helpers");

/**
 * Delivery Partner Approval Email Template
 */
async function getApprovedEmailTemplate({ name, email, partnerId, password, verificationToken }) {
  // Fetch dynamic company data from database
  const companyData = await getCompanyData();
  
  const verificationLink = `${companyData.frontendUrl}/verify-partner?token=${verificationToken}`;
  const loginLink = `${companyData.frontendUrl}/partner/login`;

  return {
    subject: `Welcome to ${companyData.companyName} Delivery Partner Network! 🎉`,
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
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
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
            margin: 0 0 10px 0;
            font-size: 28px;
          }
          .header p {
            margin: 0;
            font-size: 16px;
          }
          .content { 
            background: #f9f9f9; 
            padding: 30px; 
            border-radius: 0 0 10px 10px; 
          }
          .credentials { 
            background: white; 
            padding: 20px; 
            border-left: 4px solid #667eea; 
            margin: 20px 0; 
            border-radius: 5px;
          }
          .credentials h3 {
            margin-top: 0;
            color: #667eea;
          }
          .credentials p {
            margin: 10px 0;
          }
          .credentials code {
            background: #f0f0f0; 
            padding: 5px 10px; 
            border-radius: 3px;
            font-size: 14px;
            font-family: 'Courier New', monospace;
          }
          .button { 
            display: inline-block; 
            padding: 12px 30px; 
            background: #667eea; 
            color: white !important; 
            text-decoration: none; 
            border-radius: 5px; 
            margin: 10px 5px;
            font-weight: bold;
          }
          .button:hover { 
            background: #764ba2; 
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
          .warning { 
            background: #fff3cd; 
            border-left: 4px solid #ffc107; 
            padding: 15px; 
            margin: 20px 0; 
            border-radius: 5px;
          }
          .warning strong {
            color: #856404;
          }
          .steps {
            background: white;
            padding: 20px;
            border-radius: 5px;
            margin: 20px 0;
          }
          .steps h3 {
            color: #667eea;
            margin-top: 0;
          }
          .steps ol {
            margin: 10px 0;
            padding-left: 20px;
          }
          .steps li {
            margin: 8px 0;
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
              <h1>🎉 Welcome Aboard!</h1>
              <p>Application Approved</p>
            </div>
          </div>
          
          <div class="content">
            <p>Dear <strong>${name}</strong>,</p>
            
            <p>Congratulations! We're excited to inform you that your application to join <strong>${companyData.companyName}</strong> delivery partner network has been <strong>approved</strong>!</p>
            
            <div class="credentials">
              <h3>Your Account Details:</h3>
              <p><strong>Partner ID:</strong> ${partnerId}</p>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Temporary Password:</strong> <code>${password}</code></p>
            </div>
            
            <div class="warning">
              <strong>⚠️ Important:</strong> Please verify your email address and change your password on first login for security purposes.
            </div>
            
            <div class="button-container">
              <a href="${verificationLink}" class="button">Verify Email Address</a>
              <a href="${loginLink}" class="button">Login to Dashboard</a>
            </div>
            
            <div class="steps">
              <h3>Next Steps:</h3>
              <ol>
                <li>Click the "Verify Email Address" button above</li>
                <li>Login to your partner dashboard</li>
                <li>Change your temporary password</li>
                <li>Complete your profile setup</li>
                <li>Start accepting delivery requests!</li>
              </ol>
            </div>
            
            <p>If you have any questions or need assistance, please contact our support team at <strong>${companyData.supportEmail}</strong> or call <strong>${companyData.supportPhone}</strong>.</p>
            
            <p>We look forward to working with you!</p>
            
            <p>Best regards,<br>
            <strong>${companyData.companyName} Delivery Team</strong></p>
          </div>
          
          <div class="footer">
            <p>This is an automated email. Please do not reply to this message.</p>
            <p>If you didn't apply to become a delivery partner, please contact us at ${companyData.supportEmail}</p>
          </div>
        </div>
      </body>
      </html>
    `,
  };
}

module.exports = { getApprovedEmailTemplate };
