const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { prisma } = require('./database');
const { sendNewUserRegistrationAlert, sendWelcomeNotification } = require('../utils/notification/sendNotification');

// Configure Google OAuth Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: `${process.env.BACKEND_URL || 'https://api.tirzahimperial.com'}/api/auth/google/callback`
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails[0].value;
    const adminEmails = [process.env.ADMIN_EMAIL];
    const isAdmin = adminEmails.includes(email.toLowerCase());

    let user;
    let userType;

    if (isAdmin) {
      // Check if admin already exists
      user = await prisma.admin.findFirst({
        where: {
          OR: [
            { googleId: profile.id },
            { email: email }
          ]
        }
      });

      if (user) {
        // Existing admin found
        console.log(`👤 Passport: Existing admin found: ${email} (Provider: ${user.provider}, Verified: ${user.isVerified})`);

        // SECURITY CHECK: If admin registered with email/password but NOT verified
        if (user.provider === "local" && !user.isVerified) {
          console.log("⚠️ Passport: Admin registered but email not verified - blocking Google login");
          const error = new Error("EMAIL_NOT_VERIFIED");
          error.message = "Please verify your email first, then you can sign in with Google.";
          return done(error, null);
        }

        // Update existing admin with Google info
        // Preserve name and custom image if admin registered with local provider
        const updateData = {
          googleId: profile.id,
          provider: 'google',
          isVerified: true, // Safe to set true (already verified or Google user)
          lastLogin: new Date()
        };
        
        // Only update name if admin was previously a Google user
        if (user.provider === 'google') {
          updateData.name = profile.displayName;
        }
        
        // Only update image if no custom image exists
        const isGoogleImage = user.image && (
          user.image.includes('googleusercontent.com') || 
          user.image.includes('google.com') ||
          user.image.includes('lh3.googleusercontent.com')
        );
        
        if (!user.image || isGoogleImage || user.provider === 'google') {
          updateData.image = profile.photos[0]?.value;
        }
        
        user = await prisma.admin.update({
          where: { id: user.id },
          data: updateData
        });
        console.log("✅ Passport: Existing admin updated with Google credentials (name preserved)");
      } else {
        // Create new admin (auto-register)
        console.log("🆕 Passport: Auto-registering new Google admin:", email);
        user = await prisma.admin.create({
          data: {
            email: email,
            googleId: profile.id,
            name: profile.displayName,
            image: profile.photos[0]?.value,
            provider: 'google',
            isVerified: true, // New Google admins are auto-verified
            lastLogin: new Date()
          }
        });
        console.log("✅ Passport: Google admin auto-registered:", user.id);
      }
      userType = 'admin';
    } else {
      // Check if user already exists
      user = await prisma.user.findFirst({
        where: {
          OR: [
            { googleId: profile.id },
            { email: email }
          ]
        }
      });

      if (user) {
        // Existing user found
        console.log(`👤 Passport: Existing user found: ${email} (Provider: ${user.provider}, Verified: ${user.isVerified})`);

        // SECURITY CHECK: If user registered with email/password but NOT verified
        // Don't allow Google login to bypass email verification
        if (user.provider === "local" && !user.isVerified) {
          console.log("⚠️ Passport: User registered but email not verified - blocking Google login");
          const error = new Error("EMAIL_NOT_VERIFIED");
          error.message = "Please verify your email first, then you can sign in with Google.";
          return done(error, null);
        }

        // Update existing user with Google info (user is already verified or was Google user)
        // Preserve name and custom image if user registered with local provider
        const updateData = {
          googleId: profile.id,
          provider: 'google',
          isVerified: true, // Safe to set true (already verified or Google user)
          lastLogin: new Date()
        };
        
        // Only update name if user was previously a Google user
        if (user.provider === 'google') {
          updateData.name = profile.displayName;
        }
        
        // Only update image if no custom image exists
        const isGoogleImage = user.image && (
          user.image.includes('googleusercontent.com') || 
          user.image.includes('google.com') ||
          user.image.includes('lh3.googleusercontent.com')
        );
        
        if (!user.image || isGoogleImage || user.provider === 'google') {
          updateData.image = profile.photos[0]?.value;
        }
        
        user = await prisma.user.update({
          where: { id: user.id },
          data: updateData
        });
        console.log("✅ Passport: Existing user updated with Google credentials (name preserved)");
      } else {
        // Create new user (auto-register)
        console.log("🆕 Passport: Auto-registering new Google user:", email);
        user = await prisma.user.create({
          data: {
            email: email,
            googleId: profile.id,
            name: profile.displayName,
            image: profile.photos[0]?.value,
            provider: 'google',
            isVerified: true, // New Google users are auto-verified
            lastLogin: new Date()
          }
        });
        console.log("✅ Passport: Google user auto-registered:", user.id);

        // Create Customer record for new Google user (monolith approach)
        let customerId = null;
        try {
          console.log("📝 Passport: Creating customer record for new Google user:", user.id);
          const customer = await prisma.customer.create({
            data: {
              userId: user.id,
              email: user.email,
              name: user.name,
              image: user.image,
              isVerified: true,
              provider: 'google',
            },
          });
          customerId = customer.id;
          console.log("✅ Passport: Customer record created for Google user:", customer.id);
        } catch (customerError) {
          console.error("❌ Passport: Failed to create customer record:");
          console.error("Error details:", customerError);
          // Don't fail authentication if customer creation fails
        }

        // Send new user registration notification to admins (non-blocking)
        setImmediate(async () => {
          try {
            await sendNewUserRegistrationAlert(user.name, user.email, customerId);
            console.log(`📱 New Google user registration notification sent to admins`);
          } catch (notifError) {
            console.error('⚠️ Failed to send registration notification:', notifError.message);
          }
        });

        // Send welcome notification to the new Google user (non-blocking)
        setImmediate(async () => {
          try {
            await sendWelcomeNotification(user.id, user.name);
            console.log(`🎉 Welcome notification sent to Google user: ${user.name}`);

            // Send welcome email template (non-blocking)
            const { getWelcomeEmailTemplate } = require('../utils/email/templates/welcomeEmailTemplate');
            const { sendEmail: sendSMTPEmail, sendEmailWithEnv } = require('../config/connectSMTP');
            
            // Email helper function
            const sendEmail = async (emailData) => {
              try {
                console.log("📧 Attempting to send welcome email to:", emailData.to);
                
                // Get active email configuration from database
                const emailConfig = await prisma.emailConfiguration.findFirst({
                  where: { isActive: true }
                });

                let result;
                
                if (emailConfig) {
                  // Use database SMTP configuration
                  console.log("📧 Using database SMTP configuration");
                  result = await sendSMTPEmail(emailConfig, {
                    to: emailData.to,
                    subject: emailData.subject,
                    html: emailData.html,
                    text: emailData.text || emailData.html?.replace(/<[^>]*>/g, '') // Strip HTML for text version
                  });
                } else {
                  // Fallback to environment variables
                  console.log("📧 Using environment SMTP configuration");
                  result = await sendEmailWithEnv({
                    to: emailData.to,
                    subject: emailData.subject,
                    html: emailData.html,
                    text: emailData.text || emailData.html?.replace(/<[^>]*>/g, '')
                  });
                }

                if (result.success) {
                  console.log("✅ Welcome email sent successfully to:", emailData.to);
                } else {
                  console.error("❌ Failed to send welcome email:", result.message);
                }
                
                return result;
              } catch (error) {
                console.error("❌ Welcome email sending error:", error);
                return { success: false, message: error.message };
              }
            };

            // Get welcome email template and send
            const emailData = await getWelcomeEmailTemplate({
              email: user.email,
              name: user.name
            });
            
            await sendEmail({
              to: user.email,
              subject: emailData.subject,
              html: emailData.html
            });
            console.log(`📧 Welcome email sent to Google user: ${user.email}`);
          } catch (notifError) {
            console.error('⚠️ Failed to send welcome notification or email:', notifError.message);
          }
        });
      }
      userType = 'user';
    }

    // Add role to user object for session
    user.role = userType;
    return done(null, user);
  } catch (error) {
    console.error('Google OAuth error:', error);
    return done(error, null);
  }
}));

// Serialize user for session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    // Try to find user in users collection first
    let user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        isVerified: true,
        isActive: true
      }
    });
    let userType = 'user';

    // If not found in users, try admins collection
    if (!user) {
      user = await prisma.admin.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          isVerified: true,
          isActive: true
        }
      });
      userType = 'admin';
    }

    if (user) {
      user.role = userType;
    }

    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport;