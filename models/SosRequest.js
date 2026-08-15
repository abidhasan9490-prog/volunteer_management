const mongoose = require('mongoose');

// জরুরি SOS রিকোয়েস্টের রূপরেখা (Schema)
const SosRequestSchema = new mongoose.Schema({
    category: { type: String, required: true },
    volunteersNeeded: { type: Number, required: true },
    details: { type: String, required: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // লগইন করা থাকলে identity, না থাকলে null (guest)
    requestedByName: { type: String, default: 'Guest' }, // দ্রুত দেখানোর জন্য নাম আলাদাভাবে রাখা হলো
    latitude: { type: Number },
    longitude: { type: Number },
    location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], default: [0, 0] } // [longitude, latitude]
    },
    status: { type: String, enum: ['pending', 'resolved'], default: 'pending' }, // 👈 Admin Panel থেকে resolve মার্ক করার জন্য
    responders: [{
        volunteer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        name: { type: String },
        respondedAt: { type: Date, default: Date.now }
    }], // 👈 কোন কোন volunteer "আমি সাড়া দিচ্ছি" চেপেছে তার ট্র্যাক
    createdAt: { type: Date, default: Date.now }
});

// নিকটবর্তী volunteer-দের real-time notify করার জন্য geospatial index
SosRequestSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('SosRequest', SosRequestSchema);
