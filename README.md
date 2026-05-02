## GUI To-Do List & Habit Tracker

A simple web-based to-do list and habit tracker built with Python, SQL, HTML, and CSS. This project started as a terminal-based to-do list application and was later expanded into a full web application through vibe coding.

## Features

- Add tasks
- View active tasks
- Mark tasks as finished
- Delete tasks
- View task history
- Display daily task statistics for habit tracking
- Store data locally using SQLite
- Configure the data storage directory

## Languages Used

- Python
- SQL
- HTML
- CSS

## Frameworks and Tools Used

- Flask
- SQLite
- JSON configuration file
- Antigravity
- Gemini 3.1 Pro (High)

## Getting Started

1. Clone or download the project.

2. Create and activate a virtual environment:

   ```bash
   python -m venv .venv
   ```

   Windows:

   ```bash
   .venv\Scripts\activate
   ```

   macOS/Linux:

   ```bash
   source .venv/bin/activate
   ```

3. Install the required dependency:

   ```bash
   pip install -r requirements.txt
   ```

4. Run the application:

   ```bash
   python app.py
   ```

5. Open the app in your browser:

   ```text
   http://localhost:5000
   ```

## Project Overview

This project was primarily vibe-coded using Antigravity with the Gemini 3.1 Pro (High) model.

The original version of this project was a terminal-based to-do list application. It was later expanded into a full web application with a Flask backend, SQLite database storage, and a browser-based user interface. The goal was to explore how vibe coding can speed up the development process and transform a simple command-line project into a more complete and interactive application.

Through this project, I learned that vibe coding can be fast and efficient, especially when building features, connecting different files, and reducing the time spent searching through documentation. It helped simplify the process of creating routes, handling data, and structuring the application.

However, I also realized that relying too heavily on vibe coding can reduce some of the learning experience that comes from solving problems independently. While it can make development faster, it may also take away the challenge and satisfaction of manually building, debugging, and understanding each part of the program.

As a student, I understand why vibe coding is useful, especially when working under time constraints. However, I believe it should be used more as a learning tool rather than simply as a shortcut to complete a project. It is helpful for generating ideas, understanding possible solutions, and improving productivity, but the user should still review, test, and understand the code being produced.

I also understand why companies use AI-assisted development in their workflow. Vibe coding allows developers to focus more on problem-solving, prompt engineering, and system design. Instead of only writing code line by line, the process shifts toward creating clear prompts that guide the AI in producing useful solutions.

If I were to vibe-code another project, I would first create a flowchart and break the system into smaller parts. Then, I would use each part of the flowchart as a guide for writing prompts. In this way, the process becomes similar to structured programming, but with a stronger focus on prompt design and problem decomposition.

## File Structure

```text
project-folder/
│
├── app.py              # Main Flask application and API routes
├── utils.py            # Helper functions for configuration and database setup
├── config.json         # Stores the data directory path
├── requirements.txt    # Project dependency list
│
├── static/
│   ├── index.html      # Main web page
│   ├── style.css       # Styling for the web app
│   └── script.js       # Frontend logic
```
## Data Storage

The application uses SQLite for local data storage. The database file is created based on the directory set in `config.json`.

By default, the database is stored as:

```text
tasks.db
```

inside the configured data directory.

## Notes

This project helped me understand how a simple terminal application can be expanded into a more complete web-based system. It also gave me a better understanding of Flask routes, SQLite database handling, configuration files, and the role of AI-assisted development in modern programming workflows.
