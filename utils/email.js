// ==========================================================
// 📧 Email পাঠানোর Utility — Brevo (আগের নাম Sendinblue) API ব্যবহার করে
// ==========================================================

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

async function sendViaBrevo({ toEmail, toName, subject, htmlContent }) {
    const response = await fetch(BREVO_API_URL, {
        method: 'POST',
        headers: {
            'accept': 'application/json',
            'api-key': process.env.BREVO_API_KEY,
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            sender: {
                name: 'Together For Bangladesh',
                email: process.env.BREVO_SENDER_EMAIL
            },
            to: [{ email: toEmail, name: toName }],
            subject,
            htmlContent
        })
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Brevo API error (${response.status}): ${errorBody}`);
    }

    return response.json();
}

async function sendVerificationEmail(toEmail, name, verificationToken) {
    const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:5000'}/api/verify-email?token=${verificationToken}`;

    await sendViaBrevo({
        toEmail,
        toName: name,
        subject: 'আপনার Email Verify করুন — Together For Bangladesh',
        htmlContent: `
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
    await sendViaBrevo({
        toEmail,
        toName: name,
        subject: 'পাসওয়ার্ড রিসেট কোড — Together For Bangladesh',
        htmlContent: `
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