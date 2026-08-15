// ==========================================================
// 📐 Haversine Formula — দুটো GPS কোঅর্ডিনেটের মধ্যে real distance (কিমি) হিসাব করে
// Event-এর radius প্রতিটার জন্য আলাদা হওয়ায় (fixed $geoNear maxDistance না),
// এখানে distance হিসাব করে প্রতিটার নিজের radius-এর সাথে তুলনা করা হবে
// ==========================================================

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
    const R = 6371; // পৃথিবীর radius, কিলোমিটারে
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

module.exports = { haversineDistanceKm };
