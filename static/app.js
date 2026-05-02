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

/** Format ISO datetime string to a short human-readable time (e.g., "2:45 PM"). */
function formatTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

/** Format ISO date string to "May 2" style. */
function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString([], { month: 'short', day: 'numeric' });
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
  document.getElementById(`section-${name}`).classList.add('active');
  document.getElementById(`nav-${name}`).classList.add('active');

  if (name === 'graph')    renderGraph();
  if (name === 'calendar') renderCalendar();
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

async function loadTasks() {
  try {
    const res = await fetch('/api/tasks');
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
    item.id = `task-${task.id}`;
    item.innerHTML = `
      <button class="task-check-btn" title="Mark as done"
        onclick="finishTask(${task.id})" aria-label="Finish task: ${task.task}"></button>
      <span class="task-text">${escapeHtml(task.task)}</span>
      <span class="task-date">${formatTime(task.added_at)}</span>
      <button class="task-delete-btn" title="Delete task"
        onclick="deleteTask(${task.id})" aria-label="Delete task: ${task.task}">✕</button>
    `;
    list.appendChild(item);
  });
}

async function addTask() {
  const input = document.getElementById('task-input');
  const text = input.value.trim();
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
      body: JSON.stringify({ task: text })
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
    history.forEach(d => { dayMap[d.date] = { added: d.added || 0, finished: d.finished || 0 }; });

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

  // Load current data dir
  fetch('/api/settings')
    .then(r => r.json())
    .then(cfg => {
      document.getElementById('data-dir-input').value = cfg.data_dir || '';
    })
    .catch(() => {});
}

function closeSettings(event) {
  if (event && event.target !== document.getElementById('settings-overlay')) return;
  document.getElementById('settings-overlay').classList.remove('open');
}

async function saveSettings() {
  const dir = document.getElementById('data-dir-input').value.trim();
  const status = document.getElementById('settings-status');
  const btn = document.getElementById('save-settings-btn');

  if (!dir) {
    status.textContent = 'Please enter a directory path.';
    status.className = 'settings-status error';
    return;
  }

  btn.disabled = true;
  status.textContent = 'Saving…';
  status.className = 'settings-status';

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_dir: dir })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unknown error');
    status.textContent = `✓ Saved to: ${data.data_dir}`;
    status.className = 'settings-status';
    showToast('Settings saved!', 'success');
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
  // Set today's date in the header
  document.getElementById('date-label').textContent =
    new Date().toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  loadTasks();
});
