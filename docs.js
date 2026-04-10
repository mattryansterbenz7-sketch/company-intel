// Highlight active nav section on scroll
const sections = document.querySelectorAll('.doc-section-anchor');
const navLinks = document.querySelectorAll('.doc-nav a[href^="#"]');
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      navLinks.forEach(l => l.classList.remove('active'));
      const link = document.querySelector(`.doc-nav a[href="#${entry.target.id}"]`);
      if (link) link.classList.add('active');
    }
  });
}, { rootMargin: '-20% 0px -70% 0px' });
sections.forEach(s => observer.observe(s));

// Search docs
const searchInput = document.getElementById('doc-search');
if (searchInput) {
  const docSections = document.querySelectorAll('.doc-section');
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    docSections.forEach(sec => {
      const anchor = sec.querySelector('.doc-section-anchor');
      const id = anchor ? anchor.id : '';
      const navLink = id ? document.querySelector(`.doc-nav a[href="#${id}"]`) : null;
      if (!q) {
        sec.classList.remove('search-hidden');
        if (navLink) navLink.classList.remove('search-hidden');
        return;
      }
      const text = sec.textContent.toLowerCase();
      const match = text.includes(q);
      sec.classList.toggle('search-hidden', !match);
      if (navLink) navLink.classList.toggle('search-hidden', !match);
    });
  });
}
