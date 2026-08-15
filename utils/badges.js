// ==========================================================
// 🏆 Real Badge System — decorative না, actual completedTasks/points/rating
// এর উপর ভিত্তি করে badge অর্জিত হয়
// ==========================================================

const BADGE_DEFINITIONS = [
    {
        key: 'first_responder',
        name: 'First Responder',
        icon: 'fa-solid fa-seedling',
        criteria: (user) => user.completedTasks >= 1
    },
    {
        key: 'rapid_sos_responder',
        name: 'Rapid SOS Responder',
        icon: 'fa-solid fa-bolt',
        criteria: (user) => user.completedTasks >= 5
    },
    {
        key: 'gold_star_contributor',
        name: 'Gold Star Contributor',
        icon: 'fa-solid fa-award',
        criteria: (user) => user.points >= 500
    },
    {
        key: 'veteran_volunteer',
        name: 'Veteran Volunteer',
        icon: 'fa-solid fa-medal',
        criteria: (user) => user.completedTasks >= 10
    },
    {
        key: 'top_rated',
        name: 'Top Rated',
        icon: 'fa-solid fa-hand-holding-medical',
        criteria: (user) => user.rating >= 4.5 && user.completedTasks >= 3
    }
];

// একটা user document-এর current stats চেক করে যদি নতুন কোনো badge-এর যোগ্যতা অর্জন করে থাকে,
// সেটা user.badges array-তে যুক্ত করে দেয় (ডুপ্লিকেট বাদ দিয়ে)। রিটার্ন করে নতুন অর্জিত badge-এর লিস্ট।
function checkAndAwardBadges(user) {
    const newlyAwarded = [];

    BADGE_DEFINITIONS.forEach(badge => {
        const alreadyHas = user.badges.includes(badge.key);
        if (!alreadyHas && badge.criteria(user)) {
            user.badges.push(badge.key);
            newlyAwarded.push(badge);
        }
    });

    return newlyAwarded;
}

module.exports = { BADGE_DEFINITIONS, checkAndAwardBadges };
