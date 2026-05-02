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
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, 'r') as f:
            try:
                config = json.load(f)
                if 'data_dir' in config:
                    return config
            except (json.JSONDecodeError, KeyError):
                pass
    
    # Do NOT set a default path to avoid doxing.
    # User will be prompted in the web UI to set this.
    config = {'data_dir': ''}
    save_config(config)
    return config

def save_config(config: dict) -> None:
    """Persist config to config.json."""
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=4)

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
                finished INTEGER NOT NULL DEFAULT 0,
                added_at TEXT NOT NULL,
                finished_at TEXT
            )
        ''')
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error initializing database: {e}")
