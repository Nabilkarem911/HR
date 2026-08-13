document.addEventListener('DOMContentLoaded', () => {
    const mainContent = document.getElementById('main-content');
    const navLinks = document.querySelectorAll('.nav-link');
    const sidebar = document.getElementById('sidebar');
    const toggleSidebarBtn = document.getElementById('toggle-sidebar');

    // Sidebar Toggle
    toggleSidebarBtn.addEventListener('click', () => {
        // Toggle Sidebar visibility and margin dynamically
        if (sidebar.classList.contains('translate-x-full')) {
            sidebar.classList.remove('translate-x-full');
            // On mobile, show it as an overlay
            if (window.innerWidth <= 768) {
                sidebar.classList.add('absolute', 'z-20', 'h-full');
            }
        } else {
            sidebar.classList.add('translate-x-full');
        }
    });

    // Handle Resize for responsive sidebar
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            sidebar.classList.remove('translate-x-full', 'absolute', 'z-20', 'h-full');
        } else {
            sidebar.classList.add('translate-x-full');
        }
    });

    // Initial check on load
    if (window.innerWidth <= 768) {
        sidebar.classList.add('translate-x-full');
    }

    // --- MATRIX PERMISSION ENGINE (THE ENFORCER) ---
    window.hasPerm = function(moduleName, action) {
        // 1. Super Admin Logic (Bypass)
        if (window.currentUserRole === 'super_admin') {
            // Negative permissions (masking) must return FALSE for Super Admins so they see everything
            if (action.startsWith('hide_')) return false;
            // All other positive actions return TRUE
            return true; 
        }

        // 2. Regular User Logic
        let perms = window.currentUserPerms || {};
        if (typeof perms === 'string') {
            try { perms = JSON.parse(perms); } catch(e) { perms = {}; }
        }

        if (perms[moduleName] && typeof perms[moduleName][action] !== 'undefined') {
            return perms[moduleName][action] === true;
        }

        // FAIL-CLOSED: Deny access by default if permission is not explicitly granted in the matrix
        return false; 
    };

    // Simple Router (Master Layout loading partials)
    let permissionsReady = false;
    window.__permissionsReady = () => permissionsReady;
    
    const loadPage = async (pageName) => {
        // --- Chameleon UI Routing Restriction ---
        if (window.currentUserRole === 'employee' && pageName !== 'ess-dashboard') {
            window.location.hash = '#ess-dashboard';
            return;
        }

        // Strict Front-End Route Guard securely protecting the System Users Page
        if (pageName === 'users' && window.currentUserRole !== 'super_admin') {
            alert('غير مصرح لك بالدخول لهذه الصفحة');
            window.location.hash = '#dashboard';
            return;
        }

        // --- MATRIX PERMISSION ROUTE GUARD ---
        const pageModuleMap = {
            'dashboard': 'dashboard',
            'companies': 'companies',
            'employee-profile': 'employees',
            'time-attendance': 'attendance',
            'leaves-loans': 'requests',
            'payroll': 'payroll',
            'letters': 'letters',
            'compliance': 'compliance',
            'assets': 'assets',
            'vehicles': 'vehicles',
            'users': 'users'
        };
        
        if (pageModuleMap[pageName] && !window.hasPerm(pageModuleMap[pageName], 'view')) {
            if (window.currentUserRole === 'employee') {
                window.location.hash = '#ess-dashboard';
            } else {
                alert('صلاحياتك الحالية لا تسمح لك بعرض هذه الصفحة.');
                window.location.hash = '#dashboard';
            }
            return;
        }

        try {
            // Show loader
            mainContent.innerHTML = `
                <div class="flex justify-center items-center h-full w-full">
                    <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
                </div>
            `;

            // Update active state in nav sidebar
            navLinks.forEach(link => {
                link.classList.remove('active');
                if (link.dataset.page === pageName) {
                    link.classList.add('active');
                }
            });

            // Fetch page HTML (Strict Anti-Caching enforced to prevent SPA infinite loading loops)
            const timestamp = new Date().getTime();
            const response = await fetch(`pages/${pageName}.html?v=${timestamp}`, {
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });
            if (!response.ok) {
                // Return simple 404 or create page placeholder
                if (response.status === 404) {
                    mainContent.innerHTML = `
                        <div class="flex flex-col items-center justify-center h-full text-slate-400">
                            <i class="fa-solid fa-hammer text-6xl mb-4 text-slate-300"></i>
                            <h2 class="text-2xl font-bold">الصفحة قيد الإنشاء</h2>
                            <p class="mt-2 text-slate-500">جاري العمل على وحدة "${pageName}"</p>
                        </div>
                    `;
                    return;
                }
                throw new Error('Page note loaded');
            }
            const html = await response.text();

            // Clean up dynamically injected scripts from the previous page to prevent memory leaks and duplicate execution hooks
            document.querySelectorAll('script.dynamic-view-script').forEach(script => script.remove());

            // Clear completely before injecting new HTML
            mainContent.innerHTML = '';

            // Render page content with animation
            mainContent.innerHTML = `<div class="page-enter">${html}</div>`;

            // Execute scripts inside the injected HTML (Vanilla JS limitation workaround)
            const scripts = mainContent.querySelectorAll('script');
            scripts.forEach(oldScript => {
                // Prevent reloading apiClient inside partials if accidentally added
                if (oldScript.src && (oldScript.src.includes('apiClient') || oldScript.src.includes('supabaseClient'))) return;

                const newScript = document.createElement('script');
                newScript.className = 'dynamic-view-script'; // Mark for cleanup

                // Copy all attributes
                Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));

                // Wrap content in IIFE to prevent "let/const" redeclaration errors on navigation
                if (oldScript.innerHTML.trim()) {
                    newScript.textContent = `(async () => {
                        try {
                            ${oldScript.innerHTML}
                        } catch (scriptErr) {
                            console.error('[Router Error] Script evaluation failed in partial: ${pageName}', scriptErr);
                        }
                    })();`;
                }

                // Append purely to document body to enforce strict execution decoupling
                document.body.appendChild(newScript);

                // Remove the raw unexecuted script tag from the partial HTML
                if (oldScript.parentNode) {
                    oldScript.parentNode.removeChild(oldScript);
                }
            });

        } catch (error) {
            console.error('Error loading page:', error);
            mainContent.innerHTML = `
                <div class="bg-red-50 border-r-4 border-red-500 p-4 rounded-md inline-block">
                    <div class="flex items-center">
                        <i class="fa-solid fa-circle-exclamation text-red-500 text-xl ml-3"></i>
                        <p class="text-red-700 font-bold">عذراً، حدث خطأ أثناء تحميل الصفحة.</p>
                    </div>
                </div>
            `;
        }
    }; // end loadPage

    // Listen for hash changes
    window.addEventListener('hashchange', () => {
        let hash = window.location.hash.substring(1);
        if (!hash) hash = 'dashboard';
        loadPage(hash);
    });

    // Intercept nav clicks to hide sidebar on mobile automatically
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                sidebar.classList.add('translate-x-full');
            }
        });
    });

    // Load initial route or check auth
    const initApp = async () => {
        // --- 1. Check ESS Custom Session ---
        const essSessionStr = localStorage.getItem('ess_session');
        if (essSessionStr) {
            try {
                const essSession = JSON.parse(essSessionStr);
                window.currentUserRole = 'employee';
                window.currentEmpId = essSession.employee_profile_id;
                permissionsReady = true;

                // Chameleon UI: Swap Sidebars
                const hrNav = document.getElementById('nav-hr-links');
                const essNav = document.getElementById('nav-ess-links');
                if (hrNav) hrNav.classList.add('hidden');
                if (essNav) essNav.classList.remove('hidden');

                const nameElem = document.getElementById('current-user-name');
                if (nameElem) {
                    nameElem.innerText = essSession.full_name || 'موظف';
                    const roleElem = nameElem.nextElementSibling;
                    if (roleElem) roleElem.innerText = 'بوابة الموظف (ESS)';
                }

                let initialHash = window.location.hash.substring(1);
                if (!initialHash || initialHash === 'login' || initialHash === 'dashboard') {
                    initialHash = 'ess-dashboard';
                    window.location.hash = '#ess-dashboard';
                }
                loadPage(initialHash);

                // Setup Logout functionality for ESS
                const logoutBtn = document.getElementById('logout-btn');
                if (logoutBtn) {
                    logoutBtn.addEventListener('click', () => {
                        localStorage.removeItem('ess_session');
                        window.location.hash = '#login';
                        window.location.reload();
                    });
                }
                return; // Stop here, skip Supabase Auth check
            } catch (e) {
                console.error("Invalid ESS session", e);
                localStorage.removeItem('ess_session');
            }
        }

        // --- 2. Token-based session check for Admins ---
        const { data: sessionData } = await window.db.auth.getSession();
        let initialHash = window.location.hash.substring(1);

        if (sessionData && sessionData.session) {
            try {
                // The /auth/profile endpoint already returns user details
                const userData = sessionData.session.user_meta;

                if (userData) {
                    // Load Global App State for Routing Checks
                    window.currentUserRole = userData.role;
                    window.currentUserPerms = userData.custom_permissions;
                    window.currentUserCompanyId = userData.company_id;
                    permissionsReady = true;

                    // DYNAMICALLY HIDE RESTRICTED SIDEBAR LINKS BASED ON MATRIX
                    const sidebarMap = {
                        'dashboard': 'dashboard',
                        'companies': 'companies',
                        'employee-profile': 'employees',
                        'time-attendance': 'attendance',
                        'leaves-loans': 'requests',
                        'payroll': 'payroll',
                        'letters': 'letters',
                        'compliance': 'compliance',
                        'assets': 'assets',
                        'vehicles': 'vehicles',
                        'users': 'users'
                    };

                    document.querySelectorAll('.nav-link').forEach(link => {
                        const page = link.dataset.page;
                        const moduleName = sidebarMap[page];
                        
                        // If the module exists in our map, and the user lacks 'view' permission, hide the entire <li>
                        if (moduleName && window.hasPerm && !window.hasPerm(moduleName, 'view')) {
                            const liElement = link.closest('li');
                            if (liElement) liElement.style.display = 'none';
                        }
                    });

                    const roleMap = {
                        'super_admin': 'مدير عام',
                        'hr_manager': 'موارد بشرية',
                        'branch_manager': 'مدير فرع',
                        'viewer': 'مشاهد'
                    };
                    const nameElem = document.getElementById('current-user-name');
                    if (nameElem) {
                        nameElem.innerText = userData.full_name || 'مستخدم غير معروف';
                        const roleElem = nameElem.nextElementSibling;
                        if (roleElem) roleElem.innerText = roleMap[userData.role] || userData.role;
                    }
                }
            } catch (err) {
                console.error("Error fetching user profile for shell:", err);
            }

            // Immediately hide Login and route to Dashboard or requested page
            if (!initialHash || initialHash === 'login') {
                initialHash = 'dashboard';
                window.location.hash = '#dashboard';
            }
            loadPage(initialHash);
        } else {
            // No session, force login page
            window.location.hash = '#login';
            loadPage('login');
        }

        // Setup Logout functionality for HR/Admin
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', async () => {
                localStorage.removeItem('ess_session');
                localStorage.removeItem('hr_auth_token');
                await window.db.auth.signOut();
                window.location.hash = '#login';
                window.location.reload();
            });
        }
    };

    initApp();
});
