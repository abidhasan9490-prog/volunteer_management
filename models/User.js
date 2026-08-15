const mongoose = require('mongoose');

// ভলান্টিয়ার/ইউজারের তথ্যের রূপরেখা (Schema)
const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // 👈 hashed password (salt:hash ফরম্যাটে সেভ হয়)
    phone: { type: String, required: true },
    district: { type: String, required: true },
    bloodGroup: { type: String },
    dob: { type: Date },
    primarySkill: { type: String },
    experience: { type: Number, default: 0 },       // 👈 বছর হিসেবে অভিজ্ঞতা (AI Matching-এর জন্য)
    rating: { type: Number, default: 5.0 },          // 👈 নতুন ভলান্টিয়ারের ডিফল্ট রেটিং
    completedTasks: { type: Number, default: 0 },    // 👈 সম্পন্ন কাজের সংখ্যা
    points: { type: Number, default: 0 },            // 👈 Leaderboard-এর জন্য (পরে কাজে লাগবে)
    badges: { type: [String], default: [] },         // 👈 real অর্জিত badge-এর কী (যেমন 'first_responder')
    profilePic: { type: String, default: '' },        // 👈 client-side resize করা base64 ছবি (আলাদা storage সার্ভিস ছাড়াই)
    isEmailVerified: { type: Boolean, default: false },
    emailVerificationToken: { type: String, default: null },
    emailVerificationExpires: { type: Date, default: null },
    passwordResetToken: { type: String, default: null },
    passwordResetExpires: { type: Date, default: null },
    location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], default: [0, 0] } // [longitude, latitude] — GeoJSON-এ এই ক্রমেই থাকে
    },
    createdAt: { type: Date, default: Date.now }
});

// GPS Nearby Volunteer ফিচারের জন্য geospatial index — এটা ছাড়া $geoNear কাজ করবে না
UserSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('User', UserSchema);