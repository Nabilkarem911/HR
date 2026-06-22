/* ==========================================================================
   HR SYSTEM - MASTER DATABASE CONFIGURATION
   ========================================================================== 
   INSTRUCTIONS FOR MULTI-TENANCY:
   To deploy for a new client, simply replace the URL and KEY below.
   Ensure NO OTHER FILE in the workspace contains database credentials.
   All pages will look for 'window.db' established here.
========================================================================== */

const DB_CONFIG = {
    // Current Tenant: Default / Demo
    SUPABASE_URL: 'https://fctybugtoeeuvfonmdyl.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjdHlidWd0b2VldXZmb25tZHlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NDk0MzgsImV4cCI6MjA4ODIyNTQzOH0.f5_SGoZI0TuJLCTdmaOqHUSzsf2hj4ZkjlCVLeXNaZE'
};

/* ==========================================================================
   INITIALIZATION
========================================================================== */

// Assign Supabase client directly to window.db to avoid 'const supabase' global conflicts
if (window.supabase) {
    window.db = window.supabase.createClient(DB_CONFIG.SUPABASE_URL, DB_CONFIG.SUPABASE_ANON_KEY);
} else {
    console.error("Supabase CDN script is missing. Ensure it is loaded before supabaseClient.js");
}

/* ==========================================================================
   GLOBAL UTILITIES & AUTH
========================================================================== */

window.checkAuth = async function () {
    if (!window.db) return null;
    const { data: { session }, error } = await window.db.auth.getSession();
    if (error) console.error("Error checking session:", error);
    return session;
}

window.showError = (message) => {
    alert('خطأ: ' + message);
}
window.showSuccess = (message) => {
    alert('نجاح: ' + message);
}
