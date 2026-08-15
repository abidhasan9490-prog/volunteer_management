const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);

// Middleware
app.use(express.json({ limit: '5mb' })); // 👈 বেস৬৪ প্রোফাইল ছবি পাঠানোর জন্য default 100kb limit বাড়ানো হলো
app.use(cors());

// 🌐 Frontend static files (index.html, script.js, style.css) এই একই সার্ভার থেকে serve করা হচ্ছে
// এতে Render-এ একটাই Web Service দিয়ে পুরো সাইট (frontend + backend) deploy করা যাবে
app.use(express.static(__dirname));

// MongoDB Database Connection
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB Database Connected Successfully! 🎉"))
    .catch((err) => console.log("Database Connection Error ❌:", err));

// User মডেল কল করা
const crypto = require('crypto');
const User = require('./models/User');
const SosRequest = require('./models/SosRequest');
const Event = require('./models/Event');
const { createToken, requireAdmin, requireVolunteer, optionalAuth } = require('./middleware/auth');
const { hashPassword, verifyPassword } = require('./utils/password');
const { haversineDistanceKm } = require('./utils/geo');
const { checkAndAwardBadges, BADGE_DEFINITIONS } = require('./utils/badges');
const { createRateLimiter } = require('./middleware/rateLimiter');

// 🚦 বিভিন্ন sensitive route-এর জন্য rate limiter (spam/abuse প্রতিরোধ করার জন্য)
const registerLimiter = createRateLimiter(60 * 60 * 1000, 50, 'Registration'); // প্রতি ঘণ্টায় সর্বোচ্চ ৫টা registration, প্রতি IP থেকে
const loginLimiter = createRateLimiter(15 * 60 * 1000, 15, 'Login', (req) => `login:${req.ip}`); // প্রতি ১৫ মিনিটে সর্বোচ্চ ৮ বার (brute-force প্রতিরোধ)
const sosLimiter = createRateLimiter(10 * 60 * 1000, 3, 'SOS Request', (req) => `sos:${req.ip}`); // প্রতি ১০ মিনিটে সর্বোচ্চ ৩টা SOS (spam প্রতিরোধ)
const emailActionLimiter = createRateLimiter(15 * 60 * 1000, 3, 'Email Request', (req) => `email:${req.ip}`); // forgot-password/resend-verification spam প্রতিরোধ

// 📧 Email utility — 'nodemailer' install করা না থাকলেও সার্ভার crash করবে না,
// শুধু email পাঠানো ব্যর্থ হবে এবং console-এ warning + fallback link দেখাবে
let emailUtil;
try {
    emailUtil = require('./utils/email');
} catch (err) {
    console.warn("⚠️ 'nodemailer' ইনস্টল করা নেই — চালাও: npm install nodemailer (real email পাঠানোর জন্য)।");
    emailUtil = null;
}

async function trySendEmail(sendFn, ...args) {
    if (!emailUtil) return false;
    try {
        await sendFn(...args);
        return true;
    } catch (err) {
        console.warn("⚠️ Email পাঠানো ব্যর্থ হয়েছে (EMAIL_USER/EMAIL_PASS .env-এ ঠিকভাবে সেট করা আছে কিনা চেক করো):", err.message);
        return false;
    }
}

// নতুন ভলান্টিয়ার রেজিস্ট্রেশন করার API Endpoint
app.post('/api/register', registerLimiter, async (req, res) => {
    try {
        console.log("উইবসাইট থেকে আসা ডেটা:", { ...req.body, password: '[hidden]', profilePic: req.body.profilePic ? '[base64 image data]' : '(none)' });
        const { name, email, password, phone, district, bloodGroup, dob, primarySkill, experience, latitude, longitude, profilePic } = req.body;

        if (!password || password.length < 6) {
            return res.status(400).json({ error: "পাসওয়ার্ড অন্তত ৬ ক্যারেক্টার হতে হবে।" });
        }

        if (latitude === undefined || longitude === undefined || latitude === null || longitude === null) {
            return res.status(400).json({ error: "GPS Location যুক্ত করা বাধ্যতামূলক। 'লোকেশন ক্যাপচার করুন' বাটনে ক্লিক করুন।" });
        }

        // পাসওয়ার্ড হ্যাশ করা (plaintext কখনো ডাটাবেসে যাবে না)
        const hashedPassword = hashPassword(password);

        // Email Verification token তৈরি (২৪ ঘণ্টা মেয়াদ)
        const verificationToken = crypto.randomBytes(20).toString('hex');
        const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

        // নতুন ইউজার তৈরি (location GeoJSON ফরম্যাটে সেভ হয়: [longitude, latitude])
        const newUser = new User({
            name, email, password: hashedPassword, phone, district, bloodGroup, dob, primarySkill, experience,
            profilePic: profilePic || '',
            location: { type: 'Point', coordinates: [parseFloat(longitude), parseFloat(latitude)] },
            emailVerificationToken: verificationToken,
            emailVerificationExpires: verificationExpires
        });
        
        // ডেটাবেসে সেভ করা
        await newUser.save();

        // Verification email পাঠানোর চেষ্টা (ব্যর্থ হলেও registration আটকাবে না — শুধু console-এ warning + fallback link)
        const verifyUrl = `${process.env.FRONTEND_URL || 'https://volunteer-management-qjdk.onrender.com'}/api/verify-email?token=${verificationToken}`;
        const emailSent = await trySendEmail(emailUtil?.sendVerificationEmail, email, name, verificationToken);
        if (!emailSent) {
            console.log(`📧 [DEV FALLBACK] ${email}-এর ভেরিফিকেশন লিংক (email service সেটআপ না থাকায় এখানে দেখানো হলো):\n${verifyUrl}`);
        }

        res.status(201).json({
            message: "Registration Successful! Welcome to Together For Bangladesh. আপনার ইমেইলে একটি ভেরিফিকেশন লিংক পাঠানো হয়েছে (যদি email service configured না থাকে, সার্ভার কনসোলে লিংকটি দেখুন)।"
        });
    } catch (error) {
        console.error("Registration Error:", error.message); // 👈 debug করার জন্য error log যুক্ত করা হলো
        res.status(500).json({ error: "Failed to register. Email might already exist!" });
    }
});

// ==========================================================
// 🔐 Volunteer Login — নিজের প্রোফাইল/সার্টিফিকেট/SOS identity-এর জন্য
// ==========================================================
app.post('/api/volunteer/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        if (!user || !verifyPassword(password, user.password)) {
            return res.status(401).json({ error: "ভুল Email অথবা Password!" });
        }

        // Email verify করা না থাকলে login আটকে দেওয়া হবে
        if (!user.isEmailVerified) {
            return res.status(403).json({
                error: "আপনার ইমেইল এখনো verify করা হয়নি। ইমেইলে পাঠানো লিংকে ক্লিক করুন, বা নিচে 'Resend Verification Email' চাপুন।",
                needsVerification: true,
                email: user.email
            });
        }

        const token = createToken({ userId: user._id, name: user.name });
        res.status(200).json({ message: "Login successful!", token });
    } catch (error) {
        console.error("Volunteer Login Error:", error.message);
        res.status(500).json({ error: "Login failed. Try again." });
    }
});

// ==========================================================
// 📧 Email Verification
// ==========================================================

// ইমেইলের ভেতরের লিংকে ক্লিক করলে এখানে আসবে
app.get('/api/verify-email', async (req, res) => {
    try {
        const { token } = req.query;
        const user = await User.findOne({
            emailVerificationToken: token,
            emailVerificationExpires: { $gt: new Date() }
        });

        if (!user) {
            return res.status(400).send('<h2>❌ ভেরিফিকেশন লিংকের মেয়াদ শেষ হয়ে গেছে বা এটা অবৈধ। নতুন লিংকের জন্য "Resend Verification" ব্যবহার করুন।</h2>');
        }

        user.isEmailVerified = true;
        user.emailVerificationToken = null;
        user.emailVerificationExpires = null;
        await user.save();

        res.send('<h2>✅ আপনার ইমেইল সফলভাবে Verify হয়েছে! এখন সাইটে ফিরে গিয়ে Login করতে পারবেন।</h2>');
    } catch (error) {
        console.error("Email Verify Error:", error.message);
        res.status(500).send('<h2>❌ কিছু একটা ভুল হয়েছে।</h2>');
    }
});

// Verification email আবার পাঠানো (আগের email হারিয়ে গেলে বা মেয়াদ শেষ হলে)
app.post('/api/volunteer/resend-verification', emailActionLimiter, async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });

        if (!user) return res.status(404).json({ error: "এই ইমেইলে কোনো ভলান্টিয়ার নিবন্ধিত নেই।" });
        if (user.isEmailVerified) return res.status(400).json({ error: "এই ইমেইল আগেই verify করা হয়ে গেছে।" });

        const verificationToken = crypto.randomBytes(20).toString('hex');
        user.emailVerificationToken = verificationToken;
        user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await user.save();

        const verifyUrl = `${process.env.FRONTEND_URL || 'https://volunteer-management-qjdk.onrender.com'}/api/verify-email?token=${verificationToken}`;
        const emailSent = await trySendEmail(emailUtil?.sendVerificationEmail, email, user.name, verificationToken);
        if (!emailSent) {
            console.log(`📧 [DEV FALLBACK] ${email}-এর নতুন ভেরিফিকেশন লিংক:\n${verifyUrl}`);
        }

        res.status(200).json({ message: "ভেরিফিকেশন ইমেইল আবার পাঠানো হয়েছে (বা সার্ভার কনসোলে লিংক দেখুন)।" });
    } catch (error) {
        console.error("Resend Verification Error:", error.message);
        res.status(500).json({ error: "Failed to resend verification email." });
    }
});

// ==========================================================
// 🔑 Forgot Password / Reset Password
// ==========================================================

app.post('/api/volunteer/forgot-password', emailActionLimiter, async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });

        // সিকিউরিটি নোট: কোন ইমেইল registered আছে সেটা leak না করার জন্য, ইউজার থাকুক বা না থাকুক একই generic মেসেজ দেওয়া হচ্ছে
        const genericMessage = "যদি এই ইমেইলে কোনো অ্যাকাউন্ট থাকে, একটি রিসেট কোড পাঠানো হয়েছে।";

        if (!user) {
            return res.status(200).json({ message: genericMessage });
        }

        const resetToken = crypto.randomBytes(4).toString('hex').toUpperCase(); // ছোট, সহজে টাইপ করার মতো কোড (৮ ক্যারেক্টার)
        user.passwordResetToken = resetToken;
        user.passwordResetExpires = new Date(Date.now() + 30 * 60 * 1000); // ৩০ মিনিট মেয়াদ
        await user.save();

        const emailSent = await trySendEmail(emailUtil?.sendPasswordResetEmail, email, user.name, resetToken);
        if (!emailSent) {
            console.log(`📧 [DEV FALLBACK] ${email}-এর পাসওয়ার্ড রিসেট কোড:\n${resetToken}`);
        }

        res.status(200).json({ message: genericMessage });
    } catch (error) {
        console.error("Forgot Password Error:", error.message);
        res.status(500).json({ error: "Failed to process request." });
    }
});

app.post('/api/volunteer/reset-password', async (req, res) => {
    try {
        const { email, token, newPassword } = req.body;

        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ error: "নতুন পাসওয়ার্ড অন্তত ৬ ক্যারেক্টার হতে হবে।" });
        }

        const user = await User.findOne({
            email,
            passwordResetToken: token,
            passwordResetExpires: { $gt: new Date() }
        });

        if (!user) {
            return res.status(400).json({ error: "রিসেট কোড ভুল বা মেয়াদ শেষ হয়ে গেছে।" });
        }

        user.password = hashPassword(newPassword);
        user.passwordResetToken = null;
        user.passwordResetExpires = null;
        await user.save();

        res.status(200).json({ message: "✅ পাসওয়ার্ড সফলভাবে রিসেট হয়েছে! এখন নতুন পাসওয়ার্ড দিয়ে Login করুন।" });
    } catch (error) {
        console.error("Reset Password Error:", error.message);
        res.status(500).json({ error: "Failed to reset password." });
    }
});

// Real badge definitions frontend-কে পাঠানোর জন্য (criteria function JSON.stringify হওয়ার সময় নিজেই বাদ পড়ে যায়)
app.get('/api/badges', (req, res) => {
    res.status(200).json(BADGE_DEFINITIONS);
});

// নিজের প্রোফাইল ডেটা আনার Endpoint (লগইন করা থাকলেই কাজ করবে)
app.get('/api/volunteer/me', requireVolunteer, async (req, res) => {
    try {
        const user = await User.findById(req.volunteer.userId).select('-password');
        if (!user) return res.status(404).json({ error: "User not found." });
        res.status(200).json(user);
    } catch (error) {
        console.error("Profile Fetch Error:", error.message);
        res.status(500).json({ error: "Failed to load profile." });
    }
});

// ==========================================================
// 🔐 Admin Login — AI Matching Engine অ্যাক্সেস করার জন্য
// ==========================================================
app.post('/api/admin/login', loginLimiter, (req, res) => {
    const { username, password } = req.body;

    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
        const token = createToken({ isAdmin: true, username });
        return res.status(200).json({ message: "Login successful!", token });
    }

    res.status(401).json({ error: "ভুল Username অথবা Password!" });
});

// ==========================================================
// 🤖 AI Volunteer Matching Engine — Real Database থেকে
// (Admin login লাগবে, নিচের requireAdmin middleware সেটা চেক করে)
// ==========================================================
app.get('/api/volunteers/match', requireAdmin, async (req, res) => {
    try {
        const requiredSkill = req.query.skill;
        const minExperience = parseInt(req.query.experience) || 0;

        // ডেটাবেসের সব রেজিস্টার্ড ভলান্টিয়ার আনা
        const volunteers = await User.find({});

        // প্রতিটি ভলান্টিয়ারের জন্য ম্যাচ স্কোর হিসাব (আগের mock ইঞ্জিনের একই ফর্মুলা, শুধু এখন real data দিয়ে)
        const scored = volunteers.map(vol => {
            let matchScore = 50;
            if (vol.primarySkill === requiredSkill) matchScore += 35;
            if (vol.experience >= minExperience) matchScore += 15;
            matchScore += (vol.rating * 2);

            return {
                name: vol.name,
                district: vol.district,
                skill: vol.primarySkill,
                experience: vol.experience,
                rating: vol.rating,
                completedTasks: vol.completedTasks,
                matchScore: Math.min(Math.round(matchScore), 99)
            };
        });

        // সবচেয়ে ভালো ম্যাচ আগে দেখানো
        scored.sort((a, b) => b.matchScore - a.matchScore);

        res.status(200).json(scored);
    } catch (error) {
        console.error("Matching Error:", error.message);
        res.status(500).json({ error: "Failed to run AI matching." });
    }
});

// ==========================================================
// 🏆 Real Leaderboard — ডেটাবেসের real ইউজার থেকে, Points দিয়ে sort
// ==========================================================
app.get('/api/leaderboard', async (req, res) => {
    try {
        const topVolunteers = await User.find({})
            .select('name district completedTasks points')
            .sort({ points: -1 })
            .limit(20);

        res.status(200).json(topVolunteers);
    } catch (error) {
        console.error("Leaderboard Error:", error.message);
        res.status(500).json({ error: "Failed to load leaderboard." });
    }
});

// লগইন করা ভলান্টিয়ারের নিজের র‍্যাংক জানার Endpoint
app.get('/api/leaderboard/my-rank', requireVolunteer, async (req, res) => {
    try {
        const me = await User.findById(req.volunteer.userId);
        if (!me) return res.status(404).json({ error: "User not found." });

        // আমার চেয়ে বেশি পয়েন্ট আছে এমন কতজন আছে গুনে র‍্যাংক বের করা
        const higherRankedCount = await User.countDocuments({ points: { $gt: me.points } });
        const totalVolunteers = await User.countDocuments({});

        res.status(200).json({ rank: higherRankedCount + 1, totalVolunteers, points: me.points });
    } catch (error) {
        console.error("Rank Fetch Error:", error.message);
        res.status(500).json({ error: "Failed to fetch rank." });
    }
});

// ==========================================================
// 🚨 Emergency SOS Request — এখন সত্যিকারের ডেটাবেসে সেভ হয়
// (optionalAuth: লগইন থাকলে identity যুক্ত হবে, না থাকলে Guest হিসেবে চলবে)
// ==========================================================
app.post('/api/sos', sosLimiter, optionalAuth, async (req, res) => {
    try {
        const { category, volunteersNeeded, details, latitude, longitude } = req.body;

        const newSos = new SosRequest({
            category,
            volunteersNeeded,
            details,
            latitude,
            longitude,
            location: { type: 'Point', coordinates: [parseFloat(longitude) || 0, parseFloat(latitude) || 0] },
            requestedBy: req.volunteer ? req.volunteer.userId : null,
            requestedByName: req.volunteer ? req.volunteer.name : 'Guest'
        });

        await newSos.save();

        res.status(201).json({ message: "SOS request saved and broadcasted!", sos: newSos });
    } catch (error) {
        console.error("SOS Save Error:", error.message);
        res.status(500).json({ error: "Failed to save SOS request." });
    }
});

// ==========================================================
// 📍 GPS-based Nearby Volunteer Search — Real $geoNear query
// (এখন Admin-Only না — যেকোনো Logged-in/Authentic Volunteer দেখতে পারবে,
//  কিন্তু Guest/visitor (যারা login করেনি) দেখতে পারবে না)
// ==========================================================
app.get('/api/volunteers/nearby', requireVolunteer, async (req, res) => {
    try {
        const lat = parseFloat(req.query.lat);
        const lng = parseFloat(req.query.lng);
        const radiusKm = parseFloat(req.query.radiusKm) || 5; // ডিফল্ট ৫ কিলোমিটার

        if (isNaN(lat) || isNaN(lng)) {
            return res.status(400).json({ error: "Valid lat/lng query parameter লাগবে।" });
        }

        // MongoDB-এর $geoNear নিজেই real distance হিসাব করে দেয় (স্ফেয়ারিক আর্থ ক্যালকুলেশন সহ)
        const nearbyVolunteers = await User.aggregate([
            {
                $geoNear: {
                    near: { type: 'Point', coordinates: [lng, lat] },
                    distanceField: 'distanceMeters',
                    spherical: true,
                    maxDistance: radiusKm * 1000 // কিলোমিটার থেকে মিটারে
                }
            },
            {
                $match: { _id: { $ne: new mongoose.Types.ObjectId(req.volunteer.userId) } } // নিজেকে নিজের নিকটবর্তী লিস্টে দেখানোর প্রয়োজন নেই
            },
            {
                $project: {
                    name: 1, district: 1, primarySkill: 1, experience: 1, rating: 1,
                    phone: 1, location: 1,
                    distanceKm: { $round: [{ $divide: ["$distanceMeters", 1000] }, 2] }
                }
            }
        ]);

        res.status(200).json(nearbyVolunteers);
    } catch (error) {
        console.error("Nearby Search Error:", error.message);
        res.status(500).json({ error: "Failed to search nearby volunteers." });
    }
});

// ==========================================================
// 🔔 Real-time Nearby SOS Alerts (Polling-based, push-service ছাড়াই)
// Volunteer লগইন করা থাকলে প্রতি কয়েক সেকেন্ডে এটা কল হয়ে চেক করে
// তার আশেপাশে (radiusKm) কোনো নতুন SOS request এসেছে কিনা (since এর পর)
// ==========================================================
app.get('/api/sos/nearby-alerts', requireVolunteer, async (req, res) => {
    try {
        const lat = parseFloat(req.query.lat);
        const lng = parseFloat(req.query.lng);
        const radiusKm = parseFloat(req.query.radiusKm) || 5;
        const since = req.query.since ? new Date(parseInt(req.query.since)) : new Date(Date.now() - 60000);

        if (isNaN(lat) || isNaN(lng)) {
            return res.status(400).json({ error: "Valid lat/lng লাগবে।" });
        }

        const alerts = await SosRequest.aggregate([
            {
                $geoNear: {
                    near: { type: 'Point', coordinates: [lng, lat] },
                    distanceField: 'distanceMeters',
                    spherical: true,
                    maxDistance: radiusKm * 1000
                }
            },
            {
                $match: {
                    createdAt: { $gt: since },
                    status: 'pending',
                    requestedBy: { $ne: new mongoose.Types.ObjectId(req.volunteer.userId) } // নিজের পাঠানো SOS নিজেকে notify করবে না
                }
            },
            {
                $project: {
                    category: 1, details: 1, volunteersNeeded: 1, requestedByName: 1, createdAt: 1,
                    respondersCount: { $size: { $ifNull: ["$responders", []] } }, // 👈 এখন পর্যন্ত কতজন সাড়া দিয়েছে
                    distanceKm: { $round: [{ $divide: ["$distanceMeters", 1000] }, 2] }
                }
            }
        ]);

        res.status(200).json(alerts);
    } catch (error) {
        console.error("Nearby Alerts Error:", error.message);
        res.status(500).json({ error: "Failed to fetch nearby alerts." });
    }
});

// ==========================================================
// 🛠️ ADMIN PANEL — Volunteer Management + Task Completion (Points/Rating সিস্টেম)
// ==========================================================

// সব ভলান্টিয়ারের লিস্ট (Admin Panel-এ দেখানোর জন্য)
app.get('/api/admin/volunteers', requireAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const totalCount = await User.countDocuments({});
        const volunteers = await User.find({}).select('-password').sort({ createdAt: -1 }).skip(skip).limit(limit);

        res.status(200).json({
            data: volunteers,
            currentPage: page,
            totalPages: Math.ceil(totalCount / limit),
            totalCount
        });
    } catch (error) {
        console.error("Admin Volunteer List Error:", error.message);
        res.status(500).json({ error: "Failed to load volunteers." });
    }
});

// Admin manually email verify করে দিতে পারবে — real email service কনফিগার করা না থাকলে এটা fallback
app.patch('/api/admin/volunteers/:id/verify-email', requireAdmin, async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(
            req.params.id,
            { isEmailVerified: true, emailVerificationToken: null, emailVerificationExpires: null },
            { new: true }
        ).select('-password');

        if (!user) return res.status(404).json({ error: "Volunteer not found." });
        res.status(200).json({ message: `${user.name}-এর ইমেইল Admin কর্তৃক manually verify করা হলো।`, user });
    } catch (error) {
        console.error("Admin Verify Error:", error.message);
        res.status(500).json({ error: "Failed to verify email." });
    }
});

// একটা কাজ সম্পন্ন হিসেবে মার্ক করা — Points বাড়বে, Rating আপডেট হবে (weighted average দিয়ে, যাতে fair থাকে)
app.patch('/api/admin/volunteers/:id/complete-task', requireAdmin, async (req, res) => {
    try {
        const { pointsAwarded, taskRating } = req.body; // taskRating: এই কাজে ভলান্টিয়ার কেমন করলো (১-৫), ঐচ্ছিক

        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: "Volunteer not found." });

        const points = parseInt(pointsAwarded) || 50; // ডিফল্ট ৫০ পয়েন্ট প্রতি কাজে

        user.completedTasks += 1;
        user.points += points;

        // নতুন rating দেওয়া থাকলে, পুরনো rating-এর সাথে weighted average করে আপডেট (একটা কাজ খারাপ করলেও পুরো rating শূন্য হয়ে যাবে না)
        if (taskRating) {
            const oldTotal = user.rating * (user.completedTasks - 1);
            user.rating = Math.round(((oldTotal + parseFloat(taskRating)) / user.completedTasks) * 10) / 10;
        }

        // 🏆 নতুন stats-এর ভিত্তিতে কোনো badge অর্জিত হলো কিনা চেক করা (আগে এটা কখনো call-ই হতো না)
        const newBadges = checkAndAwardBadges(user);

        await user.save();
        res.status(200).json({
            message: `${user.name}-এর কাজ সম্পন্ন হিসেবে মার্ক করা হলো!` + (newBadges.length ? ` 🎉 নতুন Badge অর্জিত: ${newBadges.map(b => b.name).join(', ')}` : ''),
            user,
            newBadges
        });
    } catch (error) {
        console.error("Complete Task Error:", error.message);
        res.status(500).json({ error: "Failed to update volunteer stats." });
    }
});

// সব SOS Request-এর লিস্ট (Admin Panel-এ দেখানোর জন্য)
app.get('/api/admin/sos', requireAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const totalCount = await SosRequest.countDocuments({});
        const sosRequests = await SosRequest.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit);

        res.status(200).json({
            data: sosRequests,
            currentPage: page,
            totalPages: Math.ceil(totalCount / limit),
            totalCount
        });
    } catch (error) {
        console.error("Admin SOS List Error:", error.message);
        res.status(500).json({ error: "Failed to load SOS requests." });
    }
});

// একটা SOS Request-এ volunteer "আমি সাড়া দিচ্ছি" মার্ক করলে এই endpoint কল হয়
app.post('/api/sos/:id/respond', requireVolunteer, async (req, res) => {
    try {
        const sos = await SosRequest.findById(req.params.id);
        if (!sos) return res.status(404).json({ error: "SOS request not found." });

        if (sos.status === 'resolved') {
            return res.status(400).json({ error: "এই SOS request ইতিমধ্যে resolved হয়ে গেছে।" });
        }

        // একই volunteer দুইবার respond করলে ডুপ্লিকেট এন্ট্রি এড়ানো
        const alreadyResponded = sos.responders.some(r => r.volunteer.toString() === req.volunteer.userId);
        if (alreadyResponded) {
            return res.status(400).json({ error: "আপনি ইতিমধ্যে এই SOS-এ সাড়া দিয়েছেন।" });
        }

        sos.responders.push({ volunteer: req.volunteer.userId, name: req.volunteer.name });
        await sos.save();

        res.status(200).json({
            message: `ধন্যবাদ! আপনার সাড়া রেকর্ড করা হলো। মোট সাড়া দিয়েছে: ${sos.responders.length}/${sos.volunteersNeeded} জন।`,
            respondersCount: sos.responders.length
        });
    } catch (error) {
        console.error("SOS Respond Error:", error.message);
        res.status(500).json({ error: "Failed to record your response." });
    }
});
app.patch('/api/admin/sos/:id/resolve', requireAdmin, async (req, res) => {
    try {
        const sos = await SosRequest.findByIdAndUpdate(req.params.id, { status: 'resolved' }, { new: true });
        if (!sos) return res.status(404).json({ error: "SOS request not found." });
        res.status(200).json({ message: "SOS request resolved হিসেবে মার্ক করা হলো।", sos });
    } catch (error) {
        console.error("SOS Resolve Error:", error.message);
        res.status(500).json({ error: "Failed to resolve SOS request." });
    }
});

// ==========================================================
// 📅 EVENT MANAGEMENT — Admin ইভেন্ট বানাবে, fixed radius-এর মধ্যে থাকা
// volunteer-রাই সেটা map/list-এ দেখতে পারবে
// ==========================================================

// নতুন ইভেন্ট তৈরি (Admin-Only)
app.post('/api/admin/events', requireAdmin, async (req, res) => {
    try {
        const { name, description, eventDateTime, radiusKm, latitude, longitude } = req.body;

        if (latitude === undefined || longitude === undefined) {
            return res.status(400).json({ error: "ইভেন্টের লোকেশন (latitude/longitude) দিতে হবে।" });
        }

        const newEvent = new Event({
            name, description, eventDateTime,
            radiusKm: parseFloat(radiusKm) || 5,
            location: { type: 'Point', coordinates: [parseFloat(longitude), parseFloat(latitude)] }
        });

        await newEvent.save();
        res.status(201).json({ message: "ইভেন্ট সফলভাবে তৈরি হয়েছে!", event: newEvent });
    } catch (error) {
        console.error("Event Create Error:", error.message);
        res.status(500).json({ error: "Failed to create event." });
    }
});

// সব ইভেন্টের লিস্ট (Admin Panel-এ ম্যানেজ করার জন্য)
app.get('/api/admin/events', requireAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const totalCount = await Event.countDocuments({});
        const events = await Event.find({}).sort({ eventDateTime: 1 }).skip(skip).limit(limit);

        res.status(200).json({
            data: events,
            currentPage: page,
            totalPages: Math.ceil(totalCount / limit),
            totalCount
        });
    } catch (error) {
        console.error("Admin Event List Error:", error.message);
        res.status(500).json({ error: "Failed to load events." });
    }
});

// একটা ইভেন্ট ডিলিট করা (Admin-Only)
app.delete('/api/admin/events/:id', requireAdmin, async (req, res) => {
    try {
        await Event.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "ইভেন্ট ডিলিট করা হয়েছে।" });
    } catch (error) {
        console.error("Event Delete Error:", error.message);
        res.status(500).json({ error: "Failed to delete event." });
    }
});

// Volunteer-এর বর্তমান লোকেশনের ভিত্তিতে "কোন কোন ইভেন্টের radius-এর মধ্যে আছে" খুঁজে বের করা
// (প্রতিটা ইভেন্টের radius আলাদা হওয়ায় সহজ Haversine ক্যালকুলেশন দিয়ে চেক করা হচ্ছে, fixed $geoNear maxDistance না)
app.get('/api/events/nearby', requireVolunteer, async (req, res) => {
    try {
        const lat = parseFloat(req.query.lat);
        const lng = parseFloat(req.query.lng);

        if (isNaN(lat) || isNaN(lng)) {
            return res.status(400).json({ error: "Valid lat/lng লাগবে।" });
        }

        const allEvents = await Event.find({});

        const visibleEvents = allEvents
            .map(event => {
                const [eventLng, eventLat] = event.location.coordinates;
                const distanceKm = haversineDistanceKm(lat, lng, eventLat, eventLng);
                return { event, distanceKm };
            })
            .filter(({ event, distanceKm }) => distanceKm <= event.radiusKm) // 👈 মূল শর্ত — volunteer এই ইভেন্টের radius-এর ভেতরে আছে কিনা
            .map(({ event, distanceKm }) => ({
                _id: event._id,
                name: event.name,
                description: event.description,
                eventDateTime: event.eventDateTime,
                radiusKm: event.radiusKm,
                location: event.location,
                distanceKm: Math.round(distanceKm * 10) / 10
            }));

        res.status(200).json(visibleEvents);
    } catch (error) {
        console.error("Nearby Events Error:", error.message);
        res.status(500).json({ error: "Failed to fetch nearby events." });
    }
});

// Server Listen
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});