# 🎂 WhatsApp Group Birthday Bot

A 24/7 cloud-ready WhatsApp automation bot built with **Baileys (Multi-Device protocol)** and **Node.js**, designed to be hosted on **Render** with persistent session storage on **Filebase S3**.

---

## 🌟 Key Features

- **📱 Pairing Code Login**: Log in by entering your WhatsApp phone number and typing the 8-character pairing code into WhatsApp on your phone. No QR camera scanning required!
- **👥 WhatsApp Group Messaging**: Send automated birthday greetings directly into your chosen WhatsApp group with @mentions and personalized messages.
- **☁️ Filebase S3 Session Persistence**: All session keys and birthday data are synchronized to your Filebase S3 bucket as a single compact bundle. Restarts, redeployments, or sleeping instances on Render will **never** lose your WhatsApp login!
- **⏰ Automated Midnight Scheduler**: Checks birthdays every day at midnight (or your custom hour/timezone) using `node-cron` and sends greetings automatically.
- **📜 Live Activity & Log Console**: Built-in real-time stream in dashboard showing every scheduled check, birthday dispatch, and connection event.
- **💻 Modern Web Dashboard**: Live web interface to manage birthdays, select groups, test send messages, and monitor connection status.
- **🚀 1-Click Render Deployment**: Includes `render.yaml`, `Dockerfile`, and health check `/health` endpoints.

---

## 🚀 Quick Start (Local Run)

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment**:
   Copy `.env.example` to `.env` and fill in your Filebase credentials:
   ```ini
   PORT=3000
   ADMIN_PASSWORD=your_secure_admin_password
   FILEBASE_KEY=your_filebase_access_key
   FILEBASE_SECRET=your_filebase_secret_key
   FILEBASE_BUCKET=your_bucket_name
   FILEBASE_ENDPOINT=https://s3.filebase.io
   FILEBASE_REGION=us-east-1
   ```

3. **Start the Server**:
   ```bash
   npm start
   ```

4. Open your browser at **`http://localhost:3000`**.

---

## 📱 How to Pair with WhatsApp

1. Go to the **Link WhatsApp** tab on the web dashboard.
2. Enter your phone number with country code (e.g. `919876543210` or `14155552671`).
3. Click **Get Pairing Code**.
4. You will receive an 8-character pairing code (e.g. `ABCD-1234`).
5. Open **WhatsApp** on your phone &rarr; Tap **Settings** / **⋮ Menu** &rarr; **Linked Devices** &rarr; **Link a Device**.
6. Tap **"Link with phone number instead"** at the bottom and type the 8-digit code.
7. You are connected! The session keys will automatically upload to your Filebase S3 bucket.

---

## 👥 How to Configure WhatsApp Group & Birthdays

1. Go to the **Target Group** tab &rarr; Click **🔄 Refresh Groups** &rarr; Select your desired group from the dropdown &rarr; Click **Save Target Group**.
2. Go to the **Birthday List** tab &rarr; Click **+ Add Birthday** &rarr; Enter name, date of birth (`MM-DD`), and optional phone number for @mention.
3. Click **🚀 (Rocket icon)** on any birthday entry to send an instant test greeting into your WhatsApp group.
4. Open the **📜 Activity Logs** tab anytime to watch scheduled checks and message delivery logs in real time.

---

## ☁️ Deploying to Render.com

### Option 1: Direct Git Repo Deploy (Recommended)
1. Push this project to GitHub / GitLab.
2. Go to [Render Dashboard](https://dashboard.render.com).
3. Click **New +** &rarr; **Web Service**.
4. Connect your GitHub repository.
5. Set:
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/health`
6. Under **Environment Variables**, add:
   - `ADMIN_PASSWORD` = `your_admin_password`
   - `FILEBASE_KEY` = `your_filebase_key`
   - `FILEBASE_SECRET` = `your_filebase_secret`
   - `FILEBASE_BUCKET` = `your_bucket_name`
   - `FILEBASE_ENDPOINT` = `https://s3.filebase.io`
   - `FILEBASE_REGION` = `us-east-1`
   - `PORT` = `3000`
7. Click **Create Web Service**.

### Option 2: Render Blueprint (`render.yaml`)
1. Click **New +** &rarr; **Blueprint** on Render.
2. Select your repository — Render will automatically read `render.yaml` and prompt you for the S3 credentials!
