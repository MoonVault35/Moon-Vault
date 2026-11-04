# MoonVault FC — Football Player Management System

A simple, clean, responsive Football Player Management Website built with Django, Python, HTML, CSS, JavaScript, and MongoDB Atlas.

## Features

- **Admin Dashboard** — View stats, manage players, tags, and chat
- **Player Dashboard** — View profile, tags, and chat with admin
- **Player Management** — Full CRUD with search, profile pictures, status toggle
- **Real-Time Chat** — WebSocket (Django Channels) + HTTP polling fallback
- **Tag System** — Create, assign, and manage player tags
- **Support Page** — Display Facebook, Messenger, and phone contacts
- **Responsive Design** — Works on desktop, tablet, and mobile
- **Role-Based Access** — Admin and Player roles with route protection

## Tech Stack

| Layer     | Technology                        |
|-----------|-----------------------------------|
| Backend   | Python, Django 4.2                |
| Frontend  | HTML, CSS (custom), JavaScript    |
| Database  | MongoDB Atlas (via PyMongo)       |
| WebSocket | Django Channels + Daphne          |
| Icons     | Lucide Icons (CDN)                |

## Prerequisites

- Python 3.9+
- MongoDB Atlas account (free tier works)
- pip

## Installation

### 1. Clone / Navigate to the Project

```bash
cd Moonvault
```

### 2. Create a Virtual Environment

```bash
python -m venv venv

# Windows
venv\Scripts\activate

# macOS/Linux
source venv/bin/activate
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure Environment Variables

Copy `.env.example` to `.env` and update with your MongoDB Atlas credentials:

```bash
copy .env.example .env
```

Edit `.env`:

```
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
MONGODB_NAME=football_manager
DJANGO_SECRET_KEY=your-random-secret-key-here
DEBUG=True
```

**To get your MongoDB Atlas URI:**
1. Go to [MongoDB Atlas](https://cloud.mongodb.com)
2. Create a free cluster
3. Click **Connect** → **Drivers** → Copy the connection string
4. Replace `<username>`, `<password>`, and `<cluster>` with your values
5. Make sure your IP is whitelisted in **Network Access**

### 5. Create the Admin Account

```bash
python manage.py create_admin
```

You'll be prompted for a username and password. Only one admin account can exist.

**Quick mode (non-interactive):**

```bash
python manage.py create_admin --username admin --password yourpassword
```

### 6. Run the Server

```bash
python manage.py runserver
```

Or with Daphne (recommended for WebSocket support):

```bash
daphne -b 127.0.0.1 -p 8000 football_manager.asgi:application
```

### 7. Open in Browser

Visit: [http://127.0.0.1:8000](http://127.0.0.1:8000)

## Usage

### Admin Workflow

1. Log in with admin credentials
2. Create tags (e.g., Goalkeeper, Captain, Senior Team)
3. Add players — assign positions, jersey numbers, tags
4. Chat with players from the Chat page
5. Set up support contacts (Facebook, phone) on the Support page

### Player Workflow

1. Log in with credentials provided by admin
2. View personal dashboard with profile info and tags
3. Chat with the admin
4. View support contact information
5. Change password if needed

## Project Structure

```
Moonvault/
├── football_manager/           # Django project config
│   ├── settings.py
│   ├── urls.py
│   ├── asgi.py                 # ASGI config (WebSocket)
│   └── wsgi.py
├── core/                       # Main application
│   ├── views.py                # All view functions
│   ├── urls.py                 # URL routing
│   ├── db.py                   # MongoDB connection
│   ├── decorators.py           # Auth decorators
│   ├── consumers.py            # WebSocket consumer
│   ├── routing.py              # WebSocket routes
│   ├── context_processors.py   # Global template context
│   ├── management/commands/
│   │   └── create_admin.py     # Admin creation command
│   ├── templatetags/
│   │   └── custom_filters.py
│   ├── templates/core/         # HTML templates
│   │   ├── base.html
│   │   ├── landing.html
│   │   ├── login.html
│   │   ├── home_admin.html
│   │   ├── home_player.html
│   │   ├── players_list.html
│   │   ├── player_form.html
│   │   ├── chat.html
│   │   ├── support.html
│   │   ├── support_edit.html
│   │   ├── tags.html
│   │   └── change_password.html
│   └── static/core/
│       ├── css/
│       │   ├── styles.css      # Main stylesheet
│       │   └── chat.css        # Chat-specific styles
│       └── js/
│           ├── main.js         # Sidebar, alerts, search
│           └── chat.js         # WebSocket chat logic
├── media/profile_pics/         # Uploaded profile pictures
├── requirements.txt
├── .env.example
├── .gitignore
├── manage.py
└── README.md
```

## MongoDB Collections

| Collection        | Purpose                              |
|-------------------|--------------------------------------|
| `admin`           | Single admin account                 |
| `players`         | Player profiles and credentials      |
| `messages`        | Chat messages between admin & players|
| `tags`            | Tag definitions                      |
| `support_contacts`| Facebook/phone contact info          |
| `counters`        | Auto-increment for player IDs        |

## Security

- Passwords hashed with Django's `make_password` (PBKDF2)
- Session-based auth with signed cookies
- CSRF protection on all forms
- Role-based access decorators (`@admin_required`, `@login_required_custom`)
- Players can only access their own data
- No public registration — admin creates all accounts

## License

This project is for educational purposes.

