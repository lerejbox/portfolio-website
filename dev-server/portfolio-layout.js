// Shared static markup used by the project editor. No browser runtime required.
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

const header = `<header class="site-header">
  <div class="main-container site-header__inner">
    <a class="site-name" href="./index.html"><img class="site-avatar" src="./assets/png/jobx.png" alt="" width="48" height="48" /><span>Jerel Ong</span></a>
    <nav class="site-nav" aria-label="Main navigation">
      <a href="./index.html#about">About</a>
      <a href="./index.html#projects">Work</a>
      <a href="./index.html#personal-projects">Projects</a>
      <a class="social-link" href="https://www.linkedin.com/in/jerelong" aria-label="LinkedIn" title="LinkedIn"><img src="./assets/png/linkedin-ico.png" alt="" width="22" height="22" /></a>
      <a class="social-link" href="https://github.com/lerejbox" aria-label="GitHub" title="GitHub"><img src="./assets/png/github-ico.png" alt="" width="22" height="22" /></a>
    </nav>
  </div>
</header>`;

function renderProjects(projects, details = []) {
  const cards = projects.map((project, index) => {
    const detail = details.find(item => item.projectId === project.id) || {};
    const meta = detail.meta || {};
    const context = [meta.company || meta.projectType, meta.projectDate].filter(Boolean);
    const tags = (detail.skills || []).filter(skill => skill !== 'GIT').slice(0, 4);
    const unmaintained = (detail.overview || []).some(item =>
      item.type === 'note' && /no longer maintained/i.test(item.content));
    const description = /<p[\s>]/i.test(project.description)
      ? project.description : `<p>${project.description}</p>`;
    return `<article class="project-card${index < 3 ? ' project-card--selected' : ''}">
      <a class="project-card__image" href="${escapeHtml(project.detailPage)}" tabindex="-1" aria-hidden="true">
        <img src="${escapeHtml(project.image)}" alt="" loading="lazy" />
      </a>
      <div class="project-card__body">
        <p class="project-card__meta">${context.map(escapeHtml).join(' <span aria-hidden="true">/</span> ')}</p>
        ${unmaintained ? `<p class="project-status"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v12h14V8M10 12h4"/></svg><span>No longer maintained</span></p>` : ''}
        <h3><a href="${escapeHtml(project.detailPage)}">${escapeHtml(project.title)}<span class="project-card__arrow" aria-hidden="true">↗</span></a></h3>
        <div class="project-card__description">${description}</div>
        ${tags.length ? `<ul class="project-tags" aria-label="Technologies">${tags.map(tag => `<li>${escapeHtml(tag)}</li>`).join('')}</ul>` : ''}
      </div>
    </article>`;
  });
  return `<section id="projects" class="projects sec-pad">
  <div class="main-container">
    <div class="section-heading"><h2>Work experiences</h2></div>
    <div class="selected-projects">${cards.slice(0, 3).join('\n')}</div>
    <div id="personal-projects" class="section-heading section-heading--other"><h2>Personal projects</h2></div>
    ${cards.length > 3 ? `
    <div class="other-projects">${cards.slice(3).join('\n')}</div>` : ''}
  </div>
</section>`;
}

module.exports = { header, renderProjects };
