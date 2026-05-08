"""
GUI To-Do List & Habit Tracker
Flask + SQLite backend — optimized for low RAM usage.
Data is stored in a SQLite database at a user-configurable path.
"""

import os
import json
import shutil
import sqlite3
import datetime
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename
import subprocess
import sys

from utils import (
    load_config,
    save_config,
    get_db_path,
    get_connection,
    init_db,
    is_configured,
    format_timestamp,
    get_show_creation_time,
)

app = Flask(__name__, static_folder='static')

# ---------------------------------------------------------------------------
# API Routes — Tasks
# ---------------------------------------------------------------------------

@app.route('/api/tasks', methods=['GET'])
def get_active_tasks():
    """Return all active (unfinished) tasks."""
    if not is_configured():
        return jsonify({'error': 'Configuration required', 'configured': False}), 412
    conn = get_connection()
    rows = conn.execute(
        "SELECT id, task, added_at FROM tasks WHERE finished = 0 ORDER BY id ASC"
    ).fetchall()
    conn.close()
    show_time = get_show_creation_time()
    out = []
    for r in rows:
        d = dict(r)
        if not show_time:
            d.pop('added_at', None)
        out.append(d)
    return jsonify(out)


@app.route('/api/tasks', methods=['POST'])
def add_task():
    """Add a new task."""
    if not is_configured():
        return jsonify({'error': 'Configuration required', 'configured': False}), 412
    data = request.get_json(silent=True) or {}
    task_text = (data.get('task') or '').strip()
    if not task_text:
        return jsonify({'error': 'Task text is required.'}), 400

    added_at = datetime.datetime.now().isoformat()
    conn = get_connection()
    cur = conn.execute(
        "INSERT INTO tasks (task, finished, added_at) VALUES (?, 0, ?)",
        (task_text, added_at)
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return jsonify({'id': new_id, 'task': task_text, 'added_at': added_at}), 201


@app.route('/api/tasks/<int:task_id>/finish', methods=['POST'])
def finish_task(task_id: int):
    """Mark a task as finished."""
    if not is_configured():
        return jsonify({'error': 'Configuration required', 'configured': False}), 412
    finished_at = datetime.datetime.now().isoformat()
    conn = get_connection()
    result = conn.execute(
        "UPDATE tasks SET finished = 1, finished_at = ? WHERE id = ? AND finished = 0",
        (finished_at, task_id)
    )
    conn.commit()
    conn.close()
    if result.rowcount == 0:
        return jsonify({'error': 'Task not found or already finished.'}), 404
    return jsonify({'success': True, 'finished_at': finished_at})


@app.route('/api/tasks/<int:task_id>', methods=['DELETE'])
def delete_task(task_id: int):
    """Delete a task from the database entirely."""
    conn = get_connection()
    result = conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    conn.commit()
    conn.close()
    if result.rowcount == 0:
        return jsonify({'error': 'Task not found.'}), 404
    return jsonify({'success': True})


@app.route('/api/history', methods=['GET'])
def get_history():
    """
    Return per-day aggregated stats for the calendar heatmap and line graph.
    Each entry: { date, added, finished }
    """
    if not is_configured():
        return jsonify({'error': 'Configuration required', 'configured': False}), 412
    conn = get_connection()
    rows = conn.execute("""
        WITH dates AS (
            SELECT DATE(added_at) as date FROM tasks
            UNION
            SELECT DATE(finished_at) as date FROM tasks WHERE finished_at IS NOT NULL
            UNION
            SELECT completed_date as date FROM daily_task_completions
        )
        SELECT 
            d.date,
            (SELECT COUNT(*) FROM tasks WHERE DATE(added_at) = d.date) as added,
            (SELECT COUNT(*) FROM tasks WHERE DATE(finished_at) = d.date AND finished = 1) as finished,
            (
                SELECT CASE 
                    WHEN (SELECT COUNT(*) FROM daily_tasks WHERE DATE(created_at) <= d.date AND active = 1) > 0 
                    AND (SELECT COUNT(*) FROM daily_tasks WHERE DATE(created_at) <= d.date AND active = 1) = 
                        (SELECT COUNT(*) FROM daily_task_completions c JOIN daily_tasks t ON c.task_id = t.id WHERE c.completed_date = d.date AND t.active = 1)
                    THEN 1 ELSE 0 END
            ) as all_dailies_done
        FROM dates d
        ORDER BY d.date ASC
    """).fetchall()
    
    group_stats = conn.execute("""
        SELECT 
            c.completed_date as date,
            g.id as group_id,
            g.title,
            g.color,
            COUNT(c.id) as finished_tasks
        FROM daily_task_completions c
        JOIN daily_tasks t ON c.task_id = t.id
        JOIN daily_templates g ON t.group_id = g.id
        WHERE g.active = 1 AND t.active = 1
        GROUP BY c.completed_date, g.id
    """).fetchall()
    conn.close()
    
    out = []
    group_map = {}
    for gs in group_stats:
        d = gs['date']
        if d not in group_map:
            group_map[d] = []
        group_map[d].append(dict(gs))
        
    for r in rows:
        d = dict(r)
        d['groups'] = group_map.get(d['date'], [])
        out.append(d)
        
    return jsonify(out)

# ---------------------------------------------------------------------------
# API Routes — Dailies
# ---------------------------------------------------------------------------

@app.route('/api/dailies/today', methods=['GET'])
def get_dailies_today():
    if not is_configured():
        return jsonify({'error': 'Configuration required', 'configured': False}), 412
    conn = get_connection()
    today = datetime.datetime.now().strftime('%Y-%m-%d')
    groups = conn.execute("""
        SELECT id, title, icon_emoji, icon_file, color
        FROM daily_templates
        WHERE active = 1
        ORDER BY id ASC
    """).fetchall()
    
    out = []
    for g in groups:
        group_dict = dict(g)
        tasks = conn.execute("""
            SELECT t.id, t.task_text,
                   CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END as completed
            FROM daily_tasks t
            LEFT JOIN daily_task_completions c ON t.id = c.task_id AND c.completed_date = ?
            WHERE t.group_id = ? AND t.active = 1
            ORDER BY t.id ASC
        """, (today, g['id'])).fetchall()
        group_dict['tasks'] = [dict(t) for t in tasks]
        out.append(group_dict)
    conn.close()
    return jsonify(out)

@app.route('/api/dailies', methods=['POST'])
def add_daily_group():
    if not is_configured():
        return jsonify({'error': 'Configuration required', 'configured': False}), 412
    data = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    icon_emoji = (data.get('icon_emoji') or '✅').strip()
    icon_file = (data.get('icon_file') or '').strip()
    color = (data.get('color') or '').strip()
    if not title:
        return jsonify({'error': 'Title is required.'}), 400
    conn = get_connection()
    created_at = datetime.datetime.now().isoformat()
    cur = conn.execute(
        "INSERT INTO daily_templates (title, icon_emoji, icon_file, color, created_at) VALUES (?, ?, ?, ?, ?)",
        (title, icon_emoji, icon_file, color, created_at)
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return jsonify({'id': new_id, 'title': title}), 201

@app.route('/api/dailies/<int:group_id>/tasks', methods=['POST'])
def add_daily_task(group_id: int):
    if not is_configured():
        return jsonify({'error': 'Configuration required', 'configured': False}), 412
    data = request.get_json(silent=True) or {}
    task_text = (data.get('task_text') or '').strip()
    if not task_text:
        return jsonify({'error': 'Task text is required.'}), 400
    conn = get_connection()
    created_at = datetime.datetime.now().isoformat()
    cur = conn.execute(
        "INSERT INTO daily_tasks (group_id, task_text, created_at) VALUES (?, ?, ?)",
        (group_id, task_text, created_at)
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return jsonify({'id': new_id, 'task_text': task_text}), 201

@app.route('/api/dailies/tasks/<int:task_id>/toggle', methods=['POST'])
def toggle_daily_task(task_id: int):
    if not is_configured():
        return jsonify({'error': 'Configuration required', 'configured': False}), 412
    conn = get_connection()
    today = datetime.datetime.now().strftime('%Y-%m-%d')
    row = conn.execute("SELECT id FROM daily_task_completions WHERE task_id = ? AND completed_date = ?", (task_id, today)).fetchone()
    if row:
        conn.execute("DELETE FROM daily_task_completions WHERE id = ?", (row['id'],))
        status = False
    else:
        completed_at = datetime.datetime.now().isoformat()
        conn.execute("INSERT INTO daily_task_completions (task_id, completed_date, completed_at) VALUES (?, ?, ?)", (task_id, today, completed_at))
        status = True
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'completed': status})

@app.route('/api/dailies/<int:group_id>', methods=['DELETE'])
def delete_daily_group(group_id: int):
    if not is_configured():
        return jsonify({'error': 'Configuration required', 'configured': False}), 412
    conn = get_connection()
    conn.execute("UPDATE daily_templates SET active = 0 WHERE id = ?", (group_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/dailies/tasks/<int:task_id>', methods=['DELETE'])
def delete_daily_task(task_id: int):
    if not is_configured():
        return jsonify({'error': 'Configuration required', 'configured': False}), 412
    conn = get_connection()
    conn.execute("UPDATE daily_tasks SET active = 0 WHERE id = ?", (task_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/icons', methods=['POST'])
def upload_icon():
    if not is_configured():
        return jsonify({'error': 'Configuration required'}), 412
    if 'icon' not in request.files:
        return jsonify({'error': 'No icon file part'}), 400
    file = request.files['icon']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    config = load_config()
    data_dir = Path(config.get('data_dir', ''))
    icons_dir = data_dir / 'icons'
    icons_dir.mkdir(parents=True, exist_ok=True)
    
    filename = secure_filename(file.filename)
    unique_filename = f"{int(datetime.datetime.now().timestamp())}_{filename}"
    file.save(icons_dir / unique_filename)
    
    return jsonify({'file_name': unique_filename})

@app.route('/user-icons/<path:filename>')
def serve_user_icons(filename):
    config = load_config()
    data_dir = Path(config.get('data_dir', ''))
    icons_dir = data_dir / 'icons'
    return send_from_directory(icons_dir, filename)

# ---------------------------------------------------------------------------
# API Routes — Settings
# ---------------------------------------------------------------------------

@app.route('/api/settings', methods=['GET'])
def get_settings():
    """Return current configuration."""
    config = load_config()
    return jsonify(config)


@app.route('/api/settings', methods=['POST'])
def update_settings():
    """
    Update the data directory.
    If the path changes, the existing database is copied to the new location.
    """
    data = request.get_json(silent=True) or {}
    config = load_config()
    old_db = get_db_path()

    try:
        # If a new data_dir is provided and non-empty, handle DB move/creation
        if 'data_dir' in data and (data.get('data_dir') or '').strip():
            new_dir = (data.get('data_dir') or '').strip()
            new_dir_path = Path(new_dir)
            new_dir_path.mkdir(parents=True, exist_ok=True)
            new_db = new_dir_path / 'tasks.db'

            if old_db and old_db != new_db and old_db.exists():
                shutil.copy2(str(old_db), str(new_db))

            config['data_dir'] = str(new_dir_path)

        # Merge other optional settings (don't require data_dir)
        if 'theme' in data:
            config['theme'] = data['theme']
        if 'language' in data:
            config['language'] = data['language']
        if 'time_format' in data:
            config['time_format'] = data['time_format']
        if 'show_creation_time' in data:
            config['show_creation_time'] = data['show_creation_time']
        if 'background_image' in data:
            config['background_image'] = data['background_image']

        save_config(config)

        # Initialize database at configured location if present
        init_db()
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    return jsonify({
        'success': True, 
        'data_dir': str(new_dir_path),
        'theme': config.get('theme'),
        'language': config.get('language'),
        'time_format': config.get('time_format'),
        'show_creation_time': config.get('show_creation_time'),
        'background_image': config.get('background_image')
    })


@app.route('/api/browse', methods=['POST'])
def browse_directory():
    """Open a native folder selection dialog and return the path."""
    try:
        # Run tkinter in a separate process to avoid Flask threading/GUI issues
        script = (
            "import tkinter as tk, tkinter.filedialog as fd; "
            "root = tk.Tk(); "
            "root.withdraw(); "
            "root.attributes('-topmost', True); "
            "print(fd.askdirectory(), end='')"
        )
        
        # CREATE_NO_WINDOW = 0x08000000 on Windows
        creationflags = 0x08000000 if sys.platform == 'win32' else 0
        
        result = subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True,
            text=True,
            creationflags=creationflags
        )
        
        folder_selected = result.stdout.strip()
        
        if folder_selected:
            return jsonify({'path': folder_selected})
        return jsonify({'path': None})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ---------------------------------------------------------------------------
# Serve frontend
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')


@app.route('/static/<path:filename>')
def serve_static(filename: str):
    return send_from_directory('static', filename)

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    init_db()
    print("=" * 50)
    print("  GUI To-Do List & Habit Tracker")
    print("  Running at: http://localhost:5000")
    config = load_config()
    print(f"  Data directory: {config['data_dir']}")
    print("=" * 50)
    # threaded=False keeps RAM usage minimal for a single-user local app
    app.run(host='127.0.0.1', port=5000, debug=False, threaded=False)
