# NexDown - #1 Fast YouTube & Instagram Downloader

![NexDown Preview](https://nexdown.com/preview.jpg)

NexDown is a premium, ultra-fast web application designed to download YouTube Videos, Shorts, Instagram Reels, and convert them to high-quality MP3 audio. Built with high performance and SEO in mind, it provides a seamless user experience with a modern, mystical UI.

## 🚀 Features

- **High Resolution Downloads:** Support for 1080p, 2K, and 4K video downloads.
- **YouTube Shorts & Instagram Reels:** Automatically detects and processes Shorts and Reels links.
- **Studio Quality MP3:** Convert any video to high bit-rate 320kbps MP3 audio.
- **Lightning Fast:** Optimized backend architecture using `yt-dlp` and `ffmpeg` for rapid processing.
- **Premium UI/UX:** Modern design with glassmorphism, smooth animations, and a responsive layout.
- **SEO Optimized:** Structured data and meta tags for maximum visibility.

## 🛠️ Tech Stack

- **Frontend:** HTML5, CSS3 (Vanilla), JavaScript (ES6+)
- **Backend:** Node.js, Express.js
- **Processing:** `yt-dlp` (Video extraction), `ffmpeg` (Media merging & conversion)
- **Deployment:** Vercel / Node.js Server

## 📦 Installation & Setup

### Prerequisites
- [Node.js](https://nodejs.org/) (v16+)
- [FFmpeg](https://ffmpeg.org/download.html)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)

### Steps
1. **Clone the repository:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/NexDown.git
   cd NexDown
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **External Binaries:**
   Ensure `ffmpeg` and `yt-dlp` are installed and available in your system's PATH. On Windows, you can place `ffmpeg.exe` and `yt-dlp.exe` in the root directory.

4. **Start the server:**
   ```bash
   npm start
   ```
   The application will be running at `http://localhost:3000`.

## 📂 Project Structure

```text
├── public/              # Frontend assets (HTML, CSS, JS)
│   ├── index.html       # Main landing page
│   ├── style.css        # Premium styling
│   └── script.js        # Frontend logic
├── server.js            # Node.js/Express backend
├── package.json         # Project metadata & dependencies
├── vercel.json          # Vercel deployment configuration
└── README.md            # Project documentation
```

## 📄 License

This project is licensed under the ISC License.

---
Developed with ❤️ by **Biradar Swapnil**
