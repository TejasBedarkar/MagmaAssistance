# Complete Migration & Setup Plan for New Laptop
## Frappe ERP & AI Assistant (MagmaAssistance)

> **Document Purpose**: Give this document to **Antigravity** on your new laptop. It contains the exact branches, apps, system dependencies, credentials checklist, database restore commands, and step-by-step instructions needed to configure everything cleanly.

---

## 📌 Repository & Branch Information

* **Repository**: `https://github.com/TejasBedarkar/MagmaAssistance.git` (also mirrored at `https://github.com/Terminator1321/MagmaAssistance.git`)
* **Primary Active Branch**: `feat/apollo-lead-enrichment`
* **Other Required Branches (already pushed & available on GitHub)**:
  * `feat/manufacturing-skills-router`
  * `feat/erp-business-plan-foundation`

---

## 🛠️ Step-by-Step Setup Guide (For Antigravity on New Laptop)

---

### PART 1: Frappe ERPNext Setup (Inside WSL Ubuntu)

#### 1. System Dependencies
Run inside WSL (Ubuntu 22.04 / 24.04):
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git python3-dev python3-pip python3-venv mariadb-server mariadb-client \
    redis-server curl xvfb libfontconfig wkhtmltopdf libmysqlclient-dev build-essential
```

#### 2. Node.js & Yarn
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
npm install -g yarn
```

#### 3. MariaDB Configuration
Frappe requires specific MariaDB collation and unicode settings.
Edit `/etc/mysql/mariadb.conf.d/50-server.cnf` (or `/etc/mysql/my.cnf`) and ensure the following exists under `[mysqld]`:
```ini
[mysqld]
character-set-client-handshake = FALSE
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci

[mysql]
default-character-set = utf8mb4
```
Then restart services:
```bash
sudo service mariadb restart
sudo service redis-server restart
```
Set MariaDB root password (if prompted during `sudo mysql_secure_installation` or set via `sudo mysql`):
```sql
ALTER USER 'root'@'localhost' IDENTIFIED BY 'admin';
FLUSH PRIVILEGES;
```

#### 4. Bench Initialization
Install `frappe-bench` and initialize the bench using Frappe Version 16:
```bash
pip3 install frappe-bench
cd ~
bench init --frappe-branch version-16 frappe-bench-16
cd ~/frappe-bench-16
```

#### 5. Fetch Apps
Clone the required apps:
```bash
bench get-app --branch version-16 erpnext
bench get-app --branch version-16 hrms
bench get-app --branch cleanup/consolidation https://github.com/MagnaData2026/erp_theme.git custom_ui
```

#### 6. Create Site & Restore Company Backup Files
Your company provided you with the database and files backup (typically a `.sql.gz` database file and `.tar` public/private file archives).

1. First, create a new site:
   ```bash
   bench new-site magna.local \
       --mariadb-root-password "admin" \
       --admin-password "admin"
   bench --site magna.local install-app erpnext
   bench --site magna.local install-app hrms
   bench --site magna.local install-app custom_ui
   ```

2. Restore the company backup files onto the site:
   ```bash
   # If you have database sql.gz and files tar:
   bench --site magna.local restore /path/to/database.sql.gz \
       --with-public-files /path/to/files.tar \
       --with-private-files /path/to/private-files.tar

   # Run migrate to align schema:
   bench --site magna.local migrate
   ```

#### 7. Local Host Name Mapping
Add `magna.local` to `/etc/hosts` in WSL:
```bash
echo "127.0.0.1 magna.local" | sudo tee -a /etc/hosts
```
And on Windows (open Notepad as Administrator, edit `C:\Windows\System32\drivers\etc\hosts`):
```
127.0.0.1 magna.local
```

#### 8. Start Frappe Server
```bash
cd ~/frappe-bench-16/sites
bench --site magna.local serve --port 8001
```

---

### PART 2: AI Assistant Setup (MagmaAssistance)

Run directly on Windows (or inside WSL) using Python 3.10 to 3.12:

#### 1. Clone Repository & Check Out Active Branch
```powershell
git clone https://github.com/TejasBedarkar/MagmaAssistance.git
cd MagmaAssistance
git checkout feat/apollo-lead-enrichment
```
*(If you want to work on `feat/manufacturing-skills-router` or `feat/erp-business-plan-foundation`, they are also available via `git checkout <branch>`.)*

#### 2. Virtual Environment & Dependencies
```powershell
py -3.10 -m venv venv
.\venv\Scripts\activate
python -m pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
```

#### 3. Download AI Embeddings Model
```powershell
python ModelDownload.py --tool-rag-dir ERP\models\all-MiniLM-L6-v2
```

#### 4. Configure `.env`
Copy `.env.example` to `.env`:
```powershell
cp .env.example .env
```
Ensure the key variables are configured in `.env`:
```ini
# ERPNext Connection
ERP_URL=http://localhost:8001
ERP_API_KEY=<YOUR_API_KEY>
ERP_API_SECRET=<YOUR_API_SECRET>
FRAPPE_SITE_NAME=magna.local

# LLM Providers
OPENAI_API_KEY=<YOUR_OPENAI_KEY>
LLM_MODEL=gpt-4o-mini

# Lead Enrichment & Search
APOLLO_API_KEY=<YOUR_APOLLO_KEY>
TAVILY_API_KEY=<YOUR_TAVILY_KEY>

# Audio Settings
TTS_VOICE=alloy
OPENAI_TTS_MODEL=gpt-4o-mini-tts

# Server Port & CORS
PORT=8005
ALLOWED_ORIGINS=http://localhost:8001,http://magna.local:8001,http://127.0.0.1:8001
```

#### 5. Generate API Keys in ERPNext
1. Open `http://localhost:8001` in your browser.
2. Log in with `Administrator` (password: `admin` or your company backup password).
3. Search for **User** -> Select **Administrator**.
4. Scroll to **API Access** -> Click **Generate Keys**.
5. Copy the generated **API Key** and **API Secret** into `.env`.

#### 6. Start the AI Assistant Backend
```powershell
python server.py --port 8005
# Or double-click setup_and_run.bat
```

---

## 📋 Copy-Paste Prompt for Antigravity on New Laptop

When you open Antigravity on your new laptop, paste this exact prompt:

```text
Hi Antigravity! I need to set up our project on this new laptop.
Please follow the complete specifications in NEW_LAPTOP_SETUP_PLAN.md:

1. Frappe ERP (inside WSL Ubuntu):
   - Install dependencies (Python 3.10+, Node 20, MariaDB utf8mb4, Redis).
   - Frappe bench version-16 in ~/frappe-bench-16.
   - Apps: frappe (v16), erpnext (v16), hrms (v16), custom_ui (branch: cleanup/consolidation from https://github.com/MagnaData2026/erp_theme.git).
   - Site name: magna.local on port 8001.
   - I have the database/backup files ready to restore onto magna.local.

2. AI Assistant (MagmaAssistance):
   - Repo: https://github.com/TejasBedarkar/MagmaAssistance.git
   - Active branch: feat/apollo-lead-enrichment (also fetch feat/manufacturing-skills-router and feat/erp-business-plan-foundation).
   - Setup Python 3.10 venv, install requirements.txt, and run ModelDownload.py.
   - Configure .env to point to http://localhost:8001.

Please execute the setup step-by-step. Prompt me whenever you need sudo passwords, database credentials, or API keys!
```
