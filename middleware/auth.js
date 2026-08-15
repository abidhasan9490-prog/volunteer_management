const crypto = require('crypto');

// ==========================================================
// 🔐 লাইটওয়েট সাইন করা টোকেন সিস্টেম (jsonwebtoken প্যাকেজ ছাড়াই)
// Node.js এর built-in crypto মডিউল ব্যবহার করে HMAC-signed token বানানো হচ্ছে।
// কাজ করে ঠিক JWT-এর মতোই: payload + expiry + secret দিয়ে sign করা signature।
// ==========================================================

const SECRET = process.env.SESSION_SECRET || 'change_this_secret_in_env';
const TOKEN_LIFETIME_MS = 2 * 60 * 60 * 1000; // 2 ঘণ্টা

function createToken(payload) {
    const data = { ...payload, exp: Date.now() + TOKEN_LIFETIME_MS };
    const payloadStr = Buffer.from(JSON.stringify(data)).toString('base64url');
    const signature = crypto.createHmac('sha256', SECRET).update(payloadStr).digest('base64url');
    return `${payloadStr}.${signature}`;
}

function verifyToken(token) {
    if (!token || !token.includes('.')) return null;

    const [payloadStr, signature] = token.split('.');
    const expectedSignature = crypto.createHmac('sha256', SECRET).update(payloadStr).digest('base64url');

    // টোকেন কেউ টেম্পার করেছে কিনা যাচাই
    if (signature !== expectedSignature) return null;

    try {
        const data = JSON.parse(Buffer.from(payloadStr, 'base64url').toString());
        if (Date.now() > data.exp) return null; // মেয়াদ শেষ
        return data;
    } catch (err) {
        return null;
    }
}

// Express middleware — Admin-only রুট প্রটেক্ট করার জন্য
function requireAdmin(req, res, next) {
    const authHeader = req.headers['authorization']; // ফরম্যাট: "Bearer <token>"
    const token = authHeader && authHeader.split(' ')[1];

    const data = verifyToken(token);

    if (!data || !data.isAdmin) {
        return res.status(401).json({ error: 'Unauthorized. Please login as Admin first.' });
    }

    req.admin = data;
    next();
}

// Express middleware — Logged-in Volunteer-only রুট প্রটেক্ট করার জন্য (profile, cert, sos identity)
function requireVolunteer(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    const data = verifyToken(token);

    if (!data || !data.userId) {
        return res.status(401).json({ error: 'Unauthorized. Please login first.' });
    }

    req.volunteer = data; // { userId, name }
    next();
}

// Optional auth — SOS-এর মতো রুটের জন্য, যেখানে লগইন থাকলে identity যুক্ত হবে,
// না থাকলেও রিকোয়েস্ট আটকাবে না (guest হিসেবে চলবে)
function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    const data = verifyToken(token);

    req.volunteer = (data && data.userId) ? data : null;
    next();
}

module.exports = { createToken, verifyToken, requireAdmin, requireVolunteer, optionalAuth };
