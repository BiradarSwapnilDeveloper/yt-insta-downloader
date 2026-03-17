const express = require('express');
const cors = require('cors');
const { spawn, execSync, execFileSync, exec, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Set temp directory to /tmp on Linux (Vercel) or stay with O:\ on Windows
if (process.platform === 'win32') {
    process.env.TEMP = 'O:\\temp';
    process.env.TMP = 'O:\\temp';
} else {
    process.env.TEMP = '/tmp';
    process.env.TMP = '/tmp';
}

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
let YTDLP_PATH = process.platform === 'win32' ? path.join(__dirname, 'yt-dlp.exe') : 'yt-dlp';

// Priority: Local exe (Windows) > @distube/yt-dlp (Linux) > yt-dlp-exec
try {
    if (process.platform !== 'win32') {
        const distubePath = require('@distube/yt-dlp').path;
        if (fs.existsSync(distubePath)) {
            YTDLP_PATH = distubePath;
        }
    } else {
        const ytDlpExecPath = require('yt-dlp-exec/src/constants').YOUTUBE_DL_PATH;
        if (fs.existsSync(ytDlpExecPath) && !fs.existsSync(path.join(__dirname, 'yt-dlp.exe'))) {
            YTDLP_PATH = ytDlpExecPath;
        }
    }
} catch (e) {
    console.log('Using default YTDLP_PATH fallback');
}

const FFMPEG_PATH = process.platform === 'win32' ? path.join(__dirname, 'ffmpeg.exe') : ffmpegInstaller.path;

// Helper to sanitize filenames
const sanitizeFilename = (name) => name.replace(/[^\w\s-\.]/gi, '').substring(0, 100);

// Endpoint to get video information
app.get('/api/info', (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).json({ error: 'URL is required' });

    const ytDlpObj = require('yt-dlp-exec');
    ytDlpObj(videoUrl, {
        dumpJson: true,
        noPlaylist: true,
        noCheckCertificates: true,
        noWarnings: true
    }, {
        shell: true // Required for some environments
    }).then(info => {
        try {
            const urlHash = crypto.createHash('md5').update(videoUrl).digest('hex');
            const infoFile = path.join(process.env.TEMP, `info_${urlHash}.json`);
            fs.writeFileSync(infoFile, JSON.stringify(info));
            
            let finalFormats = [];
            let seenResolutions = new Set();
            
            // Extract video formats and deduplicate by resolution
            const videoFormats = info.formats
                .filter(f => f.vcodec !== 'none' && f.height)
                .sort((a, b) => b.height - a.height); // highest to lowest
                
            for (let f of videoFormats) {
                let res = `${f.height}p`;
                // include resolutions from ~144p to 1080p+
                if (!seenResolutions.has(res)) {
                    seenResolutions.add(res);
                    finalFormats.push({
                        formatId: f.format_id,
                        extension: f.ext === 'webm' || !f.ext ? 'mp4' : f.ext,
                        resolution: res,
                        quality: f.format_note || '',
                        filesize: f.filesize || f.filesize_approx,
                        hasVideo: true,
                        // if the format specifically doesn't have an audio codec inside it, hasAudio is false and we need to use stream
                        hasAudio: f.acodec && f.acodec !== 'none'
                    });
                }
            }

            res.json({
                title: info.title,
                thumbnail: info.thumbnail,
                duration: info.duration_string,
                uploader: info.uploader || info.channel,
                formats: finalFormats,
                urlHash: urlHash
            });
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Error parsing video information' });
        }
    }).catch(e => {
        console.error('Info fetching error via ytDlp:', e);
        return res.status(500).json({ error: 'Failed to fetch video information. Please check the URL.', details: e ? e.message : String(e) });
    });
});

// Endpoint to download
app.get('/api/download', (req, res) => {
    const { url, urlHash, format, ext, title, hasAudio } = req.query;
    if (!url || !format) return res.status(400).send('URL and format are required');

    const sanitizedTitle = sanitizeFilename(title || 'video');
    const finalExt = ext || 'mp4';
    
    // Check if we have cached info to bypass extraction delay
    const targetHash = urlHash || crypto.createHash('md5').update(url).digest('hex');
    const infoFile = path.join(process.env.TEMP, `info_${targetHash}.json`);
    const hasCachedInfo = fs.existsSync(infoFile);
    
    // Use --load-info-json to instantly start download instead of passing url
    const sourceArg = hasCachedInfo ? ['--load-info-json', infoFile] : [url];

    if (hasAudio === 'true' || hasAudio === true) {
        // Instant streaming for formats that already include both audio and video (like 360p, 720p)
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(sanitizedTitle)}.${finalExt}"`);
        const ytdlp = spawn(YTDLP_PATH, [
            ...sourceArg,
            '-f', format,
            '-o', '-',
            '--extractor-args', 'youtube:player_client=android',
            '--concurrent-fragments', '4',
            '--http-chunk-size', '10M',
            '--no-check-certificates',
            '--quiet'
        ]);

        ytdlp.stdout.pipe(res);
        ytdlp.stderr.on('data', (data) => console.error(`yt-dlp stderr: ${data}`));
        req.on('close', () => ytdlp.kill());
        return;
    }

    // Processing for high-quality (1080p+, 720p) which are video-only and require merging with audio
    try {
        let info;
        if (hasCachedInfo) {
            info = JSON.parse(fs.readFileSync(infoFile));
        } else {
            console.log('Cache missing, fetching info again...');
            const args = [url, '--dump-json', '--no-playlist', '--no-check-certificates', '--no-warnings'];
            const stdout = execFileSync(YTDLP_PATH, args, { maxBuffer: 10 * 1024 * 1024 }).toString();
            info = JSON.parse(stdout);
        }

        const videoFormat = info.formats.find(f => f.format_id === format);
        const audioFormats = info.formats.filter(f => f.acodec !== 'none' && (f.vcodec === 'none' || !f.vcodec)).reverse();
        const audioFormat = audioFormats.find(f => f.ext === 'm4a') || audioFormats[0];

        if (videoFormat && videoFormat.url && audioFormat && audioFormat.url) {
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(sanitizedTitle)}.${finalExt}"`);
            res.setHeader('Content-Type', 'video/mp4');

            const ffmpeg = spawn(FFMPEG_PATH, [
                '-i', videoFormat.url,
                '-i', audioFormat.url,
                '-c', 'copy',
                '-movflags', 'frag_keyframe+empty_moov',
                '-f', 'mp4',
                'pipe:1'
            ]);

            ffmpeg.stdout.pipe(res);
            ffmpeg.stderr.on('data', d => console.error(`ffmpeg merged stream log: \${d}`));
            req.on('close', () => ffmpeg.kill());
            return;
        }
    } catch(e) {
        console.error('Instant stream failed:', e);
        if (!res.headersSent) res.status(500).send('Failed to process high-quality video stream');
        return;
    }

    const ytdlpArgs = [];
});
// Endpoint for MP3 conversion
app.get('/api/audio', (req, res) => {
    const { url, urlHash, title } = req.query;
    if (!url) return res.status(400).send('URL is required');

    const sanitizedTitle = sanitizeFilename(title || 'audio');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(sanitizedTitle)}.mp3"`);
    res.setHeader('Content-Type', 'audio/mpeg');
    
    const targetHash = urlHash || crypto.createHash('md5').update(url).digest('hex');
    const infoFile = path.join(process.env.TEMP, `info_${targetHash}.json`);
    const hasCachedInfo = fs.existsSync(infoFile);
    const sourceArg = hasCachedInfo ? ['--load-info-json', infoFile] : [url];

    const ytdlp = spawn(YTDLP_PATH, [
        ...sourceArg, 
        '-f', 'bestaudio', 
        '-o', '-',
        '--concurrent-fragments', '4',
        '--http-chunk-size', '10M',
        '--quiet',
        '--no-warnings'
    ]);
    const ffmpegProcess = spawn(FFMPEG_PATH, [
        '-i', 'pipe:0',
        '-codec:a', 'libmp3lame',
        '-qscale:a', '2',
        '-f', 'mp3',
        'pipe:1'
    ]);

    ytdlp.stdout.pipe(ffmpegProcess.stdin);
    ffmpegProcess.stdout.pipe(res);

    res.on('close', () => {
        ytdlp.kill();
        ffmpegProcess.kill();
    });
});

app.listen(PORT, () => {
    console.log(`NexDown Server running at http://localhost:${PORT}`);
});

module.exports = app;
