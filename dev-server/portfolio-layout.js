// Shared static markup used by the project editor. No browser runtime required.
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

const header = `<header class="site-header">
  <div class="main-container site-header__inner">
    <a class="site-name" href="./index.html">Jerel Ong<span aria-hidden="true">.</span></a>
    <nav class="site-nav" aria-label="Main navigation">
      <a href="./index.html#projects">Projects</a>
      <a href="./index.html#about">About</a>
      <a href="./index.html#contact">Links</a>
    </nav>
  </div>
</header>`;

const footer = `<footer id="contact" class="site-footer">
  <div class="main-container site-footer__inner">
    <span>Jerel Ong</span>
    <nav aria-label="Profile links">
      <a href="https://github.com/lerejbox">GitHub</a>
      <a href="https://www.linkedin.com/in/jerelong">LinkedIn</a>
    </nav>
  </div>
</footer>`;

function renderProjects(projects, details = []) {
  const cards = projects.map((project, index) => {
    const detail = details.find(item => item.projectId === project.id) || {};
    const meta = detail.meta || {};
    const context = [meta.company || meta.projectType, meta.projectDate].filter(Boolean);
    const tags = (detail.skills || []).filter(skill => skill !== 'GIT').slice(0, 4);
    const description = /<p[\s>]/i.test(project.description)
      ? project.description : `<p>${project.description}</p>`;
    return `<article class="project-card${index < 3 ? ' project-card--selected' : ''}">
      <a class="project-card__image" href="${escapeHtml(project.detailPage)}" tabindex="-1" aria-hidden="true">
        <img src="${escapeHtml(project.image)}" alt="" loading="lazy" />
      </a>
      <div class="project-card__body">
        <p class="project-card__meta">${context.map(escapeHtml).join(' <span aria-hidden="true">/</span> ')}</p>
        <h3><a href="${escapeHtml(project.detailPage)}">${escapeHtml(project.title)}<span class="project-card__arrow" aria-hidden="true">↗</span></a></h3>
        <div class="project-card__description">${description}</div>
        ${tags.length ? `<ul class="project-tags" aria-label="Technologies">${tags.map(tag => `<li>${escapeHtml(tag)}</li>`).join('')}</ul>` : ''}
      </div>
    </article>`;
  });
  return `<section id="projects" class="projects sec-pad">
  <div class="main-container">
    <div class="section-heading"><h2>Selected projects</h2><span>01 — ${String(Math.min(projects.length, 3)).padStart(2, '0')}</span></div>
    <div class="selected-projects">${cards.slice(0, 3).join('\n')}</div>
    ${cards.length > 3 ? `<div class="section-heading section-heading--other"><h2>Other projects</h2><span>04 — ${String(cards.length).padStart(2, '0')}</span></div>
    <div class="other-projects">${cards.slice(3).join('\n')}</div>` : ''}
  </div>
</section>`;
}

module.exports = { header, footer, renderProjects };
