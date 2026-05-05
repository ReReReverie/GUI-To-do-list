from app import app as flask_app, get_active_tasks

with flask_app.app_context():
    res = get_active_tasks()
    print(res.get_data(as_text=True))
