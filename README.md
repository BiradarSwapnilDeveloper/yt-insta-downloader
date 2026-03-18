# NexDown Pro - Production-Level Downloader API

A robust Node.js backend for downloading YouTube and Instagram videos with advanced anti-blocking features.

## Features
- **Proxy Rotation**: Automatically rotates through a list of residential proxies.
- **Anti-Block System**: Detects YouTube blocks and retries up to 5 times with different proxies and delays.
- **Cookie Support**: Uses `cookies.txt` for authenticated requests to bypass age/region restrictions.
- **Security**: Rate limiting, XSS protection (Helmet), and HPP protection.
- **High Performance**: Asynchronous execution using `yt-dlp`.

## Prerequisites
1. **Node.js**: v18 or higher recommended.
2. **yt-dlp**: Make sure `yt-dlp.exe` (on Windows) or `yt-dlp` (on Linux) is in the root directory.
3. **FFmpeg**: Required for merging video and audio.

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure Environment:
   Create a `.env` file in the root (example provided):
   ```
   PORT=3000
   PROXY_LIST=http://user:pass@proxy1:port,http://user:pass@proxy2:port
   RATE_LIMIT_MAX_REQUESTS=100
   ```

3. Add Cookies:
   Place your `cookies.txt` file in the root directory to enable logged-in features.

## Running Locally

```bash
node server.js
```

The server will start at `http://localhost:3000`.

## API Usage

### GET `/download`
Returns metadata and direct download links for a video.

**Parameters:**
- `url`: The YouTube or Instagram URL.

**Example:**
`http://localhost:3000/download?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ`

**Success Response:**
```json
{
  "title": "Video Title",
  "thumbnail": "https://...",
  "formats": [
    {
      "format_id": "22",
      "extension": "mp4",
      "resolution": "1280x720",
      "url": "https://..."
    }
  ]
}
```

## Security Recommendation for VPS
- Always use a reverse proxy like **Nginx** with SSL (Certbot).
- Use **PM2** to keep the process running: `pm2 start server.js`.
