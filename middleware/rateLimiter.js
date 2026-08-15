// ==========================================================
// 🚦 Lightweight In-Memory Rate Limiter (কোনো external package লাগেনি)
// প্রতিটা key (IP বা email)-এর জন্য একটা টাইমস্ট্যাম্প লিস্ট রাখা হয়,
// window সময়ের মধ্যে limit ছাড়িয়ে গেলে রিকোয়েস্ট block করে দেওয়া হয়
// ==========================================================

const requestLog = new Map(); // key -> [timestamp, timestamp, ...]

// পুরনো এন্ট্রি periodically মেমরি থেকে সাফ করা (মেমরি leak এড়ানোর জন্য)
const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of requestLog.entries()) {
        const recent = timestamps.filter(t => now - t < 60 * 60 * 1000); // ১ ঘণ্টার বেশি পুরনো বাদ
        if (recent.length === 0) {
            requestLog.delete(key);
        } else {
            requestLog.set(key, recent);
        }
    }
}, 15 * 60 * 1000); // প্রতি ১৫ মিনিটে ক্লিনআপ
cleanupInterval.unref(); // 👈 এই টাইমার প্রোগ্রাম বন্ধ হতে বাধা দেবে না

/**
 * @param {number} windowMs - কতক্ষণের মধ্যে limit গণনা হবে (মিলিসেকেন্ডে)
 * @param {number} maxRequests - এই সময়ে সর্বোচ্চ কতবার অনুমতি
 * @param {string} label - error message-এ কী দেখাবে (যেমন "Registration")
 * @param {function} keyFn - req থেকে unique key বানানোর ফাংশন (ডিফল্ট: IP address)
 */
function createRateLimiter(windowMs, maxRequests, label, keyFn = (req) => req.ip) {
    return (req, res, next) => {
        const key = keyFn(req);
        const now = Date.now();

        const timestamps = (requestLog.get(key) || []).filter(t => now - t < windowMs);

        if (timestamps.length >= maxRequests) {
            const retryAfterSec = Math.ceil((windowMs - (now - timestamps[0])) / 1000);
            return res.status(429).json({
                error: `${label}-এর জন্য অনেকবার চেষ্টা করা হয়েছে। অনুগ্রহ করে ${Math.ceil(retryAfterSec / 60)} মিনিট পর আবার চেষ্টা করুন।`
            });
        }

        timestamps.push(now);
        requestLog.set(key, timestamps);
        next();
    };
}

module.exports = { createRateLimiter };
