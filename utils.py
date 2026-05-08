import json
import os
import shutil
import sqlite3
import datetime
from pathlib import Path

BASE_DIR = Path(__file__).parent
CONFIG_FILE = BASE_DIR / 'config.json'

def load_config() -> dict:
    """Load config.json. Returns empty data_dir if it doesn't exist or is empty."""
    default_config = {
        'data_dir': '',
        'theme': 'dark',
        'language': 'en-US',
        'time_format': '12h',
        'show_creation_time': True,
        'background_image': ''
    }
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, 'r') as f:
            try:
                config = json.load(f)
                if isinstance(config, dict):
                    merged = {**default_config, **config}
                    return merged
            except (json.JSONDecodeError, KeyError):
                pass
    
    # Do NOT set a default path to avoid doxing.
    # User will be prompted in the web UI to set this.
    config = default_config
    save_config(config)
    return config

def save_config(config: dict) -> None:
    """Persist config to config.json."""
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=4)


def get_time_format() -> str:
    """Return the configured time format: '12h' or '24h'."""
    config = load_config()
    return config.get('time_format', '12h')


def set_time_format(fmt: str) -> None:
    """Set and persist the time format. Accepts '12h' or '24h'."""
    if fmt not in ('12h', '24h'):
        raise ValueError("time format must be '12h' or '24h'")
    config = load_config()
    config['time_format'] = fmt
    save_config(config)


def get_show_creation_time() -> bool:
    """Return whether creation time should be shown."""
    config = load_config()
    return bool(config.get('show_creation_time', True))


def set_show_creation_time(enabled: bool) -> None:
    """Enable or disable showing creation time and persist."""
    config = load_config()
    config['show_creation_time'] = bool(enabled)
    save_config(config)


def get_background_image() -> str:
    """Return the configured background image path (empty string if none)."""
    return load_config().get('background_image', '')


def set_background_image(path: str) -> None:
    """Set and persist the background image path. Use empty string to clear."""
    config = load_config()
    config['background_image'] = path or ''
    save_config(config)


def format_timestamp(ts) -> str:
    """Format a timestamp according to the configured `time_format`.

    Accepts an ISO string, a float/int unix timestamp, or a datetime.
    Returns an empty string for falsy input.
    """
    if not ts:
        return ''
    if isinstance(ts, str):
        try:
            dt = datetime.datetime.fromisoformat(ts)
        except ValueError:
            try:
                dt = datetime.datetime.fromtimestamp(float(ts))
            except Exception:
                return ts
    elif isinstance(ts, (int, float)):
        try:
            dt = datetime.datetime.fromtimestamp(float(ts))
        except Exception:
            return str(ts)
    elif isinstance(ts, datetime.datetime):
        dt = ts
    else:
        return str(ts)

    fmt = '%I:%M %p' if get_time_format() == '12h' else '%H:%M'
    return dt.strftime(fmt)

def is_configured() -> bool:
    """Check if the data directory has been set."""
    config = load_config()
    return bool(config.get('data_dir'))

def get_db_path() -> Path | None:
    """Return the current SQLite database file path from config, or None if not set."""
    config = load_config()
    data_dir_str = config.get('data_dir')
    if not data_dir_str:
        return None
    
    data_dir = Path(data_dir_str)
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / 'tasks.db'

def get_connection() -> sqlite3.Connection:
    """Open a connection to the SQLite database and return it."""
    db_path = get_db_path()
    if not db_path:
        raise RuntimeError("Database path not configured.")
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn

def init_db() -> None:
    """Create the tasks table if it does not already exist."""
    if not is_configured():
        return
    
    try:
        conn = get_connection()
        conn.execute('''
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task TEXT NOT NULL,
                priority TEXT NOT NULL DEFAULT 'medium',
                finished INTEGER NOT NULL DEFAULT 0,
                added_at TEXT NOT NULL,
                finished_at TEXT
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS daily_templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                icon_emoji TEXT NOT NULL DEFAULT '✅',
                icon_file TEXT,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS daily_completions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                template_id INTEGER NOT NULL,
                completed_date TEXT NOT NULL,
                completed_at TEXT NOT NULL,
                UNIQUE(template_id, completed_date),
                FOREIGN KEY(template_id) REFERENCES daily_templates(id) ON DELETE CASCADE
            )
        ''')
        
        # New tables for Groups and Tasks
        conn.execute('''
            CREATE TABLE IF NOT EXISTS daily_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL,
                task_text TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                FOREIGN KEY(group_id) REFERENCES daily_templates(id) ON DELETE CASCADE
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS daily_task_completions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                completed_date TEXT NOT NULL,
                completed_at TEXT NOT NULL,
                UNIQUE(task_id, completed_date),
                FOREIGN KEY(task_id) REFERENCES daily_tasks(id) ON DELETE CASCADE
            )
        ''')

        # Lightweight migration for old databases.
        task_columns = {
            row['name'] for row in conn.execute("PRAGMA table_info(tasks)").fetchall()
        }
        if 'priority' not in task_columns:
            conn.execute("ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'")
        daily_columns = {
            row['name'] for row in conn.execute("PRAGMA table_info(daily_templates)").fetchall()
        }
        if 'icon_emoji' not in daily_columns:
            conn.execute("ALTER TABLE daily_templates ADD COLUMN icon_emoji TEXT NOT NULL DEFAULT '✅'")
        if 'icon_file' not in daily_columns:
            conn.execute("ALTER TABLE daily_templates ADD COLUMN icon_file TEXT")
        if 'color' not in daily_columns:
            conn.execute("ALTER TABLE daily_templates ADD COLUMN color TEXT")

        # Migrate existing daily_templates to daily_tasks and daily_task_completions
        existing_groups = conn.execute("SELECT id, title, created_at FROM daily_templates").fetchall()
        for group in existing_groups:
            has_tasks = conn.execute("SELECT COUNT(*) FROM daily_tasks WHERE group_id = ?", (group['id'],)).fetchone()[0] > 0
            if not has_tasks:
                cur = conn.execute(
                    "INSERT INTO daily_tasks (group_id, task_text, created_at) VALUES (?, ?, ?)",
                    (group['id'], group['title'], group['created_at'])
                )
                new_task_id = cur.lastrowid
                
                # Copy old completions to new table
                old_completions = conn.execute("SELECT completed_date, completed_at FROM daily_completions WHERE template_id = ?", (group['id'],)).fetchall()
                for oc in old_completions:
                    conn.execute(
                        "INSERT OR IGNORE INTO daily_task_completions (task_id, completed_date, completed_at) VALUES (?, ?, ?)",
                        (new_task_id, oc['completed_date'], oc['completed_at'])
                    )

        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error initializing database: {e}")
