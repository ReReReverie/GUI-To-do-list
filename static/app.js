/* ============================================================
   HabitFlow — app.js
   Vanilla JS — no frameworks, no build tools.
   All API calls go to Flask backend at the same origin.
   ============================================================ */

'use strict';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let progressChart = null;
let appSettings = {
  theme: 'dark',
  language: 'en-US',
  time_format: '12h',
  show_creation_time: true,
  background_image: ''
};
let pendingBackgroundImage = null;
let dailyCountdownTimer = null;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Show a brief toast notification.
 * @param {string} message
 * @param {'success'|'error'|''} type
 */
function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.className = 'toast';
  }, 3000);
}

/** Format ISO datetime string to a short human-readable time (e.g., "2:45 PM" or "14:45"). */
function formatTime(iso) {
  if (!iso) return '';
  try {
    const date = new Date(iso);
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const paddedMinute = String(minutes).padStart(2, '0');
    if (appSettings.time_format === '24h') {
      return `${String(hours).padStart(2, '0')}:${paddedMinute}`;
    }
    const hour = hours % 12 || 12;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    return `${hour}:${paddedMinute} ${ampm}`;
  } catch { return ''; }
}

/** Format ISO date string to "May 2" style. */
function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(appSettings.language || 'en-US', { month: 'short', day: 'numeric' });
  } catch { return dateStr; }
}

/** Return today's date as YYYY-MM-DD. */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Section Navigation
// ---------------------------------------------------------------------------

function showSection(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const sectionEl = document.getElementById(`section-${name}`);
  if (sectionEl) sectionEl.classList.add('active');

  const navEl = document.getElementById(`nav-${name}`);
  if (navEl && navEl.style.display !== 'none') navEl.classList.add('active');

  if (name === 'graph') renderGraph();
  if (name === 'calendar') renderCalendar();
  updateDailiesPanelVisibility();
}

function toggleDailiesPanel(forceOpen) {
  const panel = document.getElementById('dailies-panel');
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : true;
  panel.classList.toggle('open', shouldOpen);
}

function updateDailiesPanelVisibility() {
  const tasksSection = document.getElementById('section-tasks');
  const isTasksActive = tasksSection && tasksSection.classList.contains('active');
  toggleDailiesPanel(Boolean(isTasksActive));
}

function getTimeLeftToMidnight() {
  const now = new Date();
  const end = new Date(now);
  end.setHours(24, 0, 0, 0);
  const diffMs = Math.max(0, end.getTime() - now.getTime());
  const totalSec = Math.floor(diffMs / 1000);
  const hours = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSec % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function updateDailyTimers() {
  const left = getTimeLeftToMidnight();
  document.querySelectorAll('[data-daily-timer]').forEach(el => {
    el.textContent = `Time left today: ${left}`;
  });
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

async function loadTasks() {
  try {
    const res = await fetch('/api/tasks');
    if (res.status === 412) {
      showSetupOverlay();
      return;
    }
    if (!res.ok) throw new Error('Network response not ok');
    const tasks = await res.json();
    renderTasks(tasks);
  } catch (err) {
    console.error('Failed to load tasks:', err);
    showToast('Failed to load tasks.', 'error');
  }
}

function renderTasks(tasks) {
  const list = document.getElementById('task-list');
  const empty = document.getElementById('empty-state');
  list.innerHTML = '';

  if (tasks.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tasks.forEach(task => {
    const item = document.createElement('div');
    item.className = 'task-item';
    item.classList.add(`priority-${task.priority || 'medium'}`);
    item.id = `task-${task.id}`;
    item.innerHTML = `
      <button class="task-check-btn" title="Mark as done"
        onclick="finishTask(${task.id})" aria-label="Finish task: ${task.task}"></button>
      <span class="task-text">${escapeHtml(task.task)}</span>
      ${appSettings.show_creation_time ? `<span class="task-date">${formatTime(task.added_at)}</span>` : ''}
      <button class="task-delete-btn" title="Delete task"
        onclick="deleteTask(${task.id})" aria-label="Delete task: ${task.task}">✕</button>
    `;
    list.appendChild(item);
  });
}

async function addTask() {
  const input = document.getElementById('task-input');
  const priorityInput = document.getElementById('priority-input');
  const text = input.value.trim();
  const priority = priorityInput.value;
  if (!text) {
    input.focus();
    return;
  }

  const btn = document.getElementById('add-task-btn');
  btn.disabled = true;

  try {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: text, priority })
    });
    if (!res.ok) throw new Error(await res.text());
    input.value = '';
    await loadTasks();
    showToast('Task added!', 'success');
  } catch (err) {
    console.error('Failed to add task:', err);
    showToast('Failed to add task.', 'error');
  } finally {
    btn.disabled = false;
    input.focus();
  }
}

async function finishTask(id) {
  const item = document.getElementById(`task-${id}`);
  if (item) {
    item.classList.add('finishing');
    await sleep(350);
  }

  try {
    const res = await fetch(`/api/tasks/${id}/finish`, { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    await loadTasks();
    showToast('Task completed! ✓', 'success');
  } catch (err) {
    console.error('Failed to finish task:', err);
    if (item) item.classList.remove('finishing');
    showToast('Failed to complete task.', 'error');
  }
}

async function deleteTask(id) {
  const item = document.getElementById(`task-${id}`);
  if (item) {
    item.classList.add('finishing');
    await sleep(350);
  }

  try {
    const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await res.text());
    await loadTasks();
    showToast('Task deleted.', '');
  } catch (err) {
    console.error('Failed to delete task:', err);
    if (item) item.classList.remove('finishing');
    showToast('Failed to delete task.', 'error');
  }
}

// ---------------------------------------------------------------------------
// Dailies
// ---------------------------------------------------------------------------

async function loadDailies() {
  try {
    const res = await fetch('/api/dailies/today');
    if (res.status === 412) return;
    if (!res.ok) throw new Error('Failed to load dailies');
    const dailies = await res.json();
    renderDailies(dailies);
  } catch (err) {
    console.error('Failed to load dailies:', err);
    showToast('Failed to load dailies.', 'error');
  }
}

function renderDailies(dailies) {
  const list = document.getElementById('daily-list');
  list.innerHTML = '';
  if (dailies.length === 0) {
    list.innerHTML = '<p class="daily-empty">No dailies yet. Add one above.</p>';
    return;
  }
  dailies.forEach(daily => {
    const iconHtml = daily.icon_file
      ? `<img class="daily-icon-img" src="/user-icons/${encodeURIComponent(daily.icon_file)}" alt="">`
      : `<span class="daily-icon-emoji">${escapeHtml(daily.icon_emoji || '✅')}</span>`;
    const item = document.createElement('div');
    item.className = 'daily-item';
    item.innerHTML = `
      <label class="daily-check-wrap">
        <span class="daily-icon-wrap">${iconHtml}</span>
        <input type="checkbox" ${daily.completed ? 'checked' : ''} onchange="toggleDaily(${daily.id})">
        <div class="daily-text-wrap">
          <span class="daily-title ${daily.completed ? 'done' : ''}">${escapeHtml(daily.title)}</span>
          <span class="daily-timer" data-daily-timer>Time left today: --:--:--</span>
        </div>
      </label>
      <button class="task-delete-btn" onclick="deleteDaily(${daily.id})" aria-label="Delete daily: ${daily.title}">✕</button>
    `;
    list.appendChild(item);
  });
  updateDailyTimers();
}

async function addDaily() {
  const input = document.getElementById('daily-input');
  const title = input.value.trim();
  const iconMode = document.getElementById('daily-icon-mode').value;
  const iconEmojiInput = document.getElementById('daily-icon-emoji').value.trim() || '✅';
  const iconFileInput = document.getElementById('daily-icon-file');
  if (!title) return;
  try {
    let iconFile = '';
    if (iconMode === 'upload' && iconFileInput.files[0]) {
      const formData = new FormData();
      formData.append('icon', iconFileInput.files[0]);
      const uploadRes = await fetch('/api/icons', { method: 'POST', body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error || 'Failed to upload icon');
      iconFile = uploadData.file_name;
    }
    const res = await fetch('/api/dailies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, icon_emoji: iconEmojiInput, icon_file: iconFile })
    });
    if (!res.ok) throw new Error(await res.text());
    input.value = '';
    iconFileInput.value = '';
    await loadDailies();
    renderCalendar();
    showToast('Daily added.', 'success');
  } catch (err) {
    console.error('Failed to add daily:', err);
    showToast('Failed to add daily.', 'error');
  }
}

async function toggleDaily(id) {
  try {
    const res = await fetch(`/api/dailies/${id}/toggle`, { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    await loadDailies();
    renderCalendar();
  } catch (err) {
    console.error('Failed to toggle daily:', err);
    showToast('Failed to update daily.', 'error');
  }
}

async function deleteDaily(id) {
  try {
    const res = await fetch(`/api/dailies/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await res.text());
    await loadDailies();
    renderCalendar();
    showToast('Daily deleted.', '');
  } catch (err) {
    console.error('Failed to delete daily:', err);
    showToast('Failed to delete daily.', 'error');
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Basic XSS prevention for injected text. */
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// History data (shared by graph + calendar)
// ---------------------------------------------------------------------------

async function fetchHistory() {
  const res = await fetch('/api/history');
  if (res.status === 412) {
    showSetupOverlay();
    throw new Error('Unconfigured');
  }
  if (!res.ok) throw new Error('Failed to fetch history');
  return await res.json();
}

// ---------------------------------------------------------------------------
// Line Graph
// ---------------------------------------------------------------------------

async function renderGraph() {
  try {
    const history = await fetchHistory();

    // Only last 30 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 29);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const filtered = history.filter(d => d.date >= cutoffStr);

    const labels  = filtered.map(d => formatDate(d.date));
    const data    = filtered.map(d => d.finished || 0);

    if (progressChart) {
      progressChart.data.labels = labels;
      progressChart.data.datasets[0].data = data;
      progressChart.update('active');
      return;
    }

    const ctx = document.getElementById('progress-chart').getContext('2d');
    progressChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Tasks Finished',
          data,
          borderColor: '#7c6af7',
          backgroundColor: 'rgba(124, 106, 247, 0.12)',
          borderWidth: 2.5,
          pointBackgroundColor: '#7c6af7',
          pointRadius: 4,
          pointHoverRadius: 7,
          fill: true,
          tension: 0.35
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: {
            labels: { color: '#8890a4', font: { family: 'Inter', size: 12 } }
          },
          tooltip: {
            backgroundColor: '#1a1e28',
            borderColor: 'rgba(255,255,255,0.08)',
            borderWidth: 1,
            titleColor: '#e8eaf0',
            bodyColor: '#8890a4',
            padding: 12,
            cornerRadius: 8
          }
        },
        scales: {
          x: {
            ticks: { color: '#8890a4', font: { family: 'Inter', size: 11 }, maxTicksLimit: 10 },
            grid: { color: 'rgba(255,255,255,0.04)' }
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: '#8890a4',
              font: { family: 'Inter', size: 11 },
              precision: 0
            },
            grid: { color: 'rgba(255,255,255,0.04)' }
          }
        }
      }
    });
  } catch (err) {
    console.error('Failed to render graph:', err);
    showToast('Failed to load graph data.', 'error');
  }
}

// ---------------------------------------------------------------------------
// Calendar Heatmap
// ---------------------------------------------------------------------------

async function renderCalendar() {
  try {
    const history = await fetchHistory();

    // Build a lookup map: date -> {added, finished}
    const dayMap = {};
    history.forEach(d => {
      dayMap[d.date] = {
        added: d.added || 0,
        finished: d.finished || 0,
        all_dailies_done: Boolean(d.all_dailies_done)
      };
    });

    // Generate last 90 days as a grid of weeks
    const today = new Date();
    const days = [];
    for (let i = 89; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      days.push({ key, d });
    }

    // Pad start so week starts on Sunday
    const firstDow = days[0].d.getDay(); // 0=Sun
    const padded = Array(firstDow).fill(null).concat(days);

    // Chunk into weeks of 7
    const weeks = [];
    for (let i = 0; i < padded.length; i += 7) {
      weeks.push(padded.slice(i, i + 7));
    }

    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';

    weeks.forEach(week => {
      const col = document.createElement('div');
      col.className = 'calendar-week';

      week.forEach(day => {
        const cell = document.createElement('div');
        cell.className = 'calendar-cell';

        if (!day) {
          cell.style.background = 'transparent';
          col.appendChild(cell);
          return;
        }

        const stats = dayMap[day.key];
        const label = formatDate(day.key);

        if (!stats) {
          // No tasks added — gray
          cell.style.background = 'var(--cell-gray)';
          cell.setAttribute('data-tip', `${label}: no tasks`);
        } else if (stats.added === 0) {
          cell.style.background = 'var(--cell-gray)';
          cell.setAttribute('data-tip', `${label}: no tasks`);
        } else if (stats.finished === 0) {
          // Tasks exist but none finished — red
          cell.style.background = 'var(--cell-red)';
          cell.setAttribute('data-tip', `${label}: 0/${stats.added} done`);
        } else {
          // Some or all done — green, brightness scales with ratio
          const ratio = stats.finished / stats.added;
          const color = getGreenColor(ratio);
          cell.style.background = color;
          cell.setAttribute('data-tip', `${label}: ${stats.finished}/${stats.added} done`);
        }
        if (stats && stats.all_dailies_done) {
          cell.classList.add('calendar-cell-gold');
          cell.setAttribute('data-tip', `${cell.getAttribute('data-tip')} • all dailies done`);
        }

        col.appendChild(cell);
      });

      grid.appendChild(col);
    });
  } catch (err) {
    console.error('Failed to render calendar:', err);
    showToast('Failed to load calendar.', 'error');
  }
}

/**
 * Returns a green HSL color that scales brightness with ratio (0..1).
 * ratio ~0.01 → dim green, ratio 1.0 → bright green.
 */
function getGreenColor(ratio) {
  // Lightness from 18% (dim) to 55% (bright)
  const lightness = Math.round(18 + ratio * 37);
  return `hsl(141, 65%, ${lightness}%)`;
}

// ---------------------------------------------------------------------------
// Settings Modal
// ---------------------------------------------------------------------------

function openSettings() {
  const overlay = document.getElementById('settings-overlay');
  overlay.classList.add('open');
  document.getElementById('settings-status').textContent = '';
  document.getElementById('settings-status').className = 'settings-status';

  // Load current settings
  fetch('/api/settings')
    .then(r => r.json())
    .then(cfg => {
      document.getElementById('data-dir-input').value = cfg.data_dir || '';
      document.getElementById('theme-input').value = cfg.theme || 'dark';
      document.getElementById('language-input').value = cfg.language || 'en-US';
      document.getElementById('time-format-input').value = cfg.time_format || '12h';
      document.getElementById('show-creation-time-input').checked = cfg.show_creation_time !== false;
      document.getElementById('background-image-input').value = '';
      pendingBackgroundImage = null;
      appSettings.background_image = cfg.background_image || '';
      appSettings.time_format = cfg.time_format || '12h';
      appSettings.show_creation_time = cfg.show_creation_time !== false;
      applyBackgroundImage();
    })
    .catch(() => {});
}

function closeSettings(event) {
  if (event && event.target !== document.getElementById('settings-overlay')) return;
  document.getElementById('settings-overlay').classList.remove('open');
}

async function saveSettings() {
  const dir = document.getElementById('data-dir-input').value.trim();
  const theme = document.getElementById('theme-input').value;
  const language = document.getElementById('language-input').value;
  const timeFormat = document.getElementById('time-format-input').value;
  const showCreationTime = document.getElementById('show-creation-time-input').checked;
  const status = document.getElementById('settings-status');
  const btn = document.getElementById('save-settings-btn');

  btn.disabled = true;
  status.textContent = 'Saving…';
  status.className = 'settings-status';

  try {
    const payload = {
      data_dir: dir,
      theme,
      language,
      time_format: timeFormat,
      show_creation_time: showCreationTime
    };
    if (pendingBackgroundImage !== null) {
      payload.background_image = pendingBackgroundImage;
    }

    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unknown error');
    status.textContent = `✓ Saved to: ${data.data_dir}`;
    status.className = 'settings-status';
    appSettings.theme = data.theme || 'dark';
    appSettings.language = data.language || 'en-US';
    appSettings.time_format = data.time_format || '12h';
    appSettings.show_creation_time = data.show_creation_time !== false;
    appSettings.background_image = data.background_image || '';
    pendingBackgroundImage = null;
    applyTheme(appSettings.theme);
    applyBackgroundImage();
    refreshDateLabel();
    showToast('Settings saved!', 'success');
    closeSettings();
    
    // Refresh data in case we switched DBs or time format changed
    await loadTasks();
    loadDailies();
    await renderGraph();
    await renderCalendar();
    showSection('tasks');
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    status.className = 'settings-status error';
  } finally {
    btn.disabled = false;
  }
}

function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme || 'dark');
}

function refreshDateLabel() {
  document.getElementById('date-label').textContent =
    new Date().toLocaleDateString(appSettings.language || 'en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
}

function applyBackgroundImage() {
  const body = document.body;
  if (appSettings.background_image) {
    body.style.backgroundImage = `url(${appSettings.background_image})`;
    body.classList.add('custom-background');
  } else {
    body.style.backgroundImage = '';
    body.classList.remove('custom-background');
  }
}

function clearBackgroundImage() {
  pendingBackgroundImage = '';
  appSettings.background_image = '';
  applyBackgroundImage();
  const input = document.getElementById('background-image-input');
  if (input) input.value = '';
  showToast('Background image removed', 'success');
}

function handleBackgroundImageSelection(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) {
    pendingBackgroundImage = null;
    return;
  }
  if (!file.type.startsWith('image/')) {
    showToast('Please choose an image file.', 'error');
    event.target.value = '';
    pendingBackgroundImage = null;
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    pendingBackgroundImage = reader.result;
    showToast('Background image ready to save.', 'success');
  };
  reader.onerror = () => {
    showToast('Failed to read image file.', 'error');
    pendingBackgroundImage = null;
  };
  reader.readAsDataURL(file);
}

async function browseDirectory(inputId) {
  try {
    const res = await fetch('/api/browse', { method: 'POST' });
    const data = await res.json();
    if (data.path) {
      document.getElementById(inputId).value = data.path;
    }
  } catch (err) {
    console.error('Failed to browse directory:', err);
    showToast('Failed to open folder picker.', 'error');
  }
}

// ---------------------------------------------------------------------------
// Initial Setup
// ---------------------------------------------------------------------------

function showSetupOverlay() {
  document.getElementById('setup-overlay').classList.add('open');
}

async function saveInitialSetup() {
  const dir = document.getElementById('setup-dir-input').value.trim();
  const status = document.getElementById('setup-status');
  const btn = document.getElementById('start-setup-btn');

  if (!dir) {
    status.textContent = 'Please enter a directory path.';
    status.className = 'settings-status error';
    return;
  }

  btn.disabled = true;
  status.textContent = 'Setting up…';
  
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_dir: dir })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unknown error');
    
    document.getElementById('setup-overlay').classList.remove('open');
    showToast('Welcome to HabitFlow!', 'success');
    loadTasks();
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    status.className = 'settings-status error';
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  const savedLayout = localStorage.getItem('habitflow_page_layout');
  // Initial check: if unconfigured, show setup overlay
  fetch('/api/settings')
    .then(r => r.json())
    .then(cfg => {
      appSettings.theme = cfg.theme || 'dark';
      appSettings.language = cfg.language || 'en-US';
      appSettings.time_format = cfg.time_format || '12h';
      appSettings.show_creation_time = cfg.show_creation_time !== false;
      appSettings.background_image = cfg.background_image || '';
      appSettings.page_layout = 'split';
      applyTheme(appSettings.theme);
      applyBackgroundImage();
      applyPageLayout(appSettings.page_layout);
      refreshDateLabel();
      if (!cfg.data_dir) {
        showSetupOverlay();
      } else {
        loadTasks();
        loadDailies();
        showSection('tasks');
      }
    })
    .catch(() => {
      appSettings.page_layout = 'split';
      applyTheme('dark');
      applyPageLayout(appSettings.page_layout);
      refreshDateLabel();
      loadTasks();
      loadDailies();
    });

  const iconModeEl = document.getElementById('daily-icon-mode');
  if (iconModeEl) {
    iconModeEl.addEventListener('change', () => {
      const mode = iconModeEl.value;
      document.getElementById('daily-icon-emoji').style.display = mode === 'emoji' ? '' : 'none';
      document.getElementById('daily-icon-file').style.display = mode === 'upload' ? '' : 'none';
    });
    iconModeEl.dispatchEvent(new Event('change'));
  }

  const bgInput = document.getElementById('background-image-input');
  if (bgInput) {
    bgInput.addEventListener('change', handleBackgroundImageSelection);
  }

  if (!dailyCountdownTimer) {
    dailyCountdownTimer = setInterval(updateDailyTimers, 1000);
  }
});
