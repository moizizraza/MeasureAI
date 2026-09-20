# 📐 MeasureAI — AI Object Measurement Web App

Real-time, on-device AI camera measurement application running directly in the browser (100% offline, zero API keys required).

---

## 🚀 How to Run in VS Code

### 1. Open the project folder
1. Open **VS Code**.
2. Click **File** ➔ **Open Folder...**
3. Select `MeasureAI` from your Desktop (`C:\Users\moizi\Desktop\MeasureAI`).

### 2. Open the Terminal in VS Code
- Press `Ctrl` + `~` (or `Ctrl` + `\``), or go to top menu **Terminal** ➔ **New Terminal**.

### 3. Run the Secure HTTPS Server
In the VS Code terminal, type:
```powershell
python server.py
```
*(or run `.\start.bat`)*

You will see:
```text
========================================================
           MeasureAI - Secure HTTPS Server              
========================================================
  Laptop/PC:  https://localhost:3333
  Phone:      https://172.20.10.2:3333
--------------------------------------------------------
```

---

## 🔒 Why HTTPS is Required for Phones

Modern web browsers (Chrome, Safari, iOS, Android) strictly require **HTTPS** (or `localhost`) to access camera hardware via `navigator.mediaDevices.getUserMedia`. Plain `http://` over local network IPs is blocked by browser security.

### To open on your phone:
1. Ensure your phone is connected to the **same WiFi** as your PC.
2. Open Chrome or Safari on your phone and go to:
   ```text
   https://<YOUR-PC-IP>:3333
   ```
3. Because the certificate is local self-signed:
   - Tap **Advanced** (or *Show Details*)
   - Tap **Proceed to ... (unsafe)** / *Visit this website*
4. Tap **Allow** when prompted for Camera permission.

---

## 🌐 Free Options to Make it Live on the Web (With Official SSL)

Since MeasureAI is a completely client-side AI app (TensorFlow.js runs on the device GPU/CPU in the browser), you can host it for free with a verified HTTPS certificate:

### Option A: GitHub Pages (100% Free & Permanent)
1. In VS Code terminal:
   ```powershell
   git init
   git add .
   git commit -m "Deploy MeasureAI"
   ```
2. Push to a GitHub repository.
3. In GitHub repo Settings ➔ **Pages** ➔ set branch to `main` ➔ Save.
4. Your site will be live at `https://<your-username>.github.io/<repo-name>/` with official HTTPS and instant camera support on all mobile devices!

### Option B: Netlify / Vercel Drop
1. Go to [netlify.com/drop](https://app.netlify.com/drop).
2. Drag and drop the `MeasureAI` folder from your Desktop into the browser window.
3. You will instantly get a live, secure `https://your-app.netlify.app` link.
