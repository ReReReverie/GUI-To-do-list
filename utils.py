import json
import os
import shutil
import sqlite3
import datetime
from pathlib import Path

BASE_DIR = Path(__file__).parent
CONFIG_FILE = BASE_DIR / 'config.json'

def load_config() -> dict:
    """Load config.json, creating it with defaults if it doesn't exist."""
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, 'r') as f:
            return json.load(f)
    # Default: ~/Documents/HabitTracker
    default_data_dir = str(Path.home() / 'Documents' / 'HabitTracker')
    config = {'data_dir': default_data_dir}
    save_config(config)
    return config

def save_config(config: dict) -> None:
    """Persist config to config.json."""
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=4)

def get_db_path() -> Path:
    """Return the current SQLite database file path from config."""
    config = load_config()
    data_dir = Path(config['data_dir'])
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / 'tasks.db'

def get_connection() -> sqlite3.Connection:
    """Open a connection to the SQLite database and return it."""
    db_path = get_db_path()
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn

def init_db() -> None:
    """Create the tasks table if it does not already exist."""
    conn = get_connection()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task TEXT NOT NULL,
            finished INTEGER NOT NULL DEFAULT 0,
            added_at TEXT NOT NULL,
            finished_at TEXT
        )
    ''')
    conn.commit()
    conn.close()
