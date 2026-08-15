// ====================================================
// GLOBAL STATE
// ====================================================

let map;
let userMarker;
let userCurrentLat = 24.9667; // Mokamtola/Bogura Lat
let userCurrentLng = 89.3667; // Mokamtola/Bogura Lng

// লগইন করা ভলান্টিয়ারের real প্রোফাইল ডেটা এখানে রাখা হবে (Certificate/Profile-এর জন্য)
let loggedInVolunteer = null;

// Page Load Initializer
window.onload = function() {
    initLeafletMap();
    checkAdminSession();     // আগে থেকে Admin লগইন থাকলে matching panel দেখাবে
    checkVolunteerSession(); // আগে থেকে Volunteer লগইন থাকলে profile panel দেখাবে
    renderLeaderboard();
};




// ====================================================
// 📍 1. GPS-BASED NEARBY VOLUNTEER ASSIGNMENT
// ====================================================

function initLeafletMap() {
    map = L.map('leaflet-map').setView([userCurrentLat, userCurrentLng], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    userMarker = L.marker([userCurrentLat, userCurrentLng]).addTo(map)
        .bindPopup("<b>Headquarters Area: বগুড়া (মোকামতলা)</b><br>লাইভ লোকেশন পাওয়ার জন্য 'Fetch My Live Location' এ ক্লিক করুন।")
        .openPopup();
}

// ====================================================
// 📍 Live GPS Tracking (watchPosition — continuous, one-shot না)
// ====================================================

let locationWatchId = null;   // watchPosition-এর ID, বন্ধ করার সময় লাগবে
let lastNearbyFetchTime = 0;  // থ্রটলিং — প্রতি ছোট মুভমেন্টে বার বার backend কল না করার জন্য

function startLiveLocationTracking() {
    const locationStatusText = document.getElementById('location-text');
    const volunteerToken = localStorage.getItem('volunteerToken');

    if (!volunteerToken) {
        alert('⚠️ Live Tracking শুরু করতে আগে Volunteer Login করুন (Leaderboard সেকশনে)।');
        return;
    }

    if (!navigator.geolocation) {
        alert("আপনার ব্রাউজারটি জিপিএস ফিচার সাপোর্ট করছে না।");
        return;
    }

    if (locationWatchId !== null) {
        return; // আগে থেকেই ট্র্যাকিং চলছে, ডুপ্লিকেট watcher বসানোর দরকার নেই
    }

    locationStatusText.innerHTML = "⌛ Location permission চাওয়া হচ্ছে...";

    // watchPosition = লোকেশন বদলালেই বার বার callback রান হবে (real-time/live tracking)
    locationWatchId = navigator.geolocation.watchPosition(
        (position) => {
            userCurrentLat = position.coords.latitude;
            userCurrentLng = position.coords.longitude;

            locationStatusText.innerHTML = `🟢 LIVE — Lat: ${userCurrentLat.toFixed(4)}, Lng: ${userCurrentLng.toFixed(4)}`;
            locationStatusText.style.color = "#059669";

            if (userMarker) {
                map.removeLayer(userMarker);
            }
            userMarker = L.marker([userCurrentLat, userCurrentLng]).addTo(map)
                .bindPopup("<b>আপনার বর্তমান লাইভ অবস্থান</b><br>Together For Bangladesh জিপিএস নেটওয়ার্ক।");

            // থ্রটল করা — প্রতি ১৫ সেকেন্ডে একবার backend-কে জিজ্ঞেস করা, প্রতি GPS jitter-এ না
            const now = Date.now();
            if (now - lastNearbyFetchTime > 15000) {
                lastNearbyFetchTime = now;
                map.setView([userCurrentLat, userCurrentLng], 14);
                plotNearbyVolunteers(userCurrentLat, userCurrentLng);
                plotNearbyEvents(userCurrentLat, userCurrentLng); // 👈 নিজের radius-এর মধ্যে থাকা ইভেন্ট automatic map-এ দেখানো
            }
        },
        (error) => {
            locationStatusText.innerHTML = "❌ Location permission denied!";
            locationStatusText.style.color = "#dc2626";
        },
        { enableHighAccuracy: true, maximumAge: 5000 }
    );

    startSosAlertPolling(); // 👈 লোকেশন ট্র্যাকিং শুরু হওয়ার সাথে সাথেই নিকটবর্তী SOS alert polling-ও শুরু
}

function stopLiveLocationTracking() {
    if (locationWatchId !== null) {
        navigator.geolocation.clearWatch(locationWatchId);
        locationWatchId = null;
    }
    document.getElementById('location-text').innerHTML = 'Location Status: Stopped';
    document.getElementById('location-text').style.color = '';

    if (nearbyMarkersLayer) {
        map.removeLayer(nearbyMarkersLayer);
        nearbyMarkersLayer = null;
    }
    document.getElementById('gps-nearby-list').innerHTML = '';

    if (nearbyEventsLayer) {
        map.removeLayer(nearbyEventsLayer);
        nearbyEventsLayer = null;
    }
    document.getElementById('gps-nearby-events-list').innerHTML = '';

    stopSosAlertPolling(); // 👈 ট্র্যাকিং বন্ধ হলে SOS polling-ও বন্ধ হবে
}

// ====================================================
// 🔔 Real-time Nearby SOS Alerts (Polling-based Browser Notification)
// সত্যিকারের push notification-এর জন্য 'web-push' npm package + VAPID key লাগে,
// যা internet ছাড়া install করা সম্ভব হয়নি — তাই ব্রাউজার ট্যাব খোলা থাকা অবস্থায়
// এই polling-ভিত্তিক পদ্ধতিতে real-time notification দেওয়া হচ্ছে।
// ====================================================

let sosAlertIntervalId = null;
const activeSosAlerts = new Map(); // sosId -> alert data, respond বাটন সহ persistent list দেখানোর জন্য
let lastSosCheckTimestamp = Date.now();

function startSosAlertPolling() {
    if (sosAlertIntervalId !== null) return; // ইতিমধ্যে চলছে

    // ব্রাউজার Notification permission চাওয়া (একবারই)
    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
    }

    sosAlertIntervalId = setInterval(checkNearbySosAlerts, 12000); // প্রতি ১২ সেকেন্ডে চেক
    checkNearbySosAlerts(); // প্রথমবার সাথে সাথেই চেক করা
}

function stopSosAlertPolling() {
    if (sosAlertIntervalId !== null) {
        clearInterval(sosAlertIntervalId);
        sosAlertIntervalId = null;
    }
    activeSosAlerts.clear();
    const container = document.getElementById('sos-alerts-active-list');
    if (container) container.innerHTML = '<p style="color:#94a3b8; font-size:13px;">এখনো কোনো নতুন SOS alert নেই।</p>';
}

async function checkNearbySosAlerts() {
    const volunteerToken = localStorage.getItem('volunteerToken');
    if (!volunteerToken) {
        stopSosAlertPolling();
        return;
    }

    const radiusKm = document.getElementById('gps-radius-km') ? document.getElementById('gps-radius-km').value : 5;

    try {
        const response = await fetch(
            `${API_BASE}/api/sos/nearby-alerts?lat=${userCurrentLat}&lng=${userCurrentLng}&radiusKm=${radiusKm}&since=${lastSosCheckTimestamp}`,
            { headers: { 'Authorization': `Bearer ${volunteerToken}` } }
        );

        if (!response.ok) return; // সাইলেন্টলি স্কিপ — polling ব্যর্থ হলে বিরক্তিকর error দেখানোর দরকার নেই

        const alerts = await response.json();
        lastSosCheckTimestamp = Date.now();

        alerts.forEach(alert => {
            activeSosAlerts.set(alert._id, alert); // 👈 persistent list-এ যুক্ত/আপডেট করা (respond বাটন দিয়ে ব্যবহারযোগ্য)

            // Browser Notification (ট্যাব active/background যেকোনো অবস্থায় দেখাবে, শুধু ব্রাউজার/ট্যাব বন্ধ থাকলে দেখাবে না)
            if ("Notification" in window && Notification.permission === "granted") {
                new Notification(`🚨 জরুরি SOS: ${alert.category}`, {
                    body: `${alert.details}\nদূরত্ব: ${alert.distanceKm} কিমি | প্রয়োজন: ${alert.volunteersNeeded} জন`,
                });
            } else {
                // Notification permission না থাকলেও অন্তত alert() দিয়ে জানানো
                console.log(`🚨 নতুন নিকটবর্তী SOS: ${alert.category} (${alert.distanceKm} কিমি দূরে)`);
            }
        });

        if (alerts.length > 0) {
            renderActiveSosAlerts();
        }
    } catch (error) {
        console.error('SOS Alert Polling Error:', error);
    }
}

// নিকটবর্তী active SOS alert-গুলো persistent list-এ রেন্ডার করা (respond বাটন সহ)
function renderActiveSosAlerts() {
    const container = document.getElementById('sos-alerts-active-list');

    if (activeSosAlerts.size === 0) {
        container.innerHTML = '<p style="color:#94a3b8; font-size:13px;">এখনো কোনো নতুন SOS alert নেই।</p>';
        return;
    }

    container.innerHTML = '';
    activeSosAlerts.forEach((alert, sosId) => {
        const card = document.createElement('div');
        card.className = 'volunteer-ai-card';
        card.id = `sos-alert-card-${sosId}`;
        card.innerHTML = `
            <h4>🚨 ${alert.category} <span style="font-size:13px; color:#64748b;">(${alert.distanceKm} কিমি দূরে)</span></h4>
            <p>${alert.details}</p>
            <p style="font-size:13px; color:#0d9488;">👥 প্রয়োজন: ${alert.volunteersNeeded} জন | 🙋 এখনো সাড়া দিয়েছে: ${alert.respondersCount || 0} জন</p>
            <button onclick="respondToSos('${sosId}')" class="btn-sm">🙋 আমি সাড়া দিচ্ছি</button>
        `;
        container.appendChild(card);
    });
}

async function respondToSos(sosId) {
    const volunteerToken = localStorage.getItem('volunteerToken');

    try {
        const response = await fetch(`${API_BASE}/api/sos/${sosId}/respond`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${volunteerToken}` }
        });
        const result = await response.json();

        if (response.ok) {
            alert('✅ ' + result.message);
            activeSosAlerts.delete(sosId); // 👈 respond করার পর লিস্ট থেকে সরিয়ে দেওয়া
            renderActiveSosAlerts();
        } else {
            alert('❌ ' + result.error);
        }
    } catch (error) {
        console.error('Respond To SOS Error:', error);
        alert('❌ Server-এর সাথে যোগাযোগ করা যাচ্ছে না।');
    }
}

// পুরনো nearby marker গুলো ক্লিয়ার করে নতুনগুলো বসানোর জন্য layer group
let nearbyMarkersLayer;
let nearbyEventsLayer;

async function plotNearbyVolunteers(lat, lng) {
    const noticeBox = document.getElementById('gps-login-notice');
    const listBox = document.getElementById('gps-nearby-list');
    const radiusKm = document.getElementById('gps-radius-km').value || 5;

    const volunteerToken = localStorage.getItem('volunteerToken');

    if (!volunteerToken) {
        // Login করা নেই — privacy সুরক্ষার জন্য real ডেটা দেখানো হবে না
        noticeBox.style.display = 'block';
        listBox.innerHTML = '';
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/volunteers/nearby?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}`, {
            headers: { 'Authorization': `Bearer ${volunteerToken}` }
        });

        if (response.status === 401) {
            noticeBox.style.display = 'block';
            listBox.innerHTML = '<p>⚠️ সেশনের মেয়াদ শেষ, আবার লগইন করুন।</p>';
            stopLiveLocationTracking();
            return;
        }

        const nearbyVolunteers = await response.json();
        noticeBox.style.display = 'none';

        // আগের marker গুলো ক্লিয়ার করা
        if (nearbyMarkersLayer) {
            map.removeLayer(nearbyMarkersLayer);
        }
        nearbyMarkersLayer = L.layerGroup().addTo(map);

        if (nearbyVolunteers.length === 0) {
            listBox.innerHTML = `<p>এই ${radiusKm} কিমি এলাকায় কোনো ভলান্টিয়ার পাওয়া যায়নি।</p>`;
            return;
        }

        listBox.innerHTML = `<h4>📍 ${nearbyVolunteers.length} জন ভলান্টিয়ার পাওয়া গেছে (${radiusKm} কিমি-এর মধ্যে, Live আপডেট হচ্ছে):</h4>`;

        nearbyVolunteers.forEach(vol => {
            const [volLng, volLat] = vol.location.coordinates;

            L.circleMarker([volLat, volLng], {
                color: '#dc2626',
                radius: 8,
                fillOpacity: 0.8
            }).addTo(nearbyMarkersLayer).bindPopup(`<b>${vol.name}</b><br>স্কিল: ${vol.primarySkill}<br>দূরত্ব: ${vol.distanceKm} কিলোমিটার`);

            const card = document.createElement('div');
            card.className = 'volunteer-ai-card';
            card.innerHTML = `<h4>${vol.name}</h4><p>📞 ${vol.phone} | 🎯 ${vol.primarySkill} | 📏 ${vol.distanceKm} কিমি দূরে</p>`;
            listBox.appendChild(card);
        });
    } catch (error) {
        console.error('Nearby Search Error:', error);
        listBox.innerHTML = '<p>❌ Server-এর সাথে যোগাযোগ করা যাচ্ছে না।</p>';
    }
}




// ====================================================
// 🚨 2. EMERGENCY SOS REQUEST SYSTEM
// ====================================================

async function triggerSOS() {
    const category = document.getElementById('sos-category').value;
    const requiredVolunteers = document.getElementById('sos-volunteers-needed').value;
    const details = document.getElementById('sos-details').value;

    const sosAlertBox = document.getElementById('sos-status-box');
    const sosTitle = document.getElementById('sos-status-title');
    const sosDesc = document.getElementById('sos-status-desc');

    // Backend-এ real SOS request সেভ করা (লগইন থাকলে identity যুক্ত হবে, না থাকলে Guest)
    const volunteerToken = localStorage.getItem('volunteerToken');
    try {
        const response = await fetch(`${API_BASE}/api/sos`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(volunteerToken ? { 'Authorization': `Bearer ${volunteerToken}` } : {})
            },
            body: JSON.stringify({
                category,
                volunteersNeeded: requiredVolunteers,
                details,
                latitude: userCurrentLat,
                longitude: userCurrentLng
            })
        });

        if (!response.ok) {
            const result = await response.json();
            alert('❌ SOS সেভ করতে সমস্যা হয়েছে: ' + result.error);
            return;
        }
    } catch (error) {
        console.error('SOS Save Error:', error);
        alert('❌ Server-এর সাথে যোগাযোগ করা যাচ্ছে না। SOS পাঠানো যায়নি।');
        return;
    }

    sosAlertBox.classList.remove('hidden');
    sosTitle.innerHTML = `🚨 EMERGENCY BROADCAST SENT! [${category}]`;
    sosDesc.innerHTML = `নিকটস্থ ৫ কিলোমিটারের ভেতরে থাকা ভলান্টিয়ারদের মোবাইল ফোনে নোটিফিকেশন পাঠানো হয়েছে। প্রয়োজনীয় ভলান্টিয়ার: ${requiredVolunteers} জন।`;

    if ("Notification" in window) {
        if (Notification.permission === "granted") {
            new Notification("🚨 Emergency SOS Triggered!", {
                body: `${category}: ${details}`,
            });
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission().then(permission => {
                if (permission === "granted") {
                    new Notification("🚨 Emergency SOS Triggered!", {
                        body: `${category}: ${details}`,
                    });
                }
            });
        }
    }

    alert(`জরুরি SOS ব্রডকাস্ট সফলভাবে পাঠানো হয়েছে!\nক্যাটাগরি: ${category}\nঅবস্থান: GPS Coordinate (${userCurrentLat.toFixed(4)}, ${userCurrentLng.toFixed(4)})`);
}


// ====================================================
// 🤖 3. AI-BASED VOLUNTEER MATCHING ENGINE (Real Backend + Admin Login)
// ====================================================

const API_BASE = window.location.origin; // 👈 frontend আর backend একই সার্ভারে serve হয়, তাই deploy করা URL নিজেই ধরবে

// পেজ লোড হলে চেক করি আগে থেকে valid admin token আছে কিনা (localStorage-এ)
function checkAdminSession() {
    const token = localStorage.getItem('adminToken');
    if (token) {
        showMatchingPanel();
    }
}

function showMatchingPanel() {
    document.getElementById('ai-admin-login-box').classList.add('hidden');
    document.getElementById('ai-matching-panel').classList.remove('hidden');
    document.getElementById('admin-panel-section').classList.remove('hidden'); // 👈 Admin Panel-ও দেখানো হবে
    runAIMatchingEngine();
    loadAdminPanel();
}

function adminLogout() {
    localStorage.removeItem('adminToken');
    document.getElementById('ai-admin-login-box').classList.remove('hidden');
    document.getElementById('ai-matching-panel').classList.add('hidden');
    document.getElementById('admin-panel-section').classList.add('hidden'); // 👈 Admin Panel hide হয়ে যাবে
    document.getElementById('admin-username').value = '';
    document.getElementById('admin-password').value = '';
}

async function adminLogin() {
    const username = document.getElementById('admin-username').value;
    const password = document.getElementById('admin-password').value;
    const errorBox = document.getElementById('admin-login-error');
    errorBox.innerText = '';

    try {
        const response = await fetch(`${API_BASE}/api/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const result = await response.json();

        if (response.ok) {
            localStorage.setItem('adminToken', result.token); // 👈 টোকেন সেভ করা হলো
            showMatchingPanel();
        } else {
            errorBox.innerText = '❌ ' + result.error;
        }
    } catch (error) {
        console.error('Admin Login Error:', error);
        errorBox.innerText = '❌ Server-এর সাথে যোগাযোগ করা যাচ্ছে না।';
    }
}

// ====================================================
// 🛠️ ADMIN PANEL — Volunteer Management + SOS Resolution
// ====================================================

// Admin Panel-এর ৩টা লিস্টের জন্য current page ট্র্যাক করা
let adminVolunteersPage = 1;
let adminSosPage = 1;
let adminEventsPage = 1;

// Prev/Next বাটন সহ pagination controls বানানোর reusable helper
function renderPaginationControls(containerId, currentPage, totalPages, onPageChange) {
    const existing = document.getElementById(containerId);
    if (existing) existing.remove();

    if (totalPages <= 1) return; // ১ পেজের কম হলে controls দেখানোর দরকার নেই

    const wrapper = document.createElement('div');
    wrapper.id = containerId;
    wrapper.style.display = 'flex';
    wrapper.style.gap = '10px';
    wrapper.style.alignItems = 'center';
    wrapper.style.marginTop = '10px';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'btn-sm';
    prevBtn.innerText = '◀ Prev';
    prevBtn.disabled = currentPage <= 1;
    prevBtn.onclick = () => onPageChange(currentPage - 1);

    const pageLabel = document.createElement('span');
    pageLabel.innerText = `Page ${currentPage} / ${totalPages}`;

    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn-sm';
    nextBtn.innerText = 'Next ▶';
    nextBtn.disabled = currentPage >= totalPages;
    nextBtn.onclick = () => onPageChange(currentPage + 1);

    wrapper.appendChild(prevBtn);
    wrapper.appendChild(pageLabel);
    wrapper.appendChild(nextBtn);

    return wrapper;
}

async function loadAdminPanel() {
    const adminToken = localStorage.getItem('adminToken');
    if (!adminToken) return;

    await loadAdminVolunteers();
    await loadAdminSosList();
    await loadAdminEvents();
}

async function loadAdminVolunteers(page = adminVolunteersPage) {
    adminVolunteersPage = page;
    const adminToken = localStorage.getItem('adminToken');
    const container = document.getElementById('admin-volunteers-list');
    container.innerHTML = '⌛ Loading volunteers...';

    try {
        const response = await fetch(`${API_BASE}/api/admin/volunteers?page=${page}&limit=10`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        const result = await response.json();
        const volunteers = result.data || [];

        if (volunteers.length === 0) {
            container.innerHTML = '<p>এখনো কোনো ভলান্টিয়ার নেই।</p>';
            return;
        }

        container.innerHTML = '';
        volunteers.forEach(vol => {
            const row = document.createElement('div');
            row.className = 'volunteer-ai-card';
            const verifiedBadge = vol.isEmailVerified
                ? '<span style="color:#059669;">✅ Email Verified</span>'
                : `<span style="color:#dc2626;">❌ Not Verified</span> <button onclick="adminVerifyEmail('${vol._id}')" class="btn-sm">Manually Verify</button>`;
            row.innerHTML = `
                <h4>${vol.name} <span style="font-size:13px; color:#64748b;">(${vol.district}, ${vol.primarySkill})</span></h4>
                <p>⭐ Rating: ${vol.rating} | ✅ Completed: ${vol.completedTasks} | 🏆 Points: ${vol.points} | ${verifiedBadge}</p>
                <div style="display:flex; gap:8px; align-items:center; margin-top:6px;">
                    <input type="number" id="points-${vol._id}" placeholder="Points" value="50" style="width:80px;">
                    <input type="number" id="rating-${vol._id}" placeholder="Task Rating (1-5)" min="1" max="5" style="width:130px;">
                    <button onclick="completeTask('${vol._id}')" class="btn-sm">✅ Mark Task Complete</button>
                </div>
            `;
            container.appendChild(row);
        });

        const paginationEl = renderPaginationControls('volunteers-pagination', result.currentPage, result.totalPages, (newPage) => loadAdminVolunteers(newPage));
        if (paginationEl) container.appendChild(paginationEl);
    } catch (error) {
        console.error('Admin Volunteers Load Error:', error);
        container.innerHTML = '<p>❌ Server-এর সাথে যোগাযোগ করা যাচ্ছে না।</p>';
    }
}

async function adminVerifyEmail(volunteerId) {
    const adminToken = localStorage.getItem('adminToken');

    try {
        const response = await fetch(`${API_BASE}/api/admin/volunteers/${volunteerId}/verify-email`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        const result = await response.json();

        if (response.ok) {
            alert('✅ ' + result.message);
            loadAdminVolunteers();
        } else {
            alert('❌ ' + result.error);
        }
    } catch (error) {
        console.error('Admin Verify Email Error:', error);
        alert('❌ Server-এর সাথে যোগাযোগ করা যাচ্ছে না।');
    }
}

async function completeTask(volunteerId) {
    const adminToken = localStorage.getItem('adminToken');
    const pointsAwarded = document.getElementById(`points-${volunteerId}`).value || 50;
    const taskRating = document.getElementById(`rating-${volunteerId}`).value;

    try {
        const response = await fetch(`${API_BASE}/api/admin/volunteers/${volunteerId}/complete-task`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            body: JSON.stringify({ pointsAwarded, taskRating })
        });

        const result = await response.json();

        if (response.ok) {
            alert('✅ ' + result.message);
            loadAdminVolunteers(); // লিস্ট রিফ্রেশ
            renderLeaderboard();   // Leaderboard-ও আপডেট হবে
        } else {
            alert('❌ ' + result.error);
        }
    } catch (error) {
        console.error('Complete Task Error:', error);
        alert('❌ Server-এর সাথে যোগাযোগ করা যাচ্ছে না।');
    }
}

async function loadAdminSosList(page = adminSosPage) {
    adminSosPage = page;
    const adminToken = localStorage.getItem('adminToken');
    const container = document.getElementById('admin-sos-list');
    container.innerHTML = '⌛ Loading SOS requests...';

    try {
        const response = await fetch(`${API_BASE}/api/admin/sos?page=${page}&limit=10`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        const result = await response.json();
        const sosRequests = result.data || [];

        if (sosRequests.length === 0) {
            container.innerHTML = '<p>এখনো কোনো SOS Request নেই।</p>';
            return;
        }

        container.innerHTML = '';
        sosRequests.forEach(sos => {
            const row = document.createElement('div');
            row.className = 'volunteer-ai-card';
            const statusColor = sos.status === 'resolved' ? '#059669' : '#dc2626';
            const responderNames = (sos.responders && sos.responders.length > 0)
                ? sos.responders.map(r => r.name).join(', ')
                : 'এখনো কেউ সাড়া দেয়নি';
            row.innerHTML = `
                <h4>${sos.category} <span style="color:${statusColor}; font-size:13px;">[${sos.status.toUpperCase()}]</span></h4>
                <p>${sos.details}</p>
                <p style="font-size:13px; color:#64748b;">👤 ${sos.requestedByName} | 👥 প্রয়োজন: ${sos.volunteersNeeded} জন | 🕐 ${new Date(sos.createdAt).toLocaleString('bn-BD')}</p>
                <p style="font-size:13px; color:#0d9488;">🙋 সাড়া দিয়েছে (${sos.responders ? sos.responders.length : 0}/${sos.volunteersNeeded}): ${responderNames}</p>
                ${sos.status === 'pending' ? `<button onclick="resolveSos('${sos._id}')" class="btn-sm">✅ Resolved মার্ক করুন</button>` : ''}
            `;
            container.appendChild(row);
        });

        const paginationEl = renderPaginationControls('sos-pagination', result.currentPage, result.totalPages, (newPage) => loadAdminSosList(newPage));
        if (paginationEl) container.appendChild(paginationEl);
    } catch (error) {
        console.error('Admin SOS Load Error:', error);
        container.innerHTML = '<p>❌ Server-এর সাথে যোগাযোগ করা যাচ্ছে না।</p>';
    }
}

async function resolveSos(sosId) {
    const adminToken = localStorage.getItem('adminToken');

    try {
        const response = await fetch(`${API_BASE}/api/admin/sos/${sosId}/resolve`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });

        const result = await response.json();

        if (response.ok) {
            loadAdminSosList(); // লিস্ট রিফ্রেশ
        } else {
            alert('❌ ' + result.error);
        }
    } catch (error) {
        console.error('Resolve SOS Error:', error);
        alert('❌ Server-এর সাথে যোগাযোগ করা যাচ্ছে না।');
    }
}

// ====================================================
// 📅 EVENT MANAGEMENT (Admin Panel) — fixed radius-এর মধ্যে থাকা volunteer-রাই দেখবে
// ====================================================

function captureEventLocation() {
    const statusText = document.getElementById('event-location-status');

    if (!navigator.geolocation) {
        statusText.innerText = '❌ ব্রাউজার GPS সাপোর্ট করে না।';
        return;
    }

    statusText.innerText = '⌛ লোকেশন খোঁজা হচ্ছে...';
    navigator.geolocation.getCurrentPosition(
        (position) => {
            document.getElementById('event-latitude').value = position.coords.latitude;
            document.getElementById('event-longitude').value = position.coords.longitude;
            statusText.innerText = `✅ ক্যাপচার হয়েছে (${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)})`;
            statusText.style.color = '#059669';
        },
        (error) => {
            statusText.innerText = '❌ লোকেশন পারমিশন দেওয়া হয়নি।';
            statusText.style.color = '#dc2626';
        }
    );
}

async function createEvent() {
    const adminToken = localStorage.getItem('adminToken');
    const lat = document.getElementById('event-latitude').value;
    const lng = document.getElementById('event-longitude').value;

    if (!lat || !lng) {
        alert('⚠️ প্রথমে "ইভেন্টের লোকেশন ক্যাপচার করুন" বাটনে ক্লিক করুন।');
        return;
    }

    const eventData = {
        name: document.getElementById('event-name').value,
        description: document.getElementById('event-description').value,
        eventDateTime: document.getElementById('event-datetime').value,
        radiusKm: document.getElementById('event-radius').value,
        latitude: parseFloat(lat),
        longitude: parseFloat(lng)
    };

    try {
        const response = await fetch(`${API_BASE}/api/admin/events`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            body: JSON.stringify(eventData)
        });

        const result = await response.json();

        if (response.ok) {
            alert('✅ ' + result.message);
            document.getElementById('event-name').value = '';
            document.getElementById('event-description').value = '';
            document.getElementById('event-datetime').value = '';
            document.getElementById('event-location-status').innerText = 'এখনো লোকেশন ক্যাপচার করা হয়নি';
            document.getElementById('event-latitude').value = '';
            document.getElementById('event-longitude').value = '';
            loadAdminEvents();
        } else {
            alert('❌ ' + result.error);
        }
    } catch (error) {
        console.error('Create Event Error:', error);
        alert('❌ Server-এর সাথে যোগাযোগ করা যাচ্ছে না।');
    }
}

async function loadAdminEvents(page = adminEventsPage) {
    adminEventsPage = page;
    const adminToken = localStorage.getItem('adminToken');
    const container = document.getElementById('admin-events-list');
    container.innerHTML = '⌛ Loading events...';

    try {
        const response = await fetch(`${API_BASE}/api/admin/events?page=${page}&limit=10`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        const result = await response.json();
        const events = result.data || [];

        if (events.length === 0) {
            container.innerHTML = '<p>এখনো কোনো ইভেন্ট নেই।</p>';
            return;
        }

        container.innerHTML = '';
        events.forEach(ev => {
            const row = document.createElement('div');
            row.className = 'volunteer-ai-card';
            row.innerHTML = `
                <h4>${ev.name} <span style="font-size:13px; color:#64748b;">(Radius: ${ev.radiusKm} কিমি)</span></h4>
                <p>${ev.description}</p>
                <p style="font-size:13px; color:#64748b;">🕐 ${new Date(ev.eventDateTime).toLocaleString('bn-BD')}</p>
                <button onclick="deleteEvent('${ev._id}')" class="btn-sm">🗑️ ডিলিট করুন</button>
            `;
            container.appendChild(row);
        });

        const paginationEl = renderPaginationControls('events-pagination', result.currentPage, result.totalPages, (newPage) => loadAdminEvents(newPage));
        if (paginationEl) container.appendChild(paginationEl);
    } catch (error) {
        console.error('Admin Events Load Error:', error);
        container.innerHTML = '<p>❌ Server-এর সাথে যোগাযোগ করা যাচ্ছে না।</p>';
    }
}

async function deleteEvent(eventId) {
    const adminToken = localStorage.getItem('adminToken');

    try {
        await fetch(`${API_BASE}/api/admin/events/${eventId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        loadAdminEvents();
    } catch (error) {
        console.error('Delete Event Error:', error);
        alert('❌ Server-এর সাথে যোগাযোগ করা যাচ্ছে না।');
    }
}

// Volunteer-এর জন্য — তার radius-এর মধ্যে থাকা ইভেন্ট খুঁজে map + list-এ দেখানো
async function plotNearbyEvents(lat, lng) {
    const listBox = document.getElementById('gps-nearby-events-list');
    const volunteerToken = localStorage.getItem('volunteerToken');
    if (!volunteerToken) return;

    try {
        const response = await fetch(`${API_BASE}/api/events/nearby?lat=${lat}&lng=${lng}`, {
            headers: { 'Authorization': `Bearer ${volunteerToken}` }
        });

        if (!response.ok) return;

        const events = await response.json();

        if (nearbyEventsLayer) {
            map.removeLayer(nearbyEventsLayer);
        }
        nearbyEventsLayer = L.layerGroup().addTo(map);

        if (events.length === 0) {
            listBox.innerHTML = '';
            return;
        }

        listBox.innerHTML = `<h4>📅 আপনার এলাকায় ${events.length}টি ইভেন্ট চলছে:</h4>`;

        events.forEach(ev => {
            const [evLng, evLat] = ev.location.coordinates;

            L.circleMarker([evLat, evLng], {
                color: '#2563eb', // নীল রঙ — SOS/volunteer marker (লাল) থেকে আলাদা করার জন্য
                radius: 10,
                fillOpacity: 0.7
            }).addTo(nearbyEventsLayer).bindPopup(`<b>📅 ${ev.name}</b><br>${ev.description}<br>দূরত্ব: ${ev.distanceKm} কিমি`);

            const card = document.createElement('div');
            card.className = 'volunteer-ai-card';
            card.innerHTML = `<h4>📅 ${ev.name}</h4><p>${ev.description} | 📏 ${ev.distanceKm} কিমি দূরে | 🕐 ${new Date(ev.eventDateTime).toLocaleString('bn-BD')}</p>`;
            listBox.appendChild(card);
        });
    } catch (error) {
        console.error('Nearby Events Error:', error);
    }
}


// লগইনের পর প্রতিবার filter change হলে, বা প্যানেল দেখানোর সময় এটা রান হয়
async function runAIMatchingEngine() {
    const token = localStorage.getItem('adminToken');
    if (!token) return; // লগইন করা না থাকলে কিছুই করবে না

    const reqSkill = document.getElementById('ai-req-skill').value;
    const reqExp = document.getElementById('ai-req-exp').value;
    const container = document.getElementById('ai-matched-volunteers');

    container.innerHTML = '<p>⌛ Loading real volunteer matches...</p>';

    try {
        const response = await fetch(`${API_BASE}/api/volunteers/match?skill=${reqSkill}&experience=${reqExp}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        // টোকেনের মেয়াদ শেষ হয়ে গেলে বা invalid হলে আবার লগইন চাওয়া
        if (response.status === 401) {
            localStorage.removeItem('adminToken');
            document.getElementById('ai-admin-login-box').classList.remove('hidden');
            document.getElementById('ai-matching-panel').classList.add('hidden');
            document.getElementById('admin-login-error').innerText = '⚠️ সেশনের মেয়াদ শেষ, আবার লগইন করুন।';
            return;
        }

        const scoredVolunteers = await response.json();
        container.innerHTML = '';

        if (scoredVolunteers.length === 0) {
            container.innerHTML = '<p>এখনো কোনো ভলান্টিয়ার রেজিস্ট্রেশন করেননি।</p>';
            return;
        }

        scoredVolunteers.forEach(vol => {
            const card = document.createElement('div');
            card.className = 'volunteer-ai-card';
            card.innerHTML = `
                <span class="ai-score-tag">🎯 ${vol.matchScore}% Match</span>
                <h3>${vol.name}</h3>
                <p><strong>জেলা:</strong> ${vol.district}</p>
                <p><strong>অভিজ্ঞতা:</strong> ${vol.experience} বছর</p>
                <p><strong>রেটিং:</strong> ⭐ ${vol.rating}</p>
                <p><strong>কাজের সংখ্যা:</strong> ${vol.completedTasks}টি সম্পূর্ণ</p>
            `;
            container.appendChild(card);
        });
    } catch (error) {
        console.error('Matching Error:', error);
        container.innerHTML = '<p>❌ Server-এর সাথে যোগাযোগ করা যাচ্ছে না।</p>';
    }
}


// ====================================================
// 🏆 4. REPUTATION, LEADERBOARD, VOLUNTEER LOGIN & DYNAMIC CERTIFICATE
// ====================================================

// পেজ লোডে আগে থেকে Volunteer লগইন থাকলে প্রোফাইল প্যানেল দেখানো
function checkVolunteerSession() {
    const token = localStorage.getItem('volunteerToken');
    if (token) {
        loadVolunteerProfile();
    }
}

async function volunteerLogin() {
    const email = document.getElementById('volunteer-email').value;
    const password = document.getElementById('volunteer-password').value;
    const errorBox = document.getElementById('volunteer-login-error');
    const resendBtn = document.getElementById('resend-verification-btn');
    errorBox.innerText = '';
    resendBtn.classList.add('hidden');

    try {
        const response = await fetch(`${API_BASE}/api/volunteer/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const result = await response.json();

        if (response.ok) {
            localStorage.setItem('volunteerToken', result.token);
            await loadVolunteerProfile();
        } else {
            errorBox.innerText = '❌ ' + result.error;
            if (result.needsVerification) {
                resendBtn.classList.remove('hidden'); // 👈 email verify করা না থাকলে Resend বাটন দেখানো
            }
        }
    } catch (error) {
        console.error('Volunteer Login Error:', error);
        errorBox.innerText = '❌ Server-এর সাথে যোগাযোগ করা যাচ্ছে না।';
    }
}

async function resendVerificationEmail() {
    const email = document.getElementById('volunteer-email').value;
    if (!email) {
        alert('⚠️ প্রথমে Email ফিল্ডে আপনার ইমেইল লিখুন।');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/volunteer/resend-verification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const result = await response.json();
        alert(response.ok ? '✅ ' + result.message : '❌ ' + result.error);
    } catch (error) {
        console.error('Resend Verification Error:', error);
        alert('❌ Server-এর সাথে যোগাযোগ করা যাচ্ছে না।');
    }
}

// ====================================================
// 🔑 Forgot Password Flow
// ====================================================

function showForgotPasswordForm() {
    document.getElementById('forgot-password-box').classList.remove('hidden');
}

function hideForgotPasswordForm() {
    document.getElementById('forgot-password-box').classList.add('hidden');
    document.getElementById('reset-password-form').classList.add('hidden');
    document.getElementById('forgot-password-status').innerText = '';
}

async function requestPasswordReset() {
    const email = document.getElementById('forgot-email').value;
    const statusText = document.getElementById('forgot-password-status');

    try {
        const response = await fetch(`${API_BASE}/api/volunteer/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const result = await response.json();

        statusText.innerText = response.ok ? '✅ ' + result.message : '❌ ' + result.error;
        if (response.ok) {
            document.getElementById('reset-password-form').classList.remove('hidden'); // 👈 কোড রিকোয়েস্টের পর রিসেট ফর্ম দেখানো
        }
    } catch (error) {
        console.error('Forgot Password Error:', error);
        statusText.innerText = '❌ Server-এর সাথে যোগাযোগ করা যাচ্ছে না।';
    }
}

async function submitPasswordReset() {
    const email = document.getElementById('forgot-email').value;
    const token = document.getElementById('reset-token').value;
    const newPassword = document.getElementById('reset-new-password').value;
    const statusText = document.getElementById('forgot-password-status');

    try {
        const response = await fetch(`${API_BASE}/api/volunteer/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, token, newPassword })
        });
        const result = await response.json();

        if (response.ok) {
            alert('✅ ' + result.message);
            hideForgotPasswordForm();
        } else {
            statusText.innerText = '❌ ' + result.error;
        }
    } catch (error) {
        console.error('Reset Password Error:', error);
        statusText.innerText = '❌ Server-এর সাথে যোগাযোগ করা যাচ্ছে না।';
    }
}

function volunteerLogout() {
    localStorage.removeItem('volunteerToken');
    loggedInVolunteer = null;
    document.getElementById('volunteer-login-box').classList.remove('hidden');
    document.getElementById('volunteer-profile-panel').classList.add('hidden');
    document.getElementById('volunteer-email').value = '';
    document.getElementById('volunteer-password').value = '';
    stopLiveLocationTracking(); // 👈 লগআউট করলে লোকেশন ট্র্যাকিং বন্ধ হয়ে যাবে
}

// লগইন করা ভলান্টিয়ারের real প্রোফাইল ডেটা এনে UI আপডেট করা (Profile + Rank)
// Real Badge Definitions (key/name/icon) — একবার fetch করে ক্যাশ করে রাখা হয়
let badgeDefinitionsCache = null;

async function renderProfileBadges(earnedBadgeKeys) {
    const container = document.getElementById('profile-badges-list');

    if (!badgeDefinitionsCache) {
        try {
            const response = await fetch(`${API_BASE}/api/badges`);
            badgeDefinitionsCache = await response.json();
        } catch (error) {
            console.error('Badge Definitions Fetch Error:', error);
            badgeDefinitionsCache = [];
        }
    }

    if (!earnedBadgeKeys || earnedBadgeKeys.length === 0) {
        container.innerHTML = '<p style="color:#94a3b8; font-size:13px;">এখনো কোনো badge অর্জিত হয়নি — Admin task complete মার্ক করলে badge আনলক হবে।</p>';
        return;
    }

    container.innerHTML = '';
    earnedBadgeKeys.forEach(key => {
        const badgeDef = badgeDefinitionsCache.find(b => b.key === key);
        if (!badgeDef) return;

        const badgeEl = document.createElement('div');
        badgeEl.className = 'badge-item';
        badgeEl.innerHTML = `<i class="${badgeDef.icon}"></i> ${badgeDef.name}`;
        container.appendChild(badgeEl);
    });
}

async function loadVolunteerProfile() {
    const token = localStorage.getItem('volunteerToken');
    if (!token) return;

    try {
        const profileResponse = await fetch(`${API_BASE}/api/volunteer/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (profileResponse.status === 401) {
            volunteerLogout();
            document.getElementById('volunteer-login-error').innerText = '⚠️ সেশনের মেয়াদ শেষ, আবার লগইন করুন।';
            return;
        }

        const user = await profileResponse.json();
        loggedInVolunteer = user; // পুরো real profile object সেভ করে রাখা (Certificate-এ কাজে লাগবে)

        document.getElementById('volunteer-login-box').classList.add('hidden');
        document.getElementById('volunteer-profile-panel').classList.remove('hidden');

        document.getElementById('profile-display-name').innerText = user.name;
        document.getElementById('profile-district').innerText = user.district + ' জেলার ভলান্টিয়ার';
        document.getElementById('user-points').innerText = user.points;
        document.getElementById('profile-rating-text').innerText = `(${user.rating} Rating from ${user.completedTasks} Campaigns)`;

        // Real প্রোফাইল ছবি দেখানো (থাকলে), না থাকলে ডিফল্ট আইকন
        const picDisplay = document.getElementById('profile-pic-display');
        const iconDisplay = document.getElementById('profile-avatar-icon');
        if (user.profilePic) {
            picDisplay.src = user.profilePic;
            picDisplay.classList.remove('hidden');
            iconDisplay.classList.add('hidden');
        } else {
            picDisplay.classList.add('hidden');
            iconDisplay.classList.remove('hidden');
        }

        await renderProfileBadges(user.badges || []); // 👈 real অর্জিত badge দেখানো (decorative static list বাদ)

        // র‍্যাংক আলাদা কল করে আনা
        const rankResponse = await fetch(`${API_BASE}/api/leaderboard/my-rank`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (rankResponse.ok) {
            const rankData = await rankResponse.json();
            document.getElementById('profile-rank-text').innerText = `🏆 Rank #${rankData.rank} / ${rankData.totalVolunteers} জনের মধ্যে`;
        }

        renderLeaderboard(); // লগইনের পর leaderboard-এ নিজের রো হাইলাইট করার জন্য আবার রেন্ডার করা
        startLiveLocationTracking(); // 👈 Login সফল হওয়া মাত্রই automatic permission popup + live tracking শুরু
    } catch (error) {
        console.error('Profile Load Error:', error);
    }
}

// Real Leaderboard — ডেটাবেস থেকে আনা, লগইন করা থাকলে নিজের রো হাইলাইট করা
async function renderLeaderboard() {
    const tbody = document.getElementById('leaderboard-body');
    tbody.innerHTML = '<tr><td colspan="5">⌛ Loading leaderboard...</td></tr>';

    try {
        const response = await fetch(`${API_BASE}/api/leaderboard`);
        const topVolunteers = await response.json();

        tbody.innerHTML = '';

        if (topVolunteers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5">এখনো কোনো ভলান্টিয়ার নেই।</td></tr>';
            return;
        }

        topVolunteers.forEach((vol, index) => {
            const isMe = loggedInVolunteer && loggedInVolunteer._id === vol._id;
            const tr = document.createElement('tr');
            if (isMe) tr.style.background = '#d1fae5'; // নিজের রো হাইলাইট
            tr.innerHTML = `
                <td><strong>#${index + 1}</strong></td>
                <td>${vol.name}${isMe ? ' <strong>(You)</strong>' : ''}</td>
                <td>${vol.district}</td>
                <td>${vol.completedTasks}</td>
                <td><strong>${vol.points} XP</strong></td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        console.error('Leaderboard Error:', error);
        tbody.innerHTML = '<tr><td colspan="5">❌ Leaderboard লোড করা যাচ্ছে না।</td></tr>';
    }
}

// Dynamic PDF Certificate Generator — এখন real logged-in volunteer-এর ডেটা দিয়ে
function downloadPDFCertificate() {
    if (!loggedInVolunteer) {
        alert('⚠️ সার্টিফিকেট ডাউনলোড করতে আগে লগইন করুন।');
        return;
    }

    // 🔒 ১০০০ XP আনলক গেট — অনেকগুলো task সম্পন্ন করে পয়েন্ট বাড়ানোর পরই সার্টিফিকেট আনলক হবে
    const REQUIRED_POINTS = 1000;
    if (loggedInVolunteer.points < REQUIRED_POINTS) {
        alert(`🔒 সার্টিফিকেট আনলক করতে কমপক্ষে ${REQUIRED_POINTS} XP লাগবে।\nআপনার বর্তমান XP: ${loggedInVolunteer.points}\nআরো ${REQUIRED_POINTS - loggedInVolunteer.points} XP অর্জন করুন (Admin কর্তৃক Task সম্পন্ন মার্ক হলে XP বাড়ে)।`);
        return;
    }

    const displayName = loggedInVolunteer.name;
    const points = loggedInVolunteer.points;

    const certWindow = document.createElement('div');
    certWindow.style.padding = '40px';
    certWindow.style.border = '12px solid #0d9488';
    certWindow.style.textAlign = 'center';
    certWindow.style.backgroundColor = '#ffffff';
    // 🐛 বাগ ফিক্স: আগে এই element কখনো document-এ যুক্তই করা হতো না, তাই html2pdf blank PDF বানাতো।
    // এখন screen-এর বাইরে (অদৃশ্যভাবে) DOM-এ বসানো হচ্ছে যাতে html2canvas ঠিকভাবে রেন্ডার করতে পারে।
    certWindow.style.position = 'absolute';
    certWindow.style.left = '-9999px';
    certWindow.style.top = '0';
    certWindow.style.width = '700px';

    certWindow.innerHTML = `
        <div style="font-family: Arial, sans-serif;">
            <h1 style="color: #0f172a; font-size: 30px; margin-bottom: 5px;">TOGETHER FOR BANGLADESH</h1>
            <h3 style="color: #0d9488; font-size: 18px; margin-top: 0;">CERTIFICATE OF MERIT & APPRECIATION</h3>
            <p style="margin-top: 30px; font-size: 16px;">This is proudly awarded to</p>
            <h2 style="color: #0f172a; font-size: 28px; border-bottom: 2px solid #0d9488; display: inline-block; padding-bottom: 5px;">${displayName}</h2>
            <p style="font-size: 15px; color: #475569; margin-top: 20px; line-height: 1.6;">
                For outstanding dedication, community service, and active participation in social and humanitarian campaigns.
            </p>
            <div style="margin-top: 30px; background-color: #f8fafc; padding: 15px; border-radius: 8px;">
                <p style="margin: 0;"><strong>Total Contribution Score:</strong> ${points} Points (Active Responder)</p>
                <p style="margin: 5px 0 0 0; font-size: 13px; color: #64748b;">Verification ID: TBD-2026-88421 | Digital QR Verified</p>
            </div>
            <div style="margin-top: 40px; display: flex; justify-content: space-between; align-items: center;">
                <div style="text-align: left;">
                    <p style="margin: 0; font-weight: bold;">Volunteer Coordinator</p>
                    <p style="margin: 0; font-size: 12px; color: #94a3b8;">Together For Bangladesh</p>
                </div>
                <div style="text-align: right;">
                    <p style="margin: 0; font-weight: bold;">Head Office</p>
                    <p style="margin: 0; font-size: 12px; color: #94a3b8;">Mokamtola, Bogura</p>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(certWindow); // 👈 মূল ফিক্স — DOM-এ যুক্ত করা হলো

    const opt = {
        margin:       0.4,
        filename:     `${displayName}_Together_Bangladesh_Certificate.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2 },
        jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
    };

    html2pdf().set(opt).from(certWindow).save().then(() => {
        document.body.removeChild(certWindow); // 👈 PDF জেনারেট হওয়ার পর অস্থায়ী element সরিয়ে ফেলা
    }).catch((err) => {
        console.error('Certificate Generation Error:', err);
        document.body.removeChild(certWindow);
        alert('❌ সার্টিফিকেট জেনারেট করতে সমস্যা হয়েছে।');
    });
}




// ====================================================
// 📝 5. VOLUNTEER REGISTRATION (বয়স-ভ্যালিডেশন + Real Backend Connection)
// ====================================================

// রেজিস্ট্রেশন ফর্মের জন্য GPS location ক্যাপচার (Nearby Volunteer ফিচার real করতে বাধ্যতামূলক)
function captureRegistrationLocation() {
    const statusText = document.getElementById('reg-location-status');

    if (!navigator.geolocation) {
        statusText.innerText = '❌ আপনার ব্রাউজার GPS সাপোর্ট করে না।';
        statusText.style.color = '#dc2626';
        return;
    }

    statusText.innerText = '⌛ লোকেশন খোঁজা হচ্ছে...';

    navigator.geolocation.getCurrentPosition(
        (position) => {
            document.getElementById('reg-latitude').value = position.coords.latitude;
            document.getElementById('reg-longitude').value = position.coords.longitude;
            statusText.innerText = `✅ লোকেশন ক্যাপচার হয়েছে (${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)})`;
            statusText.style.color = '#059669';
        },
        (error) => {
            statusText.innerText = '❌ লোকেশন পারমিশন দেওয়া হয়নি। এটা ছাড়া রেজিস্ট্রেশন সম্পন্ন হবে না।';
            statusText.style.color = '#dc2626';
        }
    );
}

// রেজিস্ট্রেশনের সময় প্রোফাইল ছবি নেওয়া হলে, Canvas দিয়ে 300x300px-এ resize করে
// base64 string বানানো হয় — যাতে আলাদা কোনো image-storage সার্ভিস (S3/Cloudinary) ছাড়াই
// সরাসরি MongoDB-তে ছোট সাইজে সেভ করা যায়
let registrationProfilePicBase64 = '';

function handleProfilePicSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
            const canvas = document.createElement('canvas');
            const SIZE = 300; // ছোট রাখা হলো যাতে ডাটাবেসে সাইজ কম থাকে
            canvas.width = SIZE;
            canvas.height = SIZE;

            const ctx = canvas.getContext('2d');
            // ছবির মাঝখান থেকে ক্রপ করে বর্গাকার (square) বানানো হচ্ছে
            const minSide = Math.min(img.width, img.height);
            const sx = (img.width - minSide) / 2;
            const sy = (img.height - minSide) / 2;
            ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, SIZE, SIZE);

            registrationProfilePicBase64 = canvas.toDataURL('image/jpeg', 0.8); // compress কোয়ালিটি ৮০%

            const preview = document.getElementById('reg-profile-pic-preview');
            preview.src = registrationProfilePicBase64;
            preview.classList.remove('hidden');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

document.getElementById('volunteer-reg-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const nameInput = document.getElementById('reg-name').value;
    const dobInput = document.getElementById('reg-dob').value;
    const latValue = document.getElementById('reg-latitude').value;
    const lngValue = document.getElementById('reg-longitude').value;

    // GPS Location ক্যাপচার করা হয়েছে কিনা চেক করা
    if (!latValue || !lngValue) {
        alert('⚠️ অনুগ্রহ করে প্রথমে "লোকেশন ক্যাপচার করুন" বাটনে ক্লিক করে GPS Location যুক্ত করুন।');
        return;
    }

    // বয়স ন্যূনতম ১৫ বছর কিনা চেক করা (আগে এই চেকটা কোথাও call হতো না, dead code ছিল — এখন merge করা হলো)
    if (dobInput) {
        const birthDate = new Date(dobInput);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        if (age < 15) {
            alert(`দুঃখিত ${nameInput}, আবেদন করার জন্য আপনার বয়স কমপক্ষে ১৫ বছর হতে হবে। আপনার বর্তমান বয়স: ${age} বছর।`);
            return;
        }
    }

    const userData = {
        name: nameInput,
        email: document.getElementById('reg-email').value,
        password: document.getElementById('reg-password').value,
        phone: document.getElementById('reg-phone') ? document.getElementById('reg-phone').value : '',
        district: document.getElementById('reg-district').value,
        bloodGroup: document.getElementById('reg-blood-group') ? document.getElementById('reg-blood-group').value : '',
        dob: dobInput,
        primarySkill: document.getElementById('reg-skill') ? document.getElementById('reg-skill').value : '',
        experience: document.getElementById('reg-experience') ? parseInt(document.getElementById('reg-experience').value) || 0 : 0,
        latitude: parseFloat(latValue),
        longitude: parseFloat(lngValue),
        profilePic: registrationProfilePicBase64
    };

    try {
        const response = await fetch(`${API_BASE}/api/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(userData)
        });

        const result = await response.json();

        if (response.ok) {
            alert('🎉 ' + result.message + ' এখন Login করে আপনার প্রোফাইল দেখতে পারবেন।');
            document.getElementById('volunteer-reg-form').reset();
        } else {
            alert('❌ ' + result.error);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Server Connection Failed!');
    }
});

