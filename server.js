require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const hpp = require('hpp');

const app = express();
const PORT = process.env.PORT || 3000;

// Use system temp directory (reliable cross-platform)
const TEMP_DIR = os.tmpdir();
console.log(`[Temp] Using temp dir: ${TEMP_DIR}`);

// Security Middlewares
app.use(helmet({ contentSecurityPolicy: false }));
app.use(hpp());
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: { error: 'Too many requests' }
});
app.use('/api/', limiter);

// Proxy System
const PROXIES = process.env.PROXY_LIST ? process.env.PROXY_LIST.split(',') : [];
const getRandomProxy = () => PROXIES.length > 0 ? PROXIES[Math.floor(Math.random() * PROXIES.length)] : null;

// Helper: Sanitize Filename
function sanitizeFilename(filename) {
    if (!filename) return 'video';
    return filename.toString().replace(/[\\/:*?"<>|]/g, '_').substring(0, 100);
}

// Paths
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const FFMPEG_PATH = process.platform === 'win32' ? path.join(__dirname, 'ffmpeg.exe') : ffmpegInstaller.path;

// Dynamic YTDLP Path Resolution
// Priority: ./bin/yt-dlp (Render) > yt-dlp.exe (Windows local) > yt-dlp-exec > system
const YTDLP_BIN_PATH = path.join(__dirname, 'bin', 'yt-dlp');
let YTDLP_PATH;
if (fs.existsSync(YTDLP_BIN_PATH)) {
    YTDLP_PATH = YTDLP_BIN_PATH; // Render Linux binary
    console.log('[yt-dlp] Using ./bin/yt-dlp');
} else if (fs.existsSync(path.join(__dirname, 'yt-dlp.exe'))) {
    YTDLP_PATH = path.join(__dirname, 'yt-dlp.exe'); // Windows local
    console.log('[yt-dlp] Using yt-dlp.exe');
} else {
    try {
        const ytDlpExec = require('yt-dlp-exec/src/constants');
        if (ytDlpExec && ytDlpExec.YOUTUBE_DL_PATH && fs.existsSync(ytDlpExec.YOUTUBE_DL_PATH)) {
            YTDLP_PATH = ytDlpExec.YOUTUBE_DL_PATH;
            console.log('[yt-dlp] Using yt-dlp-exec path:', YTDLP_PATH);
        } else {
            YTDLP_PATH = 'yt-dlp';
        }
    } catch (e) {
        YTDLP_PATH = 'yt-dlp'; // System fallback
        console.log('[yt-dlp] Using system yt-dlp');
    }
}

// Cookie Path Resolution
// Support COOKIES_B64 env variable for Render/production deployment
let COOKIES_PATH = path.join(__dirname, 'cookies.txt');
if (process.env.COOKIES_B64) {
    try {
        const cookiesTempPath = path.join(TEMP_DIR, 'yt_cookies.txt');
        const cookiesContent = Buffer.from(process.env.COOKIES_B64, 'base64').toString('utf8');
        fs.writeFileSync(cookiesTempPath, cookiesContent);
        COOKIES_PATH = cookiesTempPath;
        console.log('[Cookies] Loaded from COOKIES_B64 env variable -> ' + cookiesTempPath);
    } catch (e) {
        console.warn('[Cookies] Failed to decode COOKIES_B64:', e.message);
    }
} else if (!fs.existsSync(COOKIES_PATH) && fs.existsSync(path.join(__dirname, 'cookies'))) {
    COOKIES_PATH = path.join(__dirname, 'cookies');
}
console.log(`[Cookies] Path: ${COOKIES_PATH} | Exists: ${fs.existsSync(COOKIES_PATH)}`);

// Latest User Agents
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
];
const getRandomUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

// Base yt-dlp Args
function getBaseYtdlpArgs() {
    const args = [
        '--no-check-certificates',
        '--no-warnings',
        '--geo-bypass',
        '--extractor-args', 'youtube:player_client=ios,android,web_creator,mweb;player_skip=web',
        '--user-agent', getRandomUA(),
        '--add-header', 'Accept-Language:en-US,en;q=0.9'
    ];
    const proxy = getRandomProxy();
    if (proxy) args.push('--proxy', proxy);
    if (fs.existsSync(COOKIES_PATH)) args.push('--cookies', COOKIES_PATH);
    return args;
}

/**
 * Robust Info Extraction
 */
async function fetchVideoInfo(videoUrl, maxRetries = 3) {
    let attempt = 0;
    let lastError = null;

    while (attempt < maxRetries) {
        attempt++;
        console.log(`[Info] Attempt ${attempt} for: ${videoUrl}`);

        // Try play-dl (Often bypassed YouTube blocks better)
        if (attempt === 1) {
            try {
                const play = require('play-dl');
                const info = await play.video_info(videoUrl);
                return {
                    title: info.video_details.title,
                    thumbnail: info.video_details.thumbnails.pop().url,
                    duration: info.video_details.durationRaw,
                    uploader: info.video_details.channel.name,
                    formats: info.format.map(f => ({
                        formatId: f.format_id || f.itag.toString(),
                        extension: f.container || 'mp4',
                        resolution: f.qualityLabel || (f.height ? `${f.height}p` : 'audio'),
                        hasVideo: f.hasVideo,
                        hasAudio: f.hasAudio,
                        url: f.url
                    })),
                    source: 'play-dl'
                };
            } catch (e) { console.log('play-dl failed'); }
        }

        // Try yt-dlp
        try {
            const args = ['--dump-json', '--no-playlist', ...getBaseYtdlpArgs(), videoUrl];
            const result = await new Promise((resolve, reject) => {
                const proc = spawn(YTDLP_PATH, args);
                let stdout = '';
                proc.stdout.on('data', d => stdout += d);
                proc.on('close', code => {
                    if (code === 0) resolve(JSON.parse(stdout));
                    else reject(new Error('yt-dlp failed'));
                });
            });

            return {
                title: result.title,
                thumbnail: result.thumbnail,
                duration: result.duration_string || result.duration,
                uploader: result.uploader || result.channel,
                formats: result.formats.map(f => ({
                    formatId: f.format_id,
                    extension: f.ext,
                    resolution: f.height ? `${f.height}p` : (f.format_note || 'audio'),
                    hasVideo: !!f.vcodec && f.vcodec !== 'none',
                    hasAudio: !!f.acodec && f.acodec !== 'none',
                    url: f.url
                })).filter(f => (f.hasVideo || f.hasAudio) && f.url),
                source: 'yt-dlp'
            };
        } catch (e) {
            lastError = e;
            if (attempt < maxRetries) await new Promise(r => setTimeout(r, 1000));
        }
    }
    throw lastError || new Error('Failed to fetch info');
}

app.get('/api/info', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).json({ error: 'URL is required' });
    try {
        const info = await fetchVideoInfo(videoUrl);
        const urlHash = crypto.createHash('md5').update(videoUrl).digest('hex');
        fs.writeFileSync(path.join(TEMP_DIR, `info_${urlHash}.json`), JSON.stringify(info));
        res.json({ ...info, urlHash });
    } catch (e) {
        res.status(500).json({ error: 'Extraction failed' });
    }
});

app.get('/api/download', async (req, res) => {
    const { url, format, ext, title } = req.query;
    if (!url || !format) return res.status(400).send('Missing params');

    const sanitizedTitle = sanitizeFilename(title);
    const tmpFile = path.join(TEMP_DIR, `nexdown_${Date.now()}.mp4`);

    console.log(`[Download] format="${format}" url="${url}" tmpFile="${tmpFile}"`);

    const args = [
        url,
        '-f', format,
        '--merge-output-format', 'mp4',
        '--ffmpeg-location', FFMPEG_PATH,
        '-o', tmpFile,
        '--no-check-certificates',
        '--geo-bypass',
        '--no-warnings',
        '--user-agent', getRandomUA(),
        '--extractor-args', 'youtube:player_client=ios,android,web_creator,mweb;player_skip=web'
    ];
    const proxy = getRandomProxy();
    if (proxy) args.push('--proxy', proxy);
    if (fs.existsSync(COOKIES_PATH)) args.push('--cookies', COOKIES_PATH);

    const ytdlp = spawn(YTDLP_PATH, args);
    ytdlp.stderr.on('data', d => process.stdout.write('[DL] ' + d.toString()));

    ytdlp.on('close', (code) => {
        if (code !== 0 || !fs.existsSync(tmpFile)) {
            if (!res.headersSent) res.status(500).send('Download failed');
            return;
        }
        // Stream the finished file to client
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(sanitizedTitle)}.mp4"`);
        res.setHeader('Content-Type', 'video/mp4');
        const fileStream = fs.createReadStream(tmpFile);
        fileStream.pipe(res);
        fileStream.on('close', () => {
            // Clean up temp file
            try { fs.unlinkSync(tmpFile); } catch (e) { }
        });
    });

    req.on('close', () => {
        ytdlp.kill();
        try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (e) { }
    });
});

app.get('/api/audio', async (req, res) => {
    const { url, urlHash, title } = req.query;
    const sanitizedTitle = sanitizeFilename(title);
    const infoFile = path.join(TEMP_DIR, `info_${urlHash}.json`);
    try {
        let info = fs.existsSync(infoFile) ? JSON.parse(fs.readFileSync(infoFile)) : await fetchVideoInfo(url);
        const audio = info.formats.filter(f => f.hasAudio && !f.hasVideo).pop() || info.formats.find(f => f.hasAudio);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(sanitizedTitle)}.mp3"`);
        const ffmpeg = spawn(FFMPEG_PATH, ['-i', audio.url, '-codec:a', 'libmp3lame', '-qscale:a', '2', '-f', 'mp3', 'pipe:1']);
        ffmpeg.stdout.pipe(res);
        req.on('close', () => ffmpeg.kill());
    } catch (e) { res.status(500).send('Audio failed'); }
});

app.listen(PORT, () => {
    console.log(`NexDown Running on Port ${PORT} | Proxies: ${PROXIES.length} | Cookies: ${fs.existsSync(COOKIES_PATH) ? 'YES' : 'NO'}`);
});
