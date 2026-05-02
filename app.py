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

import subprocess
import sys

from utils import load_config, save_config, get_db_path, get_connection, init_db, is_configured

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
    return jsonify([dict(r) for r in rows])


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
        SELECT
            DATE(added_at) AS date,
            COUNT(*)       AS added,
            SUM(finished)  AS finished
        FROM tasks
        GROUP BY DATE(added_at)
        ORDER BY date ASC
    """).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

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
    new_dir = (data.get('data_dir') or '').strip()
    if not new_dir:
        return jsonify({'error': 'data_dir is required.'}), 400

    new_dir_path = Path(new_dir)
    config = load_config()
    old_db = get_db_path()

    try:
        new_dir_path.mkdir(parents=True, exist_ok=True)
        new_db = new_dir_path / 'tasks.db'

        # Copy existing DB to new location if it exists and paths differ
        if old_db and old_db != new_db and old_db.exists():
            shutil.copy2(str(old_db), str(new_db))

        config['data_dir'] = str(new_dir_path)
        save_config(config)
        
        # Initialize database at new location
        init_db()
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    return jsonify({'success': True, 'data_dir': str(new_dir_path)})


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
