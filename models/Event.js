const mongoose = require('mongoose');

// ইভেন্টের রূপরেখা (Schema) — Admin কর্তৃক তৈরি করা, fixed radius-এর মধ্যে থাকা volunteer-রাই দেখতে পারবে
const EventSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, required: true },
    eventDateTime: { type: Date, required: true },
    radiusKm: { type: Number, required: true, default: 5 }, // এই radius-এর মধ্যে থাকা volunteer-রাই দেখতে পারবে
    location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], default: [0, 0] } // [longitude, latitude]
    },
    createdAt: { type: Date, default: Date.now }
});

EventSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Event', EventSchema);
