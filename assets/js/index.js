document.addEventListener('DOMContentLoaded', function () {

    const toggleBtn = document.getElementById('mobileToggle');
    const mainNav = document.getElementById('mainNav');

    if (toggleBtn && mainNav) {
        toggleBtn.addEventListener('click', function () {
            mainNav.classList.toggle('open');
        });
    }

    const navLinks = document.querySelectorAll('.gov-nav-item[href^="#"]');

    navLinks.forEach(function (link) {
        link.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (href === '#' || href.length < 2) return;

            const target = document.querySelector(href);
            if (target) {
                e.preventDefault();
                const offset = 80;
                const top = target.getBoundingClientRect().top + window.pageYOffset - offset;
                window.scrollTo({ top: top, behavior: 'smooth' });

                navLinks.forEach(function (l) { l.classList.remove('active'); });
                this.classList.add('active');

                if (mainNav && mainNav.classList.contains('open')) {
                    mainNav.classList.remove('open');
                }
            }
        });
    });

    const faqItems = document.querySelectorAll('.gov-faq-item');
    faqItems.forEach(function (item) {
        item.addEventListener('toggle', function () {
            if (this.open) {
                faqItems.forEach(function (other) {
                    if (other !== item) other.open = false;
                });
            }
        });
    });

    const sections = document.querySelectorAll('section[id]');
    const navItems = document.querySelectorAll('.gov-nav-item[href^="#"]');

    window.addEventListener('scroll', function () {
        let current = '';
        sections.forEach(function (section) {
            const sectionTop = section.offsetTop - 120;
            if (window.pageYOffset >= sectionTop) {
                current = section.getAttribute('id');
            }
        });
        navItems.forEach(function (item) {
            item.classList.remove('active');
            if (item.getAttribute('href') === '#' + current) {
                item.classList.add('active');
            }
        });
    });

    const searchForm = document.querySelector('.gov-search');
    const searchInput = document.querySelector('.gov-search input');

    const searchIndex = [
        { id: 'home', title: 'Home / Hero', keywords: ['home', 'hero', 'welcome', 'start', 'main', 'smart', 'manage'] },
        { id: 'about', title: 'About the System', keywords: ['about', 'about us', 'system', 'overview', 'information', 'purpose', 'what is'] },
        { id: 'services', title: 'Digital Services', keywords: ['services', 'feature', 'features', 'driver registration', 'driver id', 'qr verification', 'fee', 'transactions', 'records'] },
        { id: 'mission-vision', title: 'Mission & Vision', keywords: ['mission', 'vision', 'purpose', 'goal', 'aim', 'principles'] },
        { id: 'org-chart', title: 'Organizational Chart', keywords: ['organization', 'chart', 'structure', 'staff', 'team', 'bctt', 'personnel'] },
        { id: 'transport-info', title: 'Transport Information', keywords: ['transport', 'fares', 'fees', 'price', 'rate', 'tricycle', 'jeepney', 'multicab', 'bus', 'vehicle', 'driver requirements', 'guidelines'] },
        { id: 'how-it-works', title: 'How It Works', keywords: ['how', 'works', 'process', 'steps', 'register', 'login', 'scan', 'verify', 'receipt'] },
        { id: 'faq', title: 'Frequently Asked Questions', keywords: ['faq', 'question', 'help', 'answer'] },
        { id: 'contact', title: 'Contact Us', keywords: ['contact', 'email', 'address', 'location', 'office', 'hours', 'reach', 'support', 'campesao', 'terminal'] }
    ];

    function searchWebsite(query) {
        const q = query.trim().toLowerCase();
        if (!q) return null;

        for (const entry of searchIndex) {
            if (entry.title.toLowerCase().includes(q)) return entry;
            for (const kw of entry.keywords) {
                if (kw.includes(q) || q.includes(kw)) return entry;
            }
        }
        for (const section of sections) {
            if (section.innerText.toLowerCase().includes(q)) {
                const found = searchIndex.find(s => s.id === section.id);
                if (found) return found;
            }
        }
        return null;
    }

    function scrollToSection(id) {
        const target = document.getElementById(id);
        if (!target) return;
        const offset = 80;
        const top = target.getBoundingClientRect().top + window.pageYOffset - offset;
        window.scrollTo({ top: top, behavior: 'smooth' });
        target.classList.remove('search-hit');
        void target.offsetWidth;
        target.classList.add('search-hit');
        setTimeout(function () { target.classList.remove('search-hit'); }, 2000);
    }

    if (searchForm) {
        searchForm.addEventListener('submit', function (e) {
            e.preventDefault();
            const query = searchInput.value;
            const result = searchWebsite(query);
            if (result) {
                scrollToSection(result.id);
                searchInput.placeholder = 'Found: ' + result.title;
                setTimeout(function () { searchInput.placeholder = 'Search the website...'; }, 2500);
            } else {
                searchInput.value = '';
                searchInput.placeholder = 'No results. Try "services", "fares", "faq"...';
                setTimeout(function () { searchInput.placeholder = 'Search the website...'; }, 3500);
            }
        });
    }

    const animatedElements = document.querySelectorAll('[data-aos]');
    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    const delay = entry.target.getAttribute('data-aos-delay') || 0;
                    setTimeout(function () {
                        entry.target.classList.add('aos-animate');
                    }, delay);
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1, rootMargin: '0px 0px -60px 0px' });

        animatedElements.forEach(function (el) { observer.observe(el); });
    } else {
        
        animatedElements.forEach(function (el) { el.classList.add('aos-animate'); });
    }

});

function handleContactSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const status = document.getElementById('contact-status');
    const name = form.querySelector('#contact-name').value.trim();
    const email = form.querySelector('#contact-email').value.trim();
    const subject = form.querySelector('#contact-subject').value;
    const message = form.querySelector('#contact-message').value.trim();

    if (!name || !email || !subject || !message) {
        status.textContent = 'Please fill out all fields.';
        status.style.color = '#b22234';
        return false;
    }

    status.textContent = 'Sending your message...';
    status.style.color = '#6b7280';

    setTimeout(function () {
        status.textContent = 'Thank you, ' + name + '! Your message has been sent.';
        status.style.color = '#16a34a';
        form.reset();
        setTimeout(function () { status.textContent = ''; }, 5000);
    }, 900);

    return false;
}

function handleNewsletterSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const status = document.getElementById('newsletter-status');
    const email = form.querySelector('input[type="email"]').value.trim();

    if (!email) return false;

    status.textContent = 'Subscribing...';

    setTimeout(function () {
        status.textContent = 'Subscribed! We\'ll keep you updated.';
        form.reset();
        setTimeout(function () { status.textContent = ''; }, 5000);
    }, 700);

    return false;
}