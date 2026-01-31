require('dotenv').config();
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const OpenAI = require('openai');

const app = express();
const PORT = 3000;

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// Paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const PROJECT_DETAILS_FILE = path.join(DATA_DIR, 'project-details.json');
const INDEX_FILE = path.join(__dirname, '..', 'index.html');
const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const ROOT_DIR = path.join(__dirname, '..');

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error('Error creating data directory:', err);
  }
}

// Load projects from JSON
async function loadProjects() {
  try {
    const data = await fs.readFile(PROJECTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.log('No existing projects file, creating default');
    const defaultData = { projects: [] };
    await saveProjects(defaultData);
    return defaultData;
  }
}

// Save projects to JSON
async function saveProjects(data) {
  await fs.writeFile(PROJECTS_FILE, JSON.stringify(data, null, 2));
}

// Load project details from JSON
async function loadProjectDetails() {
  try {
    const data = await fs.readFile(PROJECT_DETAILS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.log('No existing project details file, creating default');
    const defaultData = { details: [] };
    await saveProjectDetails(defaultData);
    return defaultData;
  }
}

// Save project details to JSON
async function saveProjectDetails(data) {
  await fs.writeFile(PROJECT_DETAILS_FILE, JSON.stringify(data, null, 2));
}

// Get next project number for detail page filename
async function getNextProjectNumber() {
  const data = await loadProjects();
  const projects = data.projects || [];

  let maxNum = 0;
  for (const project of projects) {
    if (project.detailPage) {
      const match = project.detailPage.match(/project-(\d+)\.html/);
      if (match) {
        const num = parseInt(match[1]);
        if (num > maxNum) maxNum = num;
      }
    }
  }

  // Also check for existing files
  try {
    const files = await fs.readdir(ROOT_DIR);
    for (const file of files) {
      const match = file.match(/project-(\d+)\.html/);
      if (match) {
        const num = parseInt(match[1]);
        if (num > maxNum) maxNum = num;
      }
    }
  } catch (err) {
    // Ignore errors
  }

  return maxNum + 1;
}

function normalizeRelativePath(relativePath) {
  if (relativePath === null || relativePath === undefined) return '';
  return String(relativePath).trim().replace(/^\.\//, '');
}

function isGeneratedProjectDetailHtml(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return false;
  return /^project-\d+\.html$/i.test(path.basename(normalized));
}

async function deleteGeneratedProjectDetailHtmlFile(detailPagePath) {
  const relative = normalizeRelativePath(detailPagePath);
  if (!relative) {
    return { deleted: false, reason: 'missing' };
  }

  // Safety: only delete files that match the generated naming convention.
  if (!isGeneratedProjectDetailHtml(relative)) {
    return { deleted: false, reason: 'not-generated' };
  }

  const resolved = path.resolve(ROOT_DIR, relative);
  const relCheck = path.relative(ROOT_DIR, resolved);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    return { deleted: false, reason: 'unsafe-path' };
  }

  try {
    await fs.unlink(resolved);
    console.log(`Deleted generated detail page: ${resolved}`);
    return { deleted: true };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { deleted: false, reason: 'not-found' };
    }
    throw err;
  }
}

// Generate detail page HTML from template
function generateDetailPageHtml(detail, projectTitle, detailPagePath) {
  const sanitizeListItem = (value) => {
    if (value === null || value === undefined) return '';
    let text = String(value).trim();

    // Strip common list wrappers produced by AI.
    text = text.replace(/<\/?(ul|ol)[^>]*>/gi, '').trim();
    text = text.replace(/^\s*<li[^>]*>\s*/i, '').replace(/\s*<\/?li>\s*$/i, '').trim();

    // Strip plain-text bullet markers.
    text = text.replace(/^\s*(?:[-*•]+\s+|\d+[.)]\s+)/, '').trim();
    return text;
  };

  const meta = detail.meta || {};

  const renderTextAsParagraphs = (value, className = 'projects__row-content-desc2') => {
    if (value === null || value === undefined) return '';
    const text = String(value).trim();
    if (!text) return '';

    // Split by blank lines to allow simple paragraphing in textareas.
    const parts = text
      .split(/\n\s*\n+/)
      .map(p => p.trim())
      .filter(Boolean);

    return parts.map(p => `<p class="${className}">${p}</p>`).join('');
  };

  // Build meta info line
  let metaHtml = '';
  if (meta.role || meta.projectType) {
    const label = meta.role ? 'Role' : 'Project Type';
    const value = meta.role || meta.projectType;
    metaHtml += `<strong>${label}:</strong> ${value}<br>`;
  }
  if (meta.company) {
    metaHtml += `<strong>Company:</strong> ${meta.company}<br>`;
  }
  if (meta.projectDate) {
    metaHtml += `<strong>Project Date:</strong> ${meta.projectDate}`;
  }

  // Build overview content
  let overviewHtml = '';
  if (detail.overview && detail.overview.length > 0) {
    for (const item of detail.overview) {
      switch (item.type) {
        case 'paragraph':
          overviewHtml += `<p class="projects__row-content-desc2">${item.content}</p>`;
          break;
        case 'heading':
          overviewHtml += `<p class="projects__row-content-desc2"><strong>${item.content}</strong></p>`;
          break;
        case 'bullet':
          overviewHtml += `<ul class="project-details__desc-list" style="margin-bottom: 1rem;"><li>${item.content}</li></ul>`;
          break;
        case 'note':
          overviewHtml += `<p class="projects__row-content-desc2"><strong>NOTE:</strong> ${item.content}</p>`;
          break;
        case 'image':
          overviewHtml += `
              <div class="project-details__showcase-img-cont3">
                <img
                  src="${item.src}"
                  alt="Project Image"
                  class="project-details__showcase-img"
                />
              </div>`;
          if (item.caption) {
            overviewHtml += `<p class="projects__row-content-desc">${item.caption}</p>`;
          }
          break;
      }
    }
  }

  // Build main content section (new flexible content block)
  let mainContentHtml = '';
  const mainContent = detail.mainContent;
  if (mainContent && typeof mainContent.title === 'string' && mainContent.title.trim()) {
    const title = mainContent.title.trim();
    const sectionDescriptionHtml = renderTextAsParagraphs(mainContent.description);
    const conclusionHtml = renderTextAsParagraphs(mainContent.conclusion);

    const blocks = Array.isArray(mainContent.blocks) ? mainContent.blocks : [];
    const blocksHtml = blocks.map(block => {
      const subtitle = (block && block.subtitle) ? String(block.subtitle).trim() : '';
      const description = (block && block.description) ? String(block.description).trim() : '';
      const imageSrc = (block && block.image && block.image.src) ? String(block.image.src).trim() : '';

      if (!subtitle && !description && !imageSrc) return '';

      let html = `<div class="project-details__main-content-block">`;
      if (subtitle) {
        html += `<h4 class="project-details__content-subtitle">${subtitle}</h4>`;
      }
      if (imageSrc) {
        html += `
                <div class="project-details__showcase-img-cont3">
                  <img
                    src="${imageSrc}"
                    alt="Project Image"
                    class="project-details__showcase-img"
                  />
                </div>`;
      }
      if (description) {
        html += renderTextAsParagraphs(description);
      }
      html += `</div>`;
      return html;
    }).filter(Boolean).join('');

    mainContentHtml = `
            <div class="project-details__tools-used project-details__main-content">
              <h3 class="project-details__content-title">${title}</h3>
              ${sectionDescriptionHtml}
              ${blocksHtml}
              ${conclusionHtml}
            </div>`;
  }

  // Build additional images
  let additionalImagesHtml = '';
  // Legacy fallback: render old additionalImages only when mainContent is not used.
  if (!mainContentHtml && detail.additionalImages && detail.additionalImages.length > 0) {
    let imagesHtml = '';
    for (const img of detail.additionalImages) {
      const caption = (img && img.caption) ? String(img.caption).trim() : '';
      if (caption) {
        imagesHtml += `<p class="project-details__image-title">${caption}</p>`;
      }
      imagesHtml += `
            <div class="project-details__showcase-img-cont">
              <img
                src="${img.src}"
                alt="Project Image"
                class="project-details__showcase-img"
              />
            </div>`;
    }

    additionalImagesHtml = `
            <div class="project-details__tools-used">
              <h3 class="project-details__content-title">Images</h3>
              ${imagesHtml}
            </div>`;
  }

  // Build key contributions
  let keyContributionsHtml = '';
  if (detail.keyContributions && detail.keyContributions.length > 0) {
    const keyContributions = detail.keyContributions.map(sanitizeListItem).filter(Boolean);
    keyContributionsHtml = `
            <div class="project-details__tools-used">
              <h3 class="project-details__content-title">Key Contributions</h3>
              <ul class="project-details__desc-list">
                ${keyContributions.map(c => `<li>${c}</li>`).join('\n                ')}
              </ul>
            </div>`;
  }

  // Build future development
  let futureDevHtml = '';
  if (detail.futureDevelopment && detail.futureDevelopment.length > 0) {
    const futureDevelopment = detail.futureDevelopment.map(sanitizeListItem).filter(Boolean);
    futureDevHtml = `
            <div class="project-details__tools-used">
              <h3 class="project-details__content-title">Future Development</h3>
              <ul class="project-details__desc-list">
                ${futureDevelopment.map(item => `<li>${item}</li>`).join('\n                ')}
              </ul>
            </div>`;
  }

  // Build skills
  let skillsHtml = '';
  if (detail.skills && detail.skills.length > 0) {
    skillsHtml = `
            <div class="project-details__tools-used">
              <h3 class="project-details__content-title">Skills and Tools Used</h3>
              <div class="skills">
                ${detail.skills.map(skill => `<div class="skills__skill">${skill}</div>`).join('\n                ')}
              </div>
            </div>`;
  }

  // Build links
  let linksHtml = '';
  if (detail.links && detail.links.length > 0) {
    const linkButtons = detail.links.map(link => `
              <a
                href="${link.url}"
                class="btn btn--med btn--theme project-details__links-btn"
                target="_blank"
                >${link.label}</a
              >`).join('\n              ');

    linksHtml = `
            <div class="project-details__links">
              <h3 class="project-details__content-title">Project Links</h3>
              ${linkButtons}
            </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="X-UA-Compatible" content="ie=edge" />
    <title>More Details on ${projectTitle}</title>
    <meta name="description" content="Case study page of Project" />

    <link rel="stylesheet" href="css/style.css" />

    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Source+Sans+Pro:wght@400;600;700;900&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <header class="header">
      <div class="header__content">
        <div class="header__logo-container">
          <div class="header__logo-img-cont">
            <img
              src="./assets/png/jobx.png"
              class="header__logo-img"
            />
          </div>
          <span class="header__logo-sub">Jerel Ong</span>
        </div>
        <div class="header__main">
          <ul class="header__links">
            <li class="header__link-wrapper">
              <a href="./index.html" class="header__link"> Home </a>
            </li>
            <li class="header__link-wrapper">
              <a href="./index.html#about" class="header__link">About </a>
            </li>
            <li class="header__link-wrapper">
              <a href="./index.html#projects" class="header__link">
                Projects
              </a>
            </li>
          </ul>
          <div class="header__main-ham-menu-cont">
            <img
              src="./assets/svg/ham-menu.svg"
              alt="hamburger menu"
              class="header__main-ham-menu"
            />
            <img
              src="./assets/svg/ham-menu-close.svg"
              alt="hamburger menu close"
              class="header__main-ham-menu-close d-none"
            />
          </div>
        </div>
      </div>
      <div class="header__sm-menu">
        <div class="header__sm-menu-content">
          <ul class="header__sm-menu-links">
            <li class="header__sm-menu-link">
              <a href="./index.html"> Home </a>
            </li>

            <li class="header__sm-menu-link">
              <a href="./index.html#about"> About </a>
            </li>

            <li class="header__sm-menu-link">
              <a href="./index.html#projects"> Projects </a>
            </li>
          </ul>
        </div>
      </div>
    </header>
    <section class="project-details">
      <div class="main-container">
        <div class="project-details__content">
          <div class="project-details__showcase-img-cont">
            <img
              src="${detail.heroImage || './assets/jpeg/project-placeholder.jpg'}"
              alt="Project Image"
              class="project-details__showcase-img"
            />
          </div>
          <div class="project-details__content-main">
            <div class="project-details__desc">
              <h3 class="project-details__content-title--big">${projectTitle}</h3>
              <p class="project-details__desc-para">
                ${metaHtml}
              </p>
            </div>
            <div class="project-details__tools-used">
              <h3 class="project-details__content-title">Project Overview</h3>
              ${overviewHtml}
            </div>
            ${mainContentHtml}
            ${additionalImagesHtml}
            ${keyContributionsHtml}
            ${futureDevHtml}
            ${skillsHtml}
            ${linksHtml}
          </div>
        </div>
      </div>
    </section>
    <script src="./index.js"></script>
  </body>
</html>`;
}

// Save detail page to HTML file
async function saveDetailPageHtml(projectId, projectTitle, detailPagePath) {
  const detailsData = await loadProjectDetails();
  const detail = detailsData.details.find(d => d.projectId === projectId);

  if (!detail) {
    console.error(`No detail data found for project ${projectId}`);
    return false;
  }

  const html = generateDetailPageHtml(detail, projectTitle, detailPagePath);
  const filePath = path.join(ROOT_DIR, detailPagePath.replace(/^\.\//, ''));

  await fs.writeFile(filePath, html);
  console.log(`Generated detail page: ${filePath}`);
  return true;
}

async function ensureDetailPagesExist() {
  const projectsData = await loadProjects();
  const projects = projectsData.projects || [];

  // Ensure details store exists
  const detailsData = await loadProjectDetails();
  let detailsChanged = false;

  for (const project of projects) {
    if (!project.detailPage) continue;

    const relative = project.detailPage.replace(/^\.\//, '');
    const filePath = path.join(ROOT_DIR, relative);

    let exists = true;
    try {
      await fs.access(filePath);
    } catch {
      exists = false;
    }

    // Never overwrite existing detail pages.
    if (exists) continue;

    // Ensure we have some detail data to generate from.
    let detail = detailsData.details.find(d => d.projectId === project.id);
    if (!detail) {
      detail = {
        projectId: project.id,
        heroImage: project.image || './assets/jpeg/project-placeholder.jpg',
        meta: {
          role: '',
          company: '',
          projectType: '',
          projectDate: ''
        },
        overview: [
          {
            type: 'paragraph',
            content: project.description || 'Project overview coming soon...'
          }
        ],
        mainContent: null,
        additionalImages: [],
        keyContributions: [],
        futureDevelopment: [],
        skills: [],
        links: []
      };
      detailsData.details.push(detail);
      detailsChanged = true;
    }

    const html = generateDetailPageHtml(detail, project.title, project.detailPage);
    await fs.writeFile(filePath, html);
    console.log(`Generated missing detail page: ${filePath}`);
  }

  if (detailsChanged) {
    await saveProjectDetails(detailsData);
  }
}

// Generate index.html from projects
async function generateIndexHtml() {
  const data = await loadProjects();
  const projects = data.projects || [];

  // Read the current index.html to get the template parts
  let indexContent = await fs.readFile(INDEX_FILE, 'utf8');

  // Find the projects section - need to find the proper end
  const projectsStartMarker = '<section id="projects" class="projects sec-pad">';
  const nextSectionStartMarker = '<script src="./index.js">';

  const projectsSectionStart = indexContent.indexOf(projectsStartMarker);
  const nextSectionStart = indexContent.indexOf(nextSectionStartMarker, projectsSectionStart);

  if (projectsSectionStart === -1 || nextSectionStart === -1) {
    console.error('Could not find projects section markers in index.html');
    return;
  }

  // Find the end of the projects section (should end with </section> before the script tag)
  // Look backwards from nextSectionStart to find </section>
  let projectsSectionEnd = nextSectionStart;
  for (let i = nextSectionStart - 1; i >= projectsSectionStart; i--) {
    if (indexContent.substring(i, i + 10) === '</section>') {
      projectsSectionEnd = i + 10;
      break;
    }
  }

  // Generate projects HTML
  const projectsHtml = projects.map((project, index) => {
    const imageStyle = project.imageStyle ? ` style="${project.imageStyle}"` : '';
    const centerClass = project.centerImage ? ' projects__row--center-img' : '';

    // Ensure description is wrapped with the proper CSS class for consistent styling
    let descContent;
    if (project.description.includes('<p')) {
      // Description has HTML <p> tags (from AI or manual HTML)
      // Check if it already has the class
      if (project.description.includes('class="projects__row-content-desc') ||
        project.description.includes("class='projects__row-content-desc")) {
        // Already has the class, use as-is
        descContent = project.description;
      } else {
        // Wrap the entire HTML content in a div with the class to preserve styling
        descContent = `<div class="projects__row-content-desc">${project.description}</div>`;
      }
    } else {
      // Plain text description - wrap in <p> with class
      descContent = `<p class="projects__row-content-desc">${project.description}</p>`;
    }

    return `        <div class="projects__row${centerClass}">
          <div class="projects__row-img-cont">
            <img
              src="${project.image}"
              alt="${project.title}"
              class="projects__row-img"
              loading="lazy"${imageStyle}
            />
          </div>
          <div class="projects__row-content">
            <h3 class="projects__row-content-title">${project.title}</h3>
            ${descContent}
            <a
              href="${project.detailPage}"
              class="btn btn--med btn--theme dynamicBgClr"
              target="_blank"
              >More Details</a
            >
          </div>
        </div>`;
  }).join('\n');

  // Build the new projects section
  const newProjectsSection = `    <section id="projects" class="projects sec-pad">
      <div class="main-container">
        <h2 class="heading heading-sec heading-sec__mb-bg">
          <span class="heading-sec__main">Projects</span>
        </h2>
${projectsHtml}
      </div>
    </section>`;

  // Replace the old projects section with the new one
  const newIndexContent =
    indexContent.substring(0, projectsSectionStart) +
    newProjectsSection +
    indexContent.substring(projectsSectionEnd);

  await fs.writeFile(INDEX_FILE, newIndexContent);
  console.log('Generated index.html with', projects.length, 'projects');
}

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: async function (req, file, cb) {
    const uploadDir = path.join(ASSETS_DIR, 'jpeg');
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'project-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// API Routes

// Get all projects
app.get('/api/projects', async (req, res) => {
  try {
    const data = await loadProjects();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add new project
app.post('/api/projects', async (req, res) => {
  try {
    const data = await loadProjects();
    const projectNumber = await getNextProjectNumber();
    const detailPage = req.body.detailPage || `./project-${projectNumber}.html`;

    const newProject = {
      id: Date.now(),
      ...req.body,
      detailPage: detailPage
    };
    data.projects.unshift(newProject); // Add new projects at the top (index 0)
    await saveProjects(data);

    // Create detail page template
    const detailsData = await loadProjectDetails();
    const newDetail = {
      projectId: newProject.id,
      heroImage: newProject.image || './assets/jpeg/project-placeholder.jpg',
      meta: {
        role: '',
        company: '',
        projectType: '',
        projectDate: new Date().getFullYear().toString()
      },
      overview: [
        {
          type: 'paragraph',
          content: newProject.description || 'Project overview coming soon...'
        }
      ],
      mainContent: null,
      additionalImages: [],
      keyContributions: [],
      futureDevelopment: [],
      skills: [],
      links: []
    };
    detailsData.details.push(newDetail);
    await saveProjectDetails(detailsData);

    // Generate the HTML file
    await saveDetailPageHtml(newProject.id, newProject.title, detailPage);
    await generateIndexHtml();

    res.json({ success: true, project: newProject });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update project
app.put('/api/projects/:id', async (req, res) => {
  try {
    const data = await loadProjects();
    const index = data.projects.findIndex(p => p.id === parseInt(req.params.id));
    if (index === -1) {
      return res.status(404).json({ error: 'Project not found' });
    }
    data.projects[index] = { ...data.projects[index], ...req.body };
    await saveProjects(data);
    await generateIndexHtml();
    res.json({ success: true, project: data.projects[index] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete project
app.delete('/api/projects/:id', async (req, res) => {
  try {
    const data = await loadProjects();

    const projectId = parseInt(req.params.id);
    const project = data.projects.find(p => p.id === projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Delete the generated HTML file first (so we still know the path).
    const detailDeleteResult = await deleteGeneratedProjectDetailHtmlFile(project.detailPage);

    data.projects = data.projects.filter(p => p.id !== projectId);
    await saveProjects(data);
    await generateIndexHtml();
    res.json({ success: true, deletedDetailPage: detailDeleteResult.deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reorder projects
app.post('/api/projects/reorder', async (req, res) => {
  try {
    const { projectIds } = req.body;
    const data = await loadProjects();
    const reordered = [];
    projectIds.forEach(id => {
      const project = data.projects.find(p => p.id === id);
      if (project) reordered.push(project);
    });
    data.projects = reordered;
    await saveProjects(data);
    await generateIndexHtml();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload image
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const relativePath = './assets/jpeg/' + req.file.filename;
    res.json({ success: true, path: relativePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate HTML
app.post('/api/generate', async (req, res) => {
  try {
    // Also ensure any missing detail pages exist (never overwrites existing pages)
    await ensureDetailPagesExist();
    await generateIndexHtml();
    res.json({ success: true, message: 'index.html generated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate description with AI
app.post('/api/generate-description', async (req, res) => {
  try {
    const { title, currentDescription } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: 'OpenAI API key not configured. Please add OPENAI_API_KEY to your .env file.' });
    }

    const prompt = `Write a professional, engaging project description for a portfolio website.

Project Title: ${title}
${currentDescription ? `Current Notes/Description: ${currentDescription}` : 'No current description provided.'}

Please write a concise, professional description (2-3 paragraphs) that:
- Highlights the project's purpose and impact
- Mentions key technologies or approaches where relevant
- Is written in an active, confident tone suitable for a portfolio
- Uses HTML formatting with <p> tags for paragraphs and <strong> tags for emphasis where appropriate
- Keep it under 150 words total

Return only the HTML-formatted description without any additional explanation.`;

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a professional copywriter specializing in portfolio project descriptions. You write concise, impactful descriptions that showcase technical projects effectively.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 500
    });

    const generatedDescription = completion.choices[0].message.content.trim();

    res.json({ success: true, description: generatedDescription });
  } catch (err) {
    console.error('OpenAI Error:', err);
    res.status(500).json({ error: 'Failed to generate description: ' + err.message });
  }
});

// Enhance/clean up existing description with AI
app.post('/api/enhance-description', async (req, res) => {
  try {
    const { title, currentDescription } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: 'OpenAI API key not configured. Please add OPENAI_API_KEY to your .env file.' });
    }

    if (!currentDescription || currentDescription.trim().length < 10) {
      return res.status(400).json({ error: 'Please write at least a few sentences before enhancing. The enhance feature works best with existing content to improve.' });
    }

    const prompt = `Polish and enhance the following project description for a portfolio website.

Project Title: ${title}

Current Description (may be rough draft or notes):
${currentDescription}

Please improve this description by:
- Fixing grammar, spelling, and awkward phrasing
- Improving sentence flow and readability
- Maintaining the original meaning and key points
- Using an active, confident, professional tone
- Using HTML formatting with <p> tags for paragraphs and <strong> tags for emphasis where appropriate
- Keeping similar length (don't make it significantly shorter or longer)
- Preserving any technical details or specific accomplishments mentioned

Return only the polished HTML-formatted description without any additional explanation.`;

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a professional editor specializing in polishing technical writing. You improve clarity and professionalism while preserving the author\'s original meaning and voice.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.5, // Lower temperature for more consistent/predictable editing
      max_tokens: 500
    });

    const enhancedDescription = completion.choices[0].message.content.trim();

    res.json({ success: true, description: enhancedDescription });
  } catch (err) {
    console.error('OpenAI Error:', err);
    res.status(500).json({ error: 'Failed to enhance description: ' + err.message });
  }
});

// Enhance/clean up detail page section with AI
app.post('/api/enhance-detail-section', async (req, res) => {
  try {
    const { projectTitle, section, currentContent } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: 'OpenAI API key not configured. Please add OPENAI_API_KEY to your .env file.' });
    }

    if (!currentContent || currentContent.trim().length < 10) {
      return res.status(400).json({ error: 'Please write at least a few sentences before enhancing. The enhance feature works best with existing content to improve.' });
    }

    const sectionNames = {
      overview: 'Project Overview',
      contributions: 'Key Contributions',
      future: 'Future Development'
    };

    let prompt = '';

    if (section === 'overview') {
      prompt = `Polish and enhance the following project overview for a portfolio case study page.

Project: ${projectTitle}

Current Overview (may be rough draft or notes):
${currentContent}

Please improve this overview by:
- Fixing grammar, spelling, and awkward phrasing
- Improving sentence flow and readability
- Maintaining the original meaning and key points
- Using an active, confident, professional tone
- Using HTML formatting with <p> tags for paragraphs, <strong> tags for emphasis, and • for bullet points where appropriate
- Keeping similar length (don't make it significantly shorter or longer)
- Preserving any technical details or specific accomplishments mentioned

Return only the polished HTML-formatted overview without any additional explanation.`;
    } else if (section === 'contributions') {
      prompt = `Polish and enhance the following key contribution bullet points for a portfolio case study.

Project: ${projectTitle}

Current Contributions (may be rough draft or notes):
${currentContent}

Please improve these contributions by:
- Fixing grammar, spelling, and awkward phrasing
- Starting each point with a strong action verb (Designed, Implemented, Built, etc.)
- Highlighting specific technical achievements
- Improving clarity and impact
- Using <strong> tags for emphasis on key terms
- Keeping each contribution on a separate line
- Preserving the number of contributions (don't add or remove points)

Formatting rules (important):
- Do NOT use <ul>, <ol>, or <li> tags
- Do NOT include bullet characters like '-', '*', or '•'
- Output ONE contribution per line

Return only the polished HTML-formatted bullet points, one per line, without bullet markers.`;
    } else if (section === 'future') {
      prompt = `Polish and enhance the following future development ideas for a portfolio project.

Project: ${projectTitle}

Current Future Development (may be rough draft or notes):
${currentContent}

Please improve these future development ideas by:
- Fixing grammar, spelling, and awkward phrasing
- Making them clear, realistic, and technically interesting
- Improving sentence flow and readability
- Using an active, professional tone
- Keeping each idea on a separate line
- Preserving the number of ideas (don't add or remove points)

Return only the polished bullet points, one per line, without bullet markers.`;
    }

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a professional editor specializing in polishing technical writing. You improve clarity and professionalism while preserving the author\'s original meaning and voice.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.5, // Lower temperature for more consistent/predictable editing
      max_tokens: 800
    });

    const enhancedContent = completion.choices[0].message.content.trim();

    res.json({ success: true, content: enhancedContent });
  } catch (err) {
    console.error('OpenAI Error:', err);
    res.status(500).json({ error: 'Failed to enhance section: ' + err.message });
  }
});

// ===== DETAIL PAGE API ENDPOINTS =====

// Get all project details
app.get('/api/project-details', async (req, res) => {
  try {
    const data = await loadProjectDetails();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get detail for specific project
app.get('/api/project-details/:projectId', async (req, res) => {
  try {
    const detailsData = await loadProjectDetails();
    const projectId = parseInt(req.params.projectId);
    const detail = detailsData.details.find(d => d.projectId === projectId);

    if (!detail) {
      return res.status(404).json({ error: 'Detail page not found for this project' });
    }

    res.json({ success: true, detail });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create or update detail page for a project
app.put('/api/project-details/:projectId', async (req, res) => {
  try {
    const detailsData = await loadProjectDetails();
    const projectsData = await loadProjects();
    const projectId = parseInt(req.params.projectId);

    // Find the project
    const project = projectsData.projects.find(p => p.id === projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Find or create detail
    const existingIndex = detailsData.details.findIndex(d => d.projectId === projectId);
    const newDetail = {
      projectId: projectId,
      ...req.body
    };

    if (existingIndex >= 0) {
      detailsData.details[existingIndex] = newDetail;
    } else {
      detailsData.details.push(newDetail);
    }

    await saveProjectDetails(detailsData);

    // Regenerate the HTML file
    await saveDetailPageHtml(projectId, project.title, project.detailPage);

    res.json({ success: true, detail: newDetail });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete detail page for a project
app.delete('/api/project-details/:projectId', async (req, res) => {
  try {
    const detailsData = await loadProjectDetails();
    const projectId = parseInt(req.params.projectId);

    detailsData.details = detailsData.details.filter(d => d.projectId !== projectId);
    await saveProjectDetails(detailsData);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate detail page HTML file
app.post('/api/project-details/:projectId/generate', async (req, res) => {
  try {
    const detailsData = await loadProjectDetails();
    const projectsData = await loadProjects();
    const projectId = parseInt(req.params.projectId);

    const project = projectsData.projects.find(p => p.id === projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const detail = detailsData.details.find(d => d.projectId === projectId);
    if (!detail) {
      return res.status(404).json({ error: 'Detail data not found for this project' });
    }

    const success = await saveDetailPageHtml(projectId, project.title, project.detailPage);

    if (success) {
      res.json({ success: true, message: 'Detail page generated successfully' });
    } else {
      res.status(500).json({ error: 'Failed to generate detail page' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate AI content for detail page section
app.post('/api/project-details/generate-section', async (req, res) => {
  try {
    const { projectTitle, section, currentContent, context } = req.body;

    const normalizeAiListToLines = (value) => {
      if (value === null || value === undefined) return '';
      let text = String(value).trim();

      // If the model returns <li> elements (optionally wrapped in <ul>/<ol>), extract each item.
      const liMatches = [...text.matchAll(/<li[^>]*>([\s\S]*?)<\/?li>/gi)].map(m => (m[1] || '').trim());
      if (liMatches.length > 0) {
        text = liMatches.join('\n');
      }

      // Remove remaining list wrappers and any stray <li> tags.
      text = text.replace(/<\/?(ul|ol)[^>]*>/gi, '').trim();
      text = text.replace(/<\/?li[^>]*>/gi, '').trim();

      // Normalize bullet markers per line.
      text = text
        .split(/\r?\n/)
        .map(line => line
          .replace(/^\s*(?:[-*•]+\s+|\d+[.)]\s+)/, '')
          .trim()
        )
        .filter(Boolean)
        .join('\n');

      return text;
    };

    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: 'OpenAI API key not configured' });
    }

    const sectionPrompts = {
      overview: `Write a detailed project overview for a portfolio case study page.

Project: ${projectTitle}
${context ? `Context: ${context}` : ''}

Write 2-4 paragraphs that:
- Explain what the project does and its purpose
- Highlight key technical features and innovations
- Describe the problem it solves
- Use HTML formatting with <strong> tags for emphasis
- Keep it professional but engaging
- Length: 150-300 words total

Current draft (if any): ${currentContent || 'None'}

Return only the HTML-formatted overview text.`,

      contributions: `Write key contribution bullet points for a portfolio case study.

Project: ${projectTitle}
${context ? `Context: ${context}` : ''}

Write 3-5 bullet points that:
- Start with action verbs (Designed, Implemented, Built, etc.)
- Highlight specific technical achievements
- Mention technologies used where relevant
- Quantify impact when possible
- Use <strong> tags for emphasis on key terms

Formatting rules (important):
- Do NOT use <ul>, <ol>, or <li> tags
- Do NOT include bullet characters like '-', '*', or '•'
- Output ONE contribution per line

Return only the HTML-formatted bullet points, one per line, without bullet markers (I'll add those).`,

      skills: `List technical skills for a portfolio project.

Project: ${projectTitle}
${context ? `Context: ${context}` : ''}

List 5-10 relevant skills/tools as a comma-separated list.
Examples: Python, React, TensorFlow, AWS, Git, etc.

Return only the comma-separated list.`,

      future: `Write future development ideas for a portfolio project.

Project: ${projectTitle}
${context ? `Context: ${context}` : ''}

Write 2-4 bullet points describing potential future improvements or features.
Make them realistic and technically interesting.

Return only the plain text bullet points, one per line.`
    };

    const prompt = sectionPrompts[section] || sectionPrompts.overview;

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a professional technical writer specializing in portfolio case studies.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 800
    });

    const generatedContent = completion.choices[0].message.content.trim();

    // Defensive: the model sometimes returns <li>...</li>. Normalize to "one item per line".
    const normalizedContent = (section === 'contributions' || section === 'future')
      ? normalizeAiListToLines(generatedContent)
      : generatedContent;

    res.json({ success: true, content: normalizedContent });
  } catch (err) {
    console.error('OpenAI Error:', err);
    res.status(500).json({ error: 'Failed to generate content: ' + err.message });
  }
});

// Admin UI
app.get('/admin', (req, res) => {
  // Dev UI changes frequently; avoid cached HTML/JS.
  res.setHeader('Cache-Control', 'no-store');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Portfolio Admin - Dev Mode</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Source Sans Pro', sans-serif;
      background: #f5f5f5;
      padding: 20px;
      line-height: 1.6;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h1 {
      color: #333;
      margin-bottom: 10px;
      font-size: 28px;
    }
    .subtitle {
      color: #666;
      margin-bottom: 30px;
      font-size: 14px;
    }
    .actions {
      display: flex;
      gap: 10px;
      margin-bottom: 30px;
      flex-wrap: wrap;
    }
    .btn {
      padding: 12px 24px;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      transition: all 0.3s;
    }
    .btn-primary {
      background: #0062b9;
      color: white;
    }
    .btn-primary:hover { background: #0051a8; }
    .btn-secondary {
      background: #6c757d;
      color: white;
    }
    .btn-secondary:hover { background: #5a6268; }
    .btn-success {
      background: #28a745;
      color: white;
    }
    .btn-success:hover { background: #218838; }
    .btn-danger {
      background: #dc3545;
      color: white;
    }
    .btn-danger:hover { background: #c82333; }
    .btn-ai {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      font-size: 12px;
      padding: 8px 16px;
    }
    .btn-ai:hover {
      background: linear-gradient(135deg, #5568d3 0%, #653e8f 100%);
      transform: translateY(-1px);
    }
    .btn-ai:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }
    .btn-enhance {
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
      color: white;
      font-size: 12px;
      padding: 8px 16px;
    }
    .btn-enhance:hover {
      background: linear-gradient(135deg, #e082ea 0%, #e4465b 100%);
      transform: translateY(-1px);
    }
    .btn-enhance:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }
    .preview-container {
      border: 2px solid #e9ecef;
      border-radius: 5px;
      padding: 16px;
      margin-top: 10px;
      background: #f8f9fa;
      min-height: 120px;
    }
    .preview-content {
      line-height: 1.6;
      color: #333;
    }
    .preview-content p {
      margin-bottom: 12px;
    }
    .preview-content p:last-child {
      margin-bottom: 0;
    }
    .preview-content strong {
      color: #0062b9;
    }
    .btn-active {
      background: #0062b9 !important;
    }
    .project-list {
      list-style: none;
    }
    .project-item {
      background: #f8f9fa;
      border: 2px solid #e9ecef;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 15px;
      cursor: move;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .project-item:hover {
      border-color: #0062b9;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .project-item.dragging {
      opacity: 0.5;
      border-color: #0062b9;
    }
    .drag-handle {
      color: #999;
      font-size: 20px;
      cursor: grab;
    }
    .project-preview {
      width: 120px;
      height: 80px;
      object-fit: cover;
      border-radius: 5px;
      background: #ddd;
    }
    .project-info {
      flex: 1;
    }
    .project-title {
      font-size: 18px;
      font-weight: 600;
      color: #333;
      margin-bottom: 5px;
    }
    .project-desc {
      font-size: 14px;
      color: #666;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .project-actions {
      display: flex;
      gap: 10px;
    }
    .btn-small {
      padding: 8px 16px;
      font-size: 12px;
    }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #666;
    }
    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 20px;
    }
    
    /* Modal */
    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }
    .modal.active {
      display: flex;
    }
    .modal-content {
      background: white;
      border-radius: 8px;
      width: 90%;
      max-width: 700px;
      max-height: 90vh;
      overflow-y: auto;
      padding: 30px;
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    .modal-title {
      font-size: 24px;
      color: #333;
    }
    .modal-close {
      font-size: 28px;
      color: #999;
      cursor: pointer;
      background: none;
      border: none;
    }
    .modal-close:hover { color: #333; }
    .form-group {
      margin-bottom: 20px;
    }
    .form-label {
      display: block;
      margin-bottom: 8px;
      font-weight: 600;
      color: #333;
    }
    .form-input, .form-textarea {
      width: 100%;
      padding: 12px;
      border: 2px solid #e9ecef;
      border-radius: 5px;
      font-size: 14px;
      font-family: inherit;
    }
    .form-input:focus, .form-textarea:focus {
      outline: none;
      border-color: #0062b9;
    }
    .form-textarea {
      min-height: 120px;
      resize: vertical;
    }
    .form-hint {
      font-size: 12px;
      color: #666;
      margin-top: 5px;
    }
    .image-upload {
      border: 2px dashed #ccc;
      border-radius: 8px;
      padding: 40px;
      text-align: center;
      cursor: pointer;
      transition: all 0.2s;
    }
    .image-upload:hover {
      border-color: #0062b9;
      background: #f8f9fa;
    }
    .image-preview {
      max-width: 200px;
      max-height: 150px;
      margin-top: 15px;
      border-radius: 5px;
    }
    .checkbox-group {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .checkbox-group input[type="checkbox"] {
      width: 20px;
      height: 20px;
    }
    .status {
      padding: 10px 15px;
      border-radius: 5px;
      margin-bottom: 20px;
      display: none;
    }
    .status.success {
      background: #d4edda;
      color: #155724;
      display: block;
    }
    .status.error {
      background: #f8d7da;
      color: #721c24;
      display: block;
    }
    .preview-link {
      color: #0062b9;
      text-decoration: none;
    }
    .preview-link:hover {
      text-decoration: underline;
    }
    
    /* Tabs for Detail Page Editor */
    .tabs {
      display: flex;
      gap: 5px;
      margin-bottom: 20px;
      border-bottom: 2px solid #e9ecef;
      padding-bottom: 10px;
    }
    .tab-btn {
      padding: 10px 20px;
      border: none;
      background: #f8f9fa;
      color: #666;
      cursor: pointer;
      border-radius: 5px;
      font-size: 14px;
      font-weight: 600;
      transition: all 0.2s;
    }
    .tab-btn:hover {
      background: #e9ecef;
      color: #333;
    }
    .tab-btn.active {
      background: #0062b9;
      color: white;
    }
    .tab-content {
      display: none;
    }
    .tab-content.active {
      display: block;
    }
    
    /* Image and Link Lists */
    .item-list {
      list-style: none;
      margin-bottom: 10px;
    }
    .item-list li {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px;
      background: #f8f9fa;
      border-radius: 5px;
      margin-bottom: 8px;
    }
    .item-list li span {
      flex: 1;
      font-size: 14px;
    }
    .item-list li .item-caption {
      color: #666;
      font-size: 12px;
    }
    .btn-remove {
      background: #dc3545;
      color: white;
      border: none;
      padding: 5px 10px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
    }
    .btn-remove:hover {
      background: #c82333;
    }
  </style>
</head>
<body>
  <div class="container">
    <div id="status" class="status"></div>
    
    <h1>🏗️ Portfolio Admin - Dev Mode</h1>
    <p class="subtitle">Drag projects to reorder. Click Edit to modify. All changes auto-save to index.html.</p>
    
    <div class="actions">
      <button class="btn btn-primary" onclick="openModal()">+ Add New Project</button>
      <button class="btn btn-success" onclick="generateHtml()">🔄 Generate index.html</button>
      <a href="/index.html" target="_blank" class="btn btn-secondary">👁️ Preview Site</a>
    </div>
    
    <ul id="projectList" class="project-list">
      <!-- Projects will be loaded here -->
    </ul>
    
    <div id="emptyState" class="empty-state" style="display: none;">
      <div class="empty-state-icon">📁</div>
      <h3>No projects yet</h3>
      <p>Click "Add New Project" to get started</p>
    </div>
  </div>

  <!-- Modal -->
  <div id="modal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="modalTitle" class="modal-title">Add New Project</h2>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      
      <form id="projectForm">
        <input type="hidden" id="projectId">
        
        <div class="form-group">
          <label class="form-label">Project Title *</label>
          <input type="text" id="projectTitle" class="form-input" required placeholder="e.g., Video Captioning in Military Scenarios">
        </div>
        
        <div class="form-group">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <label class="form-label" style="margin-bottom: 0;">Description *</label>
            <div style="display: flex; gap: 8px;">
              <button type="button" class="btn btn-ai" onclick="generateDescription()">
                <span id="aiBtnText">✨ Generate with AI</span>
              </button>
              <button type="button" class="btn btn-enhance" onclick="enhanceDescription()">
                <span id="enhanceBtnText">🪄 Enhance</span>
              </button>
              <button type="button" class="btn btn-secondary btn-small" onclick="togglePreview()" id="previewBtn">👁️ Preview</button>
            </div>
          </div>
          <textarea id="projectDesc" class="form-textarea" required placeholder="Describe your project... You can use <strong>HTML tags</strong> for formatting. Or just jot down rough notes and click 'Generate with AI' to polish it! Already have a draft? Click 'Enhance' to clean it up and improve the language."></textarea>
          <div id="previewContainer" class="preview-container" style="display: none;">
            <div id="previewContent" class="preview-content"></div>
          </div>
          <p class="form-hint">HTML tags are supported: &lt;strong&gt;, &lt;p&gt;, etc. Click Preview to see how it looks.</p>
        </div>
        
        <div class="form-group">
          <label class="form-label">Project Image</label>
          <div class="image-upload" onclick="document.getElementById('imageInput').click()">
            <p>📤 Click to upload image</p>
            <p class="form-hint">JPG, PNG, or SVG. Max 5MB.</p>
            <img id="imagePreview" class="image-preview" style="display: none;">
            <input type="file" id="imageInput" accept="image/*" style="display: none;" onchange="handleImageUpload(event)">
          </div>
          <input type="hidden" id="projectImage" value="./assets/jpeg/project-placeholder.jpg">
        </div>
        
        <div class="form-group">
          <label class="form-label">Image Style (optional CSS)</label>
          <input type="text" id="projectImageStyle" class="form-input" placeholder="e.g., width: 300px; height: auto;">
          <p class="form-hint">Leave empty for default styling</p>
        </div>
        
        <div class="form-group">
          <div class="checkbox-group">
            <input type="checkbox" id="projectCenterImage">
            <label for="projectCenterImage">Center image vertically</label>
          </div>
        </div>
        
        <div class="form-group">
          <label class="form-label">Detail Page Link</label>
          <input type="text" id="projectDetailPage" class="form-input" placeholder="./project-X.html">
          <p class="form-hint">Leave empty to auto-generate</p>
        </div>
        
        <div style="display: flex; gap: 10px; justify-content: flex-end;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Project</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Detail Page Editor Modal -->
  <div id="detailModal" class="modal">
    <div class="modal-content" style="max-width: 900px;">
      <div class="modal-header">
        <h2 class="modal-title">📄 Edit Detail Page</h2>
        <button class="modal-close" onclick="closeDetailModal()">&times;</button>
      </div>
      
      <div id="detailStatus" class="status"></div>
      
      <input type="hidden" id="detailProjectId">
      
       <div class="tabs">
         <button id="tabbtn-overview" class="tab-btn active" onclick="switchTab('overview')">Overview</button>
         <button id="tabbtn-meta" class="tab-btn" onclick="switchTab('meta')">Meta Info</button>
         <button id="tabbtn-content" class="tab-btn" onclick="switchTab('content')">Content</button>
         <button id="tabbtn-contributions" class="tab-btn" onclick="switchTab('contributions')">Contributions</button>
         <button id="tabbtn-skills" class="tab-btn" onclick="switchTab('skills')">Skills</button>
         <button id="tabbtn-links" class="tab-btn" onclick="switchTab('links')">Links</button>
       </div>
      
      <!-- Overview Tab -->
      <div id="tab-overview" class="tab-content active">
        <div class="form-group">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <label class="form-label">Project Overview</label>
            <div style="display: flex; gap: 8px;">
              <button type="button" class="btn btn-ai btn-small" onclick="generateDetailSection('overview')">
                <span id="overviewAiBtn">✨ Generate with AI</span>
              </button>
              <button type="button" class="btn btn-enhance btn-small" onclick="enhanceDetailSection('overview')">
                <span id="overviewEnhanceBtn">🪄 Enhance</span>
              </button>
            </div>
          </div>
          <textarea id="detailOverview" class="form-textarea" rows="10" placeholder="Write a project overview here. Use HTML tags for formatting."></textarea>
          <p class="form-hint">Main project description. Supports HTML formatting with &lt;p&gt;, &lt;strong&gt;, etc.</p>
        </div>
      </div>
      
      <!-- Meta Info Tab -->
      <div id="tab-meta" class="tab-content">
        <div class="form-group">
          <label class="form-label">Role / Project Type</label>
          <input type="text" id="detailRole" class="form-input" placeholder="e.g., AI Engineer, Personal Project">
        </div>
        <div class="form-group">
          <label class="form-label">Company (optional)</label>
          <input type="text" id="detailCompany" class="form-input" placeholder="e.g., ST Engineering">
        </div>
        <div class="form-group">
          <label class="form-label">Project Date</label>
          <input type="text" id="detailDate" class="form-input" placeholder="e.g., Sept 2024 – May 2025">
        </div>
        <div class="form-group">
          <label class="form-label">Hero Image</label>
          <div class="image-upload" onclick="document.getElementById('heroImageInput').click()">
            <p>📤 Click to upload hero image</p>
            <p class="form-hint">JPG, PNG, or SVG. Max 5MB.</p>
            <img id="heroImagePreview" class="image-preview" style="display: none;">
            <input type="file" id="heroImageInput" accept="image/*" style="display: none;" onchange="handleHeroImageUpload(event)">
          </div>
          <input type="hidden" id="detailHeroImage" value="">
          <p class="form-hint">Main showcase image at the top of the detail page</p>
        </div>
      </div>
      
      <!-- Content Tab -->
      <div id="tab-content" class="tab-content">
        <div class="form-group">
          <label class="form-label">Main Content Section Title</label>
          <input type="text" id="mainContentTitle" class="form-input" placeholder="e.g., Research, Design Process, Results">
          <p class="form-hint">This creates a flexible section that can include subtitles, images, and descriptions. Leave empty to hide this section.</p>
        </div>

        <div class="form-group">
          <label class="form-label">Section Description (optional)</label>
          <textarea id="mainContentDescription" class="form-textarea" rows="4" placeholder="Intro text for this section. Separate paragraphs with blank lines."></textarea>
          <p class="form-hint">Supports simple HTML like &lt;strong&gt;. Separate paragraphs with blank lines.</p>
        </div>

        <div class="form-group">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <label class="form-label" style="margin-bottom: 0;">Blocks</label>
            <button type="button" class="btn btn-secondary btn-small" onclick="addMainContentBlock()">+ Add Block</button>
          </div>
          <div id="mainContentBlocksList"></div>
          <input type="file" id="mainContentImageInput" accept="image/*" style="display: none;" onchange="handleMainContentBlockImageUpload(event)">
        </div>

        <div class="form-group">
          <label class="form-label">Conclusion (optional)</label>
          <textarea id="mainContentConclusion" class="form-textarea" rows="4" placeholder="Conclusion text. Separate paragraphs with blank lines."></textarea>
          <p class="form-hint">Optional closing text for this section.</p>
        </div>

        <div id="legacyImagesContainer" class="form-group" style="display: none;">
          <label class="form-label">Legacy Additional Images (deprecated)</label>
          <p class="form-hint">This project has images saved in the old format. You can import them into content blocks.</p>
          <div style="display: flex; gap: 10px; align-items: center;">
            <button type="button" class="btn btn-secondary btn-small" onclick="importLegacyAdditionalImages()">Import legacy images</button>
            <span id="legacyImagesCount" class="form-hint" style="margin: 0;"></span>
          </div>
        </div>
      </div>
      
      <!-- Contributions Tab -->
      <div id="tab-contributions" class="tab-content">
        <div class="form-group">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <label class="form-label">Key Contributions</label>
            <div style="display: flex; gap: 8px;">
              <button type="button" class="btn btn-ai btn-small" onclick="generateDetailSection('contributions')">
                <span id="contribAiBtn">✨ Generate with AI</span>
              </button>
              <button type="button" class="btn btn-enhance btn-small" onclick="enhanceDetailSection('contributions')">
                <span id="contribEnhanceBtn">🪄 Enhance</span>
              </button>
            </div>
          </div>
          <textarea id="detailContributions" class="form-textarea" rows="8" placeholder="One contribution per line. Use HTML for formatting."></textarea>
          <p class="form-hint">Enter each contribution on a new line. Use &lt;strong&gt; for emphasis.</p>
        </div>
        <div class="form-group">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <label class="form-label">Future Development (optional)</label>
            <div style="display: flex; gap: 8px;">
              <button type="button" class="btn btn-ai btn-small" onclick="generateDetailSection('future')">
                <span id="futureAiBtn">✨ Generate with AI</span>
              </button>
              <button type="button" class="btn btn-enhance btn-small" onclick="enhanceDetailSection('future')">
                <span id="futureEnhanceBtn">🪄 Enhance</span>
              </button>
            </div>
          </div>
          <textarea id="detailFuture" class="form-textarea" rows="6" placeholder="Future development ideas, one per line"></textarea>
          <p class="form-hint">Enter each future development item on a new line.</p>
        </div>
      </div>
      
      <!-- Skills Tab -->
      <div id="tab-skills" class="tab-content">
        <div class="form-group">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <label class="form-label">Skills and Tools</label>
            <button type="button" class="btn btn-ai btn-small" onclick="generateDetailSection('skills')">
              <span id="skillsAiBtn">✨ Generate with AI</span>
            </button>
          </div>
          <input type="text" id="detailSkills" class="form-input" placeholder="e.g., Python, React, TensorFlow, Git, AWS">
          <p class="form-hint">Comma-separated list of skills and tools</p>
        </div>
      </div>
      
      <!-- Links Tab -->
      <div id="tab-links" class="tab-content">
        <div class="form-group">
          <label class="form-label">Project Links</label>
          <div id="projectLinksList" style="margin-bottom: 15px;">
            <!-- Links will be listed here -->
          </div>
          <div style="display: flex; gap: 10px;">
            <input type="text" id="newLinkLabel" class="form-input" placeholder="Label (e.g., GitHub, Website)" style="flex: 1;">
            <input type="text" id="newLinkUrl" class="form-input" placeholder="URL (e.g., https://github.com/...)" style="flex: 2;">
            <button type="button" class="btn btn-secondary" onclick="addProjectLink()">Add</button>
          </div>
        </div>
      </div>
      
      <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px; padding-top: 20px; border-top: 1px solid #e9ecef;">
        <button type="button" class="btn btn-secondary" onclick="closeDetailModal()">Cancel</button>
        <button type="button" class="btn btn-success" onclick="previewDetailPage()">👁️ Preview</button>
        <button type="button" class="btn btn-primary" onclick="saveDetailPage()">💾 Save Detail Page</button>
      </div>
    </div>
  </div>

      <script>
        let projects = [];
        let projectDetails = [];
        let draggedItem = null;
        let editingId = null;
        let currentDetail = null;
        let legacyAdditionalImages = [];
        let mainContentBlocks = [];
        let pendingMainContentImageBlockIndex = null;
        let projectLinks = [];

    // Load projects and details on page load
    async function loadProjects() {
      try {
        const [projectsRes, detailsRes] = await Promise.all([
          fetch('/api/projects'),
          fetch('/api/project-details')
        ]);
        const projectsData = await projectsRes.json();
        const detailsData = await detailsRes.json();
        projects = projectsData.projects || [];
        projectDetails = detailsData.details || [];
        renderProjects();
      } catch (err) {
        showStatus('Error loading projects: ' + err.message, 'error');
      }
    }


    // Render project list
    function renderProjects() {
      const list = document.getElementById('projectList');
      const emptyState = document.getElementById('emptyState');
      
      if (projects.length === 0) {
        list.innerHTML = '';
        emptyState.style.display = 'block';
        return;
      }
      
      emptyState.style.display = 'none';
      
      list.innerHTML = projects.map(project => {
        const cleanDesc = project.description.replace(/<[^>]*>/g, '').substring(0, 100) + '...';
        return '<li class="project-item" draggable="true" data-id="' + project.id + '">' +
            '<span class="drag-handle">⋮⋮</span>' +
            '<img src="' + project.image + '" class="project-preview" onerror="this.src=\\'./assets/jpeg/project-placeholder.jpg\\'">' +
            '<div class="project-info">' +
              '<div class="project-title">' + project.title + '</div>' +
              '<div class="project-desc">' + cleanDesc + '</div>' +
            '</div>' +
            '<div class="project-actions">' +
              '<button class="btn btn-secondary btn-small" onclick="editProject(' + project.id + ')">Edit</button>' +
              '<button class="btn btn-primary btn-small" onclick="editDetailPage(' + project.id + ')">📄 Details</button>' +
              '<button class="btn btn-danger btn-small" onclick="deleteProject(' + project.id + ')">Delete</button>' +
            '</div>' +
          '</li>';
      }).join('');
      
      // Add drag and drop listeners
      document.querySelectorAll('.project-item').forEach(item => {
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragend', handleDragEnd);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('drop', handleDrop);
      });
    }

    // Drag and drop handlers
    function handleDragStart(e) {
      draggedItem = this;
      this.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    }

    function handleDragEnd(e) {
      this.classList.remove('dragging');
      draggedItem = null;
    }

    function handleDragOver(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }

    async function handleDrop(e) {
      e.preventDefault();
      if (draggedItem === this) return;
      
      const draggedId = parseInt(draggedItem.dataset.id);
      const targetId = parseInt(this.dataset.id);
      
      const draggedIndex = projects.findIndex(p => p.id === draggedId);
      const targetIndex = projects.findIndex(p => p.id === targetId);
      
      // Reorder array
      const [removed] = projects.splice(draggedIndex, 1);
      projects.splice(targetIndex, 0, removed);
      
      renderProjects();
      
      // Save new order
      try {
        await fetch('/api/projects/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectIds: projects.map(p => p.id) })
        });
        showStatus('Projects reordered successfully!', 'success');
      } catch (err) {
        showStatus('Error saving order: ' + err.message, 'error');
      }
    }

    // Modal functions
    function openModal(projectId = null) {
      editingId = projectId;
      const modal = document.getElementById('modal');
      const title = document.getElementById('modalTitle');
      const form = document.getElementById('projectForm');
      
      if (projectId) {
        const project = projects.find(p => p.id === projectId);
        title.textContent = 'Edit Project';
        document.getElementById('projectId').value = project.id;
        document.getElementById('projectTitle').value = project.title;
        document.getElementById('projectDesc').value = project.description;
        document.getElementById('projectImage').value = project.image;
        document.getElementById('projectImageStyle').value = project.imageStyle || '';
        document.getElementById('projectCenterImage').checked = project.centerImage || false;
        document.getElementById('projectDetailPage').value = project.detailPage || '';
        
        // Show image preview
        const preview = document.getElementById('imagePreview');
        preview.src = project.image;
        preview.style.display = 'block';
      } else {
        title.textContent = 'Add New Project';
        form.reset();
        document.getElementById('projectId').value = '';
        document.getElementById('imagePreview').style.display = 'none';
        document.getElementById('projectImage').value = './assets/jpeg/project-placeholder.jpg';
      }
      
      modal.classList.add('active');
    }

    function closeModal() {
      document.getElementById('modal').classList.remove('active');
      editingId = null;
    }

    // Image upload
    async function handleImageUpload(e) {
      const file = e.target.files[0];
      if (!file) return;

      const formData = new FormData();
      formData.append('image', file);

      try {
        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });
        const data = await response.json();

        if (data.success) {
          document.getElementById('projectImage').value = data.path;
          const preview = document.getElementById('imagePreview');
          preview.src = data.path;
          preview.style.display = 'block';
        } else {
          showStatus('Upload failed: ' + data.error, 'error');
        }
      } catch (err) {
        showStatus('Error uploading image: ' + err.message, 'error');
      }
    }

    // Main Content block image upload
    function triggerMainContentImageUpload(blockIndex) {
      pendingMainContentImageBlockIndex = blockIndex;
      const input = document.getElementById('mainContentImageInput');
      input.value = '';
      input.click();
    }

    async function handleMainContentBlockImageUpload(e) {
      const file = e.target.files[0];
      if (!file) return;

      if (pendingMainContentImageBlockIndex === null || pendingMainContentImageBlockIndex === undefined) {
        showDetailStatus('No target block selected for image upload.', 'error');
        return;
      }

      const formData = new FormData();
      formData.append('image', file);

      try {
        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });
        const data = await response.json();

        if (data.success) {
          const index = pendingMainContentImageBlockIndex;
          if (!mainContentBlocks[index]) {
            showDetailStatus('Block not found for image upload.', 'error');
            return;
          }
          mainContentBlocks[index].image = { src: data.path };
          renderMainContentBlocks();
          showDetailStatus('Image uploaded and added to the block!', 'success');
        } else {
          showDetailStatus('Upload failed: ' + data.error, 'error');
        }
      } catch (err) {
        showDetailStatus('Error uploading image: ' + err.message, 'error');
      } finally {
        pendingMainContentImageBlockIndex = null;
      }
    }

    // Hero image upload for detail page
    async function handleHeroImageUpload(e) {
      const file = e.target.files[0];
      if (!file) return;

      const formData = new FormData();
      formData.append('image', file);

      try {
        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });
        const data = await response.json();

        if (data.success) {
          document.getElementById('detailHeroImage').value = data.path;
          const preview = document.getElementById('heroImagePreview');
          preview.src = data.path;
          preview.style.display = 'block';
          showDetailStatus('Hero image uploaded successfully!', 'success');
        } else {
          showDetailStatus('Upload failed: ' + data.error, 'error');
        }
      } catch (err) {
        showDetailStatus('Error uploading hero image: ' + err.message, 'error');
      }
    }

    // Form submission
    document.getElementById('projectForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const projectData = {
        title: document.getElementById('projectTitle').value,
        description: document.getElementById('projectDesc').value,
        image: document.getElementById('projectImage').value,
        imageStyle: document.getElementById('projectImageStyle').value,
        centerImage: document.getElementById('projectCenterImage').checked,
        detailPage: document.getElementById('projectDetailPage').value || undefined
      };
      
      try {
        let response;
        if (editingId) {
          response = await fetch('/api/projects/' + editingId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(projectData)
          });
        } else {
          response = await fetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(projectData)
          });
        }
        
        const data = await response.json();
        if (data.success) {
          closeModal();
          await loadProjects();
          showStatus(editingId ? 'Project updated!' : 'Project added!', 'success');
        } else {
          showStatus('Error: ' + data.error, 'error');
        }
      } catch (err) {
        showStatus('Error saving project: ' + err.message, 'error');
      }
    });

    // Edit project
    function editProject(id) {
      openModal(id);
    }

    // Delete project
    async function deleteProject(id) {
      if (!confirm('Are you sure you want to delete this project and its detail page?')) return;
      
      try {
        // Delete project
        const response = await fetch('/api/projects/' + id, {
          method: 'DELETE'
        });
        const data = await response.json();
        
        if (data.success) {
          // Also delete detail page data
          try {
            await fetch('/api/project-details/' + id, {
              method: 'DELETE'
            });
            projectDetails = projectDetails.filter(d => d.projectId !== id);
          } catch (detailErr) {
            console.log('Detail page delete error (non-critical):', detailErr);
          }
          
          await loadProjects();
          showStatus('Project and detail page deleted!', 'success');
        } else {
          showStatus('Error: ' + data.error, 'error');
        }
      } catch (err) {
        showStatus('Error deleting project: ' + err.message, 'error');
      }
    }

    // Generate HTML
    async function generateHtml() {
      try {
        const response = await fetch('/api/generate', {
          method: 'POST'
        });
        const data = await response.json();
        
        if (data.success) {
          showStatus('index.html generated successfully! View it at /index.html', 'success');
        } else {
          showStatus('Error: ' + data.error, 'error');
        }
      } catch (err) {
        showStatus('Error generating HTML: ' + err.message, 'error');
      }
    }

    // Show status message
    function showStatus(message, type) {
      const status = document.getElementById('status');
      status.textContent = message;
      status.className = 'status ' + type;
      setTimeout(() => {
        status.className = 'status';
      }, 5000);
    }

    // Close modal on outside click
    document.getElementById('modal').addEventListener('click', (e) => {
      if (e.target.id === 'modal') closeModal();
    });

    // Generate description with AI
    async function generateDescription() {
      const title = document.getElementById('projectTitle').value;
      const currentDesc = document.getElementById('projectDesc').value;
      const aiBtn = document.querySelector('.btn-ai');
      const aiBtnText = document.getElementById('aiBtnText');

      if (!title) {
        showStatus('Please enter a project title first!', 'error');
        document.getElementById('projectTitle').focus();
        return;
      }

      // Show loading state
      aiBtn.disabled = true;
      const originalText = aiBtnText.textContent;
      aiBtnText.textContent = '⏳ Generating...';

      try {
        const response = await fetch('/api/generate-description', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title,
            currentDescription: currentDesc
          })
        });

        const data = await response.json();

        if (data.success) {
          document.getElementById('projectDesc').value = data.description;
          showStatus('✨ Description generated successfully!', 'success');

          // If preview is open, update it
          const previewContainer = document.getElementById('previewContainer');
          if (previewContainer.style.display !== 'none') {
            updatePreview();
          }
        } else {
          showStatus('Error: ' + data.error, 'error');
        }
      } catch (err) {
        showStatus('Error generating description: ' + err.message, 'error');
      } finally {
        aiBtn.disabled = false;
        aiBtnText.textContent = originalText;
      }
    }

    // Enhance existing description with AI
    async function enhanceDescription() {
      const title = document.getElementById('projectTitle').value;
      const currentDesc = document.getElementById('projectDesc').value;
      const enhanceBtn = document.querySelector('.btn-enhance');
      const enhanceBtnText = document.getElementById('enhanceBtnText');

      if (!title) {
        showStatus('Please enter a project title first!', 'error');
        document.getElementById('projectTitle').focus();
        return;
      }

      if (!currentDesc || currentDesc.trim().length < 10) {
        showStatus('Please write at least a few sentences before enhancing!', 'error');
        document.getElementById('projectDesc').focus();
        return;
      }

      // Show loading state
      enhanceBtn.disabled = true;
      const originalText = enhanceBtnText.textContent;
      enhanceBtnText.textContent = '🪄 Enhancing...';

      try {
        const response = await fetch('/api/enhance-description', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title,
            currentDescription: currentDesc
          })
        });

        const data = await response.json();

        if (data.success) {
          document.getElementById('projectDesc').value = data.description;
          showStatus('🪄 Description enhanced successfully!', 'success');

          // If preview is open, update it
          const previewContainer = document.getElementById('previewContainer');
          if (previewContainer.style.display !== 'none') {
            updatePreview();
          }
        } else {
          showStatus('Error: ' + data.error, 'error');
        }
      } catch (err) {
        showStatus('Error enhancing description: ' + err.message, 'error');
      } finally {
        enhanceBtn.disabled = false;
        enhanceBtnText.textContent = originalText;
      }
    }

    // Toggle preview mode
    function togglePreview() {
      const textarea = document.getElementById('projectDesc');
      const previewContainer = document.getElementById('previewContainer');
      const previewBtn = document.getElementById('previewBtn');
      
      if (previewContainer.style.display === 'none') {
        // Show preview
        updatePreview();
        textarea.style.display = 'none';
        previewContainer.style.display = 'block';
        previewBtn.textContent = '✏️ Edit';
        previewBtn.classList.add('btn-active');
      } else {
        // Show textarea
        textarea.style.display = 'block';
        previewContainer.style.display = 'none';
        previewBtn.textContent = '👁️ Preview';
        previewBtn.classList.remove('btn-active');
      }
    }

    // Update preview content
    function updatePreview() {
      const content = document.getElementById('projectDesc').value;
      const previewContent = document.getElementById('previewContent');
      
      // Wrap in portfolio's class for styling
      previewContent.innerHTML = '<div class="projects__row-content-desc">' + content + '</div>';
    }

    // ===== DETAIL PAGE EDITOR FUNCTIONS =====
    
    // Open detail page editor
    async function editDetailPage(projectId) {
      const project = projects.find(p => p.id === projectId);
      if (!project) {
        showStatus('Project not found', 'error');
        return;
      }
      
      document.getElementById('detailProjectId').value = projectId;
      
      // Load existing detail data
      try {
        const response = await fetch('/api/project-details/' + projectId);
        if (response.ok) {
          const data = await response.json();
          currentDetail = data.detail;
          populateDetailForm(currentDetail);
        } else {
          // No existing detail, create from project data
          currentDetail = {
            projectId: projectId,
            heroImage: project.image || './assets/jpeg/project-placeholder.jpg',
            meta: {
              role: '',
              company: '',
              projectType: '',
              projectDate: new Date().getFullYear().toString()
            },
            overview: [{ type: 'paragraph', content: project.description || '' }],
            mainContent: null,
            additionalImages: [],
            keyContributions: [],
            futureDevelopment: [],
            skills: [],
            links: []
          };
          populateDetailForm(currentDetail);
        }
      } catch (err) {
        showStatus('Error loading detail page: ' + err.message, 'error');
        return;
      }
      
      // Show modal
      document.getElementById('detailModal').classList.add('active');
      switchTab('overview');
    }
    
    // Populate detail form with data
    function populateDetailForm(detail) {
      const meta = detail.meta || {};
      document.getElementById('detailRole').value = meta.role || meta.projectType || '';
      document.getElementById('detailCompany').value = meta.company || '';
      document.getElementById('detailDate').value = meta.projectDate || '';
      document.getElementById('detailHeroImage').value = detail.heroImage || '';

      // Set hero image preview if exists
      if (detail.heroImage) {
        const heroPreview = document.getElementById('heroImagePreview');
        heroPreview.src = detail.heroImage;
        heroPreview.style.display = 'block';
      }

      // Overview - convert array to textarea format
      if (detail.overview && detail.overview.length > 0) {
        const overviewText = detail.overview.map(item => {
          if (item.type === 'paragraph') return item.content;
          if (item.type === 'heading') return '<strong>' + item.content + '</strong>';
          if (item.type === 'bullet') return '• ' + item.content;
          if (item.type === 'note') return 'NOTE: ' + item.content;
          return '';
        }).join('\\n\\n');
        document.getElementById('detailOverview').value = overviewText;
      } else {
        document.getElementById('detailOverview').value = '';
      }
      
      // Contributions
      if (detail.keyContributions && detail.keyContributions.length > 0) {
        document.getElementById('detailContributions').value = detail.keyContributions.join('\\n');
      } else {
        document.getElementById('detailContributions').value = '';
      }
      
      // Future Development
      if (detail.futureDevelopment && detail.futureDevelopment.length > 0) {
        document.getElementById('detailFuture').value = detail.futureDevelopment.join('\\n');
      } else {
        document.getElementById('detailFuture').value = '';
      }
      
      // Skills
      if (detail.skills && detail.skills.length > 0) {
        document.getElementById('detailSkills').value = detail.skills.join(', ');
      } else {
        document.getElementById('detailSkills').value = '';
      }
      
      // Main Content (new flexible section)
      const mainContent = detail.mainContent || {};
      document.getElementById('mainContentTitle').value = mainContent.title || '';
      document.getElementById('mainContentDescription').value = mainContent.description || '';
      document.getElementById('mainContentConclusion').value = mainContent.conclusion || '';

      mainContentBlocks = Array.isArray(mainContent.blocks)
        ? mainContent.blocks.map(block => ({
            subtitle: block && block.subtitle ? String(block.subtitle) : '',
            description: block && block.description ? String(block.description) : '',
            image: block && block.image && block.image.src ? { src: String(block.image.src) } : null
          }))
        : [];

      renderMainContentBlocks();

      // Legacy additional images (kept for backward compatibility)
      legacyAdditionalImages = detail.additionalImages || [];
      const legacyContainer = document.getElementById('legacyImagesContainer');
      const legacyCount = document.getElementById('legacyImagesCount');
      if (legacyAdditionalImages.length > 0) {
        legacyContainer.style.display = 'block';
        legacyCount.textContent = legacyAdditionalImages.length + ' image(s) available';
      } else {
        legacyContainer.style.display = 'none';
        legacyCount.textContent = '';
      }

      // Links
      projectLinks = detail.links || [];
      renderProjectLinks();
    }
    
    // Switch tabs in detail editor
    function switchTab(tabName) {
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

      const tabBtn = document.getElementById('tabbtn-' + tabName);
      if (tabBtn) tabBtn.classList.add('active');

      const tabContent = document.getElementById('tab-' + tabName);
      if (tabContent) tabContent.classList.add('active');
    }
    
    // Close detail modal
    function closeDetailModal() {
      document.getElementById('detailModal').classList.remove('active');
      currentDetail = null;
      legacyAdditionalImages = [];
      mainContentBlocks = [];
      pendingMainContentImageBlockIndex = null;
      projectLinks = [];

      // Clear image previews
      const heroPreview = document.getElementById('heroImagePreview');
      heroPreview.src = '';
      heroPreview.style.display = 'none';

      // Clear main content inputs
      document.getElementById('mainContentTitle').value = '';
      document.getElementById('mainContentDescription').value = '';
      document.getElementById('mainContentConclusion').value = '';
      renderMainContentBlocks();

      const legacyContainer = document.getElementById('legacyImagesContainer');
      const legacyCount = document.getElementById('legacyImagesCount');
      legacyContainer.style.display = 'none';
      legacyCount.textContent = '';
    }

    // Escape helper for safe HTML insertion
    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // Render main content blocks
    function renderMainContentBlocks() {
      const container = document.getElementById('mainContentBlocksList');

      if (!mainContentBlocks || mainContentBlocks.length === 0) {
        container.innerHTML = '<p class="form-hint">No blocks yet. Click “+ Add Block” to add text/images.</p>';
        return;
      }

      container.innerHTML = mainContentBlocks.map((block, index) => {
        const subtitle = block && block.subtitle ? block.subtitle : '';
        const description = block && block.description ? block.description : '';
        const imageSrc = block && block.image && block.image.src ? block.image.src : '';

        const previewHtml = imageSrc
          ? '<img src="' + escapeHtml(imageSrc) + '" class="image-preview" style="display:block; max-width: 100%; max-height: 260px; margin: 10px 0;">'
          : '';

        const imageActions = imageSrc
          ? '<a href="' + escapeHtml(imageSrc) + '" target="_blank" class="preview-link">View</a>'
            + '<button type="button" class="btn btn-danger btn-small" onclick="removeMainContentBlockImage(' + index + ')">Remove Image</button>'
          : '<span class="form-hint" style="margin: 0;">No image</span>';

        const imageBtnText = imageSrc ? 'Replace Image' : 'Add Image';

        return (
          '<div class="content-block" style="border: 2px solid #e9ecef; border-radius: 8px; padding: 15px; background: #f8f9fa; margin-bottom: 12px;">'
            + '<div style="display:flex; gap:10px; align-items:center; margin-bottom:10px;">'
              + '<input type="text" class="form-input" placeholder="Subtitle (optional)" value="' + escapeHtml(subtitle) + '" oninput="updateMainContentBlockField(' + index + ', \\\'subtitle\\\', this.value)" style="flex: 1;">'
              + '<button type="button" class="btn btn-danger btn-small" onclick="removeMainContentBlock(' + index + ')">Remove Block</button>'
            + '</div>'
            + '<div style="display:flex; gap:10px; align-items:center; flex-wrap: wrap;">'
              + '<button type="button" class="btn btn-secondary btn-small" onclick="triggerMainContentImageUpload(' + index + ')">' + imageBtnText + '</button>'
              + imageActions
            + '</div>'
            + previewHtml
            + '<textarea class="form-textarea" rows="4" placeholder="Description (optional). Separate paragraphs with blank lines." oninput="updateMainContentBlockField(' + index + ', \\\'description\\\', this.value)">' + escapeHtml(description) + '</textarea>'
          + '</div>'
        );
      }).join('');
    }

    function addMainContentBlock() {
      mainContentBlocks.push({ subtitle: '', description: '', image: null });
      renderMainContentBlocks();
    }

    function removeMainContentBlock(index) {
      mainContentBlocks.splice(index, 1);
      renderMainContentBlocks();
    }

    function removeMainContentBlockImage(index) {
      if (mainContentBlocks[index]) {
        mainContentBlocks[index].image = null;
        renderMainContentBlocks();
      }
    }

    function updateMainContentBlockField(index, field, value) {
      if (!mainContentBlocks[index]) return;
      if (field === 'subtitle') mainContentBlocks[index].subtitle = value;
      if (field === 'description') mainContentBlocks[index].description = value;
    }

    function importLegacyAdditionalImages() {
      if (!legacyAdditionalImages || legacyAdditionalImages.length === 0) {
        showDetailStatus('No legacy images to import.', 'error');
        return;
      }

      if (mainContentBlocks.length > 0) {
        const ok = confirm('This will append legacy images as new blocks (it will not remove existing blocks). Continue?');
        if (!ok) return;
      }

      const titleInput = document.getElementById('mainContentTitle');
      if (!titleInput.value.trim()) {
        titleInput.value = 'Highlights';
      }

      legacyAdditionalImages.forEach(img => {
        const caption = img && img.caption ? String(img.caption) : '';
        const src = img && img.src ? String(img.src) : '';
        mainContentBlocks.push({
          subtitle: '',
          description: caption,
          image: src ? { src } : null
        });
      });

      renderMainContentBlocks();
      showDetailStatus('Imported legacy images into content blocks.', 'success');
    }
    
    // Render project links list
    function renderProjectLinks() {
      const container = document.getElementById('projectLinksList');
      if (projectLinks.length === 0) {
        container.innerHTML = '<p class="form-hint">No links yet</p>';
        return;
      }
      
      container.innerHTML = '<ul class="item-list">' + 
        projectLinks.map((link, index) => '<li>' +
            '<span><strong>' + link.label + ':</strong> ' + link.url + '</span>' +
            '<button class="btn-remove" onclick="removeProjectLink(' + index + ')">Remove</button>' +
          '</li>').join('') + 
      '</ul>';
    }
    
    // Add project link
    function addProjectLink() {
      const label = document.getElementById('newLinkLabel').value.trim();
      const url = document.getElementById('newLinkUrl').value.trim();
      
      if (!label || !url) {
        showDetailStatus('Please enter both label and URL', 'error');
        return;
      }
      
      projectLinks.push({ label, url });
      document.getElementById('newLinkLabel').value = '';
      document.getElementById('newLinkUrl').value = '';
      renderProjectLinks();
    }
    
    // Remove project link
    function removeProjectLink(index) {
      projectLinks.splice(index, 1);
      renderProjectLinks();
    }
    
    // Generate detail section with AI
    async function generateDetailSection(section) {
      const projectId = document.getElementById('detailProjectId').value;
      const project = projects.find(p => p.id === parseInt(projectId));
      
      const btnMap = {
        overview: 'overviewAiBtn',
        contributions: 'contribAiBtn',
        future: 'futureAiBtn',
        skills: 'skillsAiBtn'
      };
      
      const btnId = btnMap[section];
      const btn = document.querySelector('#' + btnId).parentElement;
      const originalText = document.getElementById(btnId).textContent;
      
      btn.disabled = true;
      document.getElementById(btnId).textContent = '⏳ Generating...';
      
      let currentContent = '';
      if (section === 'overview') {
        currentContent = document.getElementById('detailOverview').value;
      } else if (section === 'contributions') {
        currentContent = document.getElementById('detailContributions').value;
      } else if (section === 'future') {
        currentContent = document.getElementById('detailFuture').value;
      } else if (section === 'skills') {
        currentContent = document.getElementById('detailSkills').value;
      }
      
      try {
        const response = await fetch('/api/project-details/generate-section', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectTitle: project.title,
            section: section,
            currentContent: currentContent,
            context: document.getElementById('detailOverview').value.substring(0, 200)
          })
        });
        
        const data = await response.json();
        
        if (data.success) {
          if (section === 'overview') {
            document.getElementById('detailOverview').value = data.content;
          } else if (section === 'contributions') {
            document.getElementById('detailContributions').value = data.content;
          } else if (section === 'future') {
            document.getElementById('detailFuture').value = data.content;
          } else if (section === 'skills') {
            document.getElementById('detailSkills').value = data.content;
          }
          showDetailStatus('✨ Content generated successfully!', 'success');
        } else {
          showDetailStatus('Error: ' + data.error, 'error');
        }
      } catch (err) {
        showDetailStatus('Error generating content: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        document.getElementById(btnId).textContent = originalText;
      }
    }

    // Enhance detail section with AI
    async function enhanceDetailSection(section) {
      const projectId = document.getElementById('detailProjectId').value;
      const project = projects.find(p => p.id === parseInt(projectId));

      const btnMap = {
        overview: 'overviewEnhanceBtn',
        contributions: 'contribEnhanceBtn',
        future: 'futureEnhanceBtn'
      };

      const btnId = btnMap[section];
      const btn = document.querySelector('#' + btnId).parentElement;
      const originalText = document.getElementById(btnId).textContent;

      let currentContent = '';
      if (section === 'overview') {
        currentContent = document.getElementById('detailOverview').value;
      } else if (section === 'contributions') {
        currentContent = document.getElementById('detailContributions').value;
      } else if (section === 'future') {
        currentContent = document.getElementById('detailFuture').value;
      }

      if (!currentContent || currentContent.trim().length < 10) {
        showDetailStatus('Please write at least a few sentences before enhancing!', 'error');
        if (section === 'overview') {
          document.getElementById('detailOverview').focus();
        } else if (section === 'contributions') {
          document.getElementById('detailContributions').focus();
        } else if (section === 'future') {
          document.getElementById('detailFuture').focus();
        }
        return;
      }

      btn.disabled = true;
      document.getElementById(btnId).textContent = '🪄 Enhancing...';

      try {
        const response = await fetch('/api/enhance-detail-section', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectTitle: project.title,
            section: section,
            currentContent: currentContent
          })
        });

        const data = await response.json();

        if (data.success) {
          if (section === 'overview') {
            document.getElementById('detailOverview').value = data.content;
          } else if (section === 'contributions') {
            document.getElementById('detailContributions').value = data.content;
          } else if (section === 'future') {
            document.getElementById('detailFuture').value = data.content;
          }
          showDetailStatus('🪄 Section enhanced successfully!', 'success');
        } else {
          showDetailStatus('Error: ' + data.error, 'error');
        }
      } catch (err) {
        showDetailStatus('Error enhancing section: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        document.getElementById(btnId).textContent = originalText;
      }
    }
    
    // Save detail page
    async function saveDetailPage() {
      const projectId = parseInt(document.getElementById('detailProjectId').value);
      const project = projects.find(p => p.id === projectId);
      
      // Parse overview text into array format
      const overviewText = document.getElementById('detailOverview').value;
      const overview = [];
      if (overviewText.trim()) {
        // NOTE: inside server-side template literal; keep backslashes escaped.
        const paragraphs = overviewText.split(/\\n\\n+/);
        for (const para of paragraphs) {
          const trimmed = para.trim();
          if (!trimmed) continue;
          
          if (trimmed.startsWith('NOTE:')) {
            overview.push({ type: 'note', content: trimmed.substring(5).trim() });
          } else if (trimmed.startsWith('•')) {
            overview.push({ type: 'bullet', content: trimmed.substring(1).trim() });
          } else if (trimmed.startsWith('<strong>') && trimmed.endsWith('</strong>')) {
            overview.push({
              type: 'heading',
              content: trimmed.replaceAll('<strong>', '').replaceAll('</strong>', '')
            });
          } else {
            overview.push({ type: 'paragraph', content: trimmed });
          }
        }
      }
      
      // Parse contributions
      const contributionsText = document.getElementById('detailContributions').value;
      const keyContributions = contributionsText
        .split('\\n')
        .map(line => line
          .replace(/<\\/?(ul|ol)[^>]*>/gi, '')
          .replace(/^\\s*<li[^>]*>\\s*/i, '')
          .replace(/\\s*<\\/?li>\\s*$/i, '')
          .replace(/^\\s*(?:[-*•]+\\s+|\\d+[.)]\\s+)/, '')
          .trim()
        )
        .filter(Boolean);
      
      // Parse future development
      const futureText = document.getElementById('detailFuture').value;
      const futureDevelopment = futureText
        .split('\\n')
        .map(line => line.replace(/^\\s*(?:[-*•]+\\s+|\\d+[.)]\\s+)/, '').trim())
        .filter(Boolean);
      
      // Parse skills
      const skillsText = document.getElementById('detailSkills').value;
      const skills = skillsText.split(',').map(s => s.trim()).filter(s => s);

      // Main Content section (optional, but title is required if any content is provided)
      const mainContentTitle = document.getElementById('mainContentTitle').value.trim();
      const mainContentDescription = document.getElementById('mainContentDescription').value;
      const mainContentConclusion = document.getElementById('mainContentConclusion').value;

      const normalizedMainContentBlocks = (mainContentBlocks || []).map(block => {
        const subtitle = block && block.subtitle ? String(block.subtitle).trim() : '';
        const description = block && block.description ? String(block.description).trim() : '';
        const imageSrc = block && block.image && block.image.src ? String(block.image.src).trim() : '';

        if (!subtitle && !description && !imageSrc) return null;
        const out = {};
        if (subtitle) out.subtitle = subtitle;
        if (description) out.description = description;
        if (imageSrc) out.image = { src: imageSrc };
        return out;
      }).filter(Boolean);

      const hasAnyMainContent = Boolean(
        mainContentTitle ||
        (mainContentDescription && mainContentDescription.trim()) ||
        (mainContentConclusion && mainContentConclusion.trim()) ||
        normalizedMainContentBlocks.length > 0
      );

      let mainContent = null;
      if (hasAnyMainContent) {
        if (!mainContentTitle) {
          showDetailStatus('Please enter a Main Content Section Title (or clear the content fields to hide this section).', 'error');
          switchTab('content');
          document.getElementById('mainContentTitle').focus();
          return;
        }
        mainContent = {
          title: mainContentTitle,
          description: mainContentDescription,
          blocks: normalizedMainContentBlocks,
          conclusion: mainContentConclusion
        };
      }
      
      const detailData = {
        heroImage: document.getElementById('detailHeroImage').value || project.image,
        meta: {
          role: document.getElementById('detailRole').value,
          company: document.getElementById('detailCompany').value,
          projectDate: document.getElementById('detailDate').value
        },
        overview: overview,
        mainContent: mainContent,
        additionalImages: legacyAdditionalImages,
        keyContributions: keyContributions,
        futureDevelopment: futureDevelopment,
        skills: skills,
        links: projectLinks
      };
      
      try {
        const response = await fetch('/api/project-details/' + projectId, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(detailData)
        });
        
        const data = await response.json();
        
        if (data.success) {
          showDetailStatus('💾 Detail page saved successfully!', 'success');
          // Reload details
          projectDetails = projectDetails.filter(d => d.projectId !== projectId);
          projectDetails.push({ projectId: projectId, ...detailData });
        } else {
          showDetailStatus('Error: ' + data.error, 'error');
        }
      } catch (err) {
        showDetailStatus('Error saving detail page: ' + err.message, 'error');
      }
    }
    
    // Preview detail page
    function previewDetailPage() {
      const projectId = document.getElementById('detailProjectId').value;
      const project = projects.find(p => p.id === parseInt(projectId));
      if (project && project.detailPage) {
        window.open(project.detailPage, '_blank');
      }
    }
    
    // Show status in detail modal
    function showDetailStatus(message, type) {
      const status = document.getElementById('detailStatus');
      status.textContent = message;
      status.className = 'status ' + type;
      setTimeout(() => {
        status.className = 'status';
      }, 5000);
    }
    
    // Close detail modal on outside click
    document.getElementById('detailModal').addEventListener('click', (e) => {
      if (e.target.id === 'detailModal') closeDetailModal();
    });

    // Initialize
    loadProjects();
  </script>
</body>
</html>`);
});

// Initialize
async function init() {
  await ensureDataDir();
  // Ensure any missing detail page HTML files exist (never overwrites existing pages).
  await ensureDetailPagesExist();
  app.listen(PORT, () => {
    console.log(`\n🚀 Portfolio Dev Server running!`);
    console.log(`\n📍 Admin UI: http://localhost:${PORT}/admin`);
    console.log(`👁️  Preview: http://localhost:${PORT}/index.html`);
    console.log(`\n💡 Tips:`);
    console.log(`   - Drag projects in the admin to reorder`);
    console.log(`   - All changes auto-save to index.html`);
    console.log(`   - Upload images directly through the form`);
    console.log(`\n`);
  });
}

init();
