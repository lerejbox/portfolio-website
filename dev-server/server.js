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
const INDEX_FILE = path.join(__dirname, '..', 'index.html');
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

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
    const newProject = {
      id: Date.now(),
      ...req.body,
      detailPage: `./project-${data.projects.length + 1}.html`
    };
    data.projects.unshift(newProject); // Add new projects at the top (index 0)
    await saveProjects(data);
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
    data.projects = data.projects.filter(p => p.id !== parseInt(req.params.id));
    await saveProjects(data);
    await generateIndexHtml();
    res.json({ success: true });
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

// Admin UI
app.get('/admin', (req, res) => {
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

  <script>
    let projects = [];
    let draggedItem = null;
    let editingId = null;

    // Load projects on page load
    async function loadProjects() {
      try {
        const response = await fetch('/api/projects');
        const data = await response.json();
        projects = data.projects || [];
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
        return \`
          <li class="project-item" draggable="true" data-id="\${project.id}">
            <span class="drag-handle">⋮⋮</span>
            <img src="\${project.image}" class="project-preview" onerror="this.src='./assets/jpeg/project-placeholder.jpg'">
            <div class="project-info">
              <div class="project-title">\${project.title}</div>
              <div class="project-desc">\${cleanDesc}</div>
            </div>
            <div class="project-actions">
              <button class="btn btn-secondary btn-small" onclick="editProject(\${project.id})">Edit</button>
              <button class="btn btn-danger btn-small" onclick="deleteProject(\${project.id})">Delete</button>
            </div>
          </li>
        \`;
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
          response = await fetch(\`/api/projects/\${editingId}\`, {
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
      if (!confirm('Are you sure you want to delete this project?')) return;
      
      try {
        const response = await fetch(\`/api/projects/\${id}\`, {
          method: 'DELETE'
        });
        const data = await response.json();
        
        if (data.success) {
          await loadProjects();
          showStatus('Project deleted!', 'success');
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

    // Initialize
    loadProjects();
  </script>
</body>
</html>`);
});

// Initialize
async function init() {
  await ensureDataDir();
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
