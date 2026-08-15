const crypto = require('crypto');

// ==========================================================
// 🔐 পাসওয়ার্ড হ্যাশিং (bcrypt প্যাকেজ ছাড়াই — Node-এর built-in
// crypto.scrypt দিয়ে, যা bcrypt-এর মতোই নিরাপদ, প্রতি ইউজারের জন্য
// আলাদা random salt সহ)
// ==========================================================

function hashPassword(plainPassword) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(plainPassword, salt, 64).toString('hex');
    return `${salt}:${hash}`; // ডাটাবেসে এই পুরো স্ট্রিংটাই সেভ হবে
}

function verifyPassword(plainPassword, storedValue) {
    if (!storedValue || !storedValue.includes(':')) return false;

    const [salt, originalHash] = storedValue.split(':');
    const hash = crypto.scryptSync(plainPassword, salt, 64).toString('hex');

    // timing-attack প্রতিরোধী তুলনা
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(originalHash, 'hex'));
}

module.exports = { hashPassword, verifyPassword };
