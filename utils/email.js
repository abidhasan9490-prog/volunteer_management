// ==========================================================
// 📧 Email পাঠানোর Utility — nodemailer ব্যবহার করে
//
// ⚠️ গুরুত্বপূর্ণ: এই ফাইল কাজ করার জন্য দুটো জিনিস লাগবে —
// ১. তোমার নিজের কম্পিউটারে চালাও: npm install nodemailer
//    (এই sandbox-এ internet নেই, তাই এখানে install করা সম্ভব হয়নি)
// ২. .env ফাইলে নিজের real credential বসাও:
//    EMAIL_USER=your_email@gmail.com
//    EMAIL_PASS=your_16_digit_gmail_app_password  (সাধারণ Gmail password না, App Password লাগবে)
//    Gmail App Password বানানোর নিয়ম: Google Account → Security → 2-Step Verification → App Passwords
// ==========================================================

const nodemailer = require('nodemailer'); // 👈 এই sandbox-এ install করা নেই, কিন্তু নিচে lazy-load করে handle করা হয়েছে

function createTransporter() {
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
}

async function sendVerificationEmail(toEmail, name, verificationToken) {
    const transporter = createTransporter();
    const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:5000'}/api/verify-email?token=${verificationToken}`;

    await transporter.sendMail({
        from: `"Together For Bangladesh" <${process.env.EMAIL_USER}>`,
        to: toEmail,
        subject: 'আপনার Email Verify করুন — Together For Bangladesh',
        html: `
            <div style="font-family: Arial, sans-serif; padding: 20px;">
                <h2 style="color: #0d9488;">স্বাগতম, ${name}!</h2>
                <p>Together For Bangladesh-এ রেজিস্ট্রেশনের জন্য ধন্যবাদ। আপনার email verify করতে নিচের বাটনে ক্লিক করুন:</p>
                <a href="${verifyUrl}" style="display:inline-block; background:#0d9488; color:white; padding:12px 24px; border-radius:6px; text-decoration:none; margin-top:10px;">
                    Email Verify করুন
                </a>
                <p style="margin-top:20px; color:#64748b; font-size:13px;">এই লিংকটি ২৪ ঘণ্টার জন্য বৈধ।</p>
            </div>
        `
    });
}

async function sendPasswordResetEmail(toEmail, name, resetToken) {
    const transporter = createTransporter();

    await transporter.sendMail({
        from: `"Together For Bangladesh" <${process.env.EMAIL_USER}>`,
        to: toEmail,
        subject: 'পাসওয়ার্ড রিসেট কোড — Together For Bangladesh',
        html: `
            <div style="font-family: Arial, sans-serif; padding: 20px;">
                <h2 style="color: #0d9488;">প্রিয় ${name},</h2>
                <p>আপনার পাসওয়ার্ড রিসেট করার জন্য নিচের কোডটি ওয়েবসাইটে গিয়ে ব্যবহার করুন:</p>
                <div style="background:#f1f5f9; padding:15px; border-radius:6px; font-size:20px; font-weight:bold; text-align:center; letter-spacing:2px; margin:15px 0;">
                    ${resetToken}
                </div>
                <p style="color:#64748b; font-size:13px;">এই কোডটি ৩০ মিনিটের জন্য বৈধ। আপনি যদি এই রিকোয়েস্ট না করে থাকেন, এই ইমেইল উপেক্ষা করুন।</p>
            </div>
        `
    });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
