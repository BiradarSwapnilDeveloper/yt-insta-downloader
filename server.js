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

// Robust extraction helper
async function fetchVideoInfo(videoUrl) {
    let lastError = null;
    
    // Attempt 1: play-dl (Native node library, often better headers)
    try {
        console.log('Attempting extraction via play-dl...');
        const play = require('play-dl');
        const info = await play.video_info(videoUrl);
        
        const finalFormats = info.format.map(f => ({
            formatId: f.format_id || f.itag.toString(),
            extension: f.container || (f.mimeType ? f.mimeType.split('/')[1].split(';')[0] : 'mp4'),
            resolution: f.qualityLabel || (f.height ? `${f.height}p` : 'audio'),
            quality: f.qualityLabel || '',
            filesize: f.contentLength || 0,
            hasVideo: f.hasVideo,
            hasAudio: f.hasAudio,
            url: f.url // play-dl gives direct URLs
        })).filter(f => f.resolution);

        return {
            title: info.video_details.title,
            thumbnail: info.video_details.thumbnails.pop().url,
            duration: info.video_details.durationRaw,
            uploader: info.video_details.channel.name,
            formats: finalFormats,
            source: 'play-dl'
        };
    } catch (e) {
        console.error('play-dl failed:', e.message);
        lastError = e;
    }

    // Attempt 2: yt-dlp with multi-client fallback
    try {
        console.log('Attempting extraction via yt-dlp fallback...');
        const ytDlpObj = require('yt-dlp-exec');
        const info = await ytDlpObj(videoUrl, {
            dumpJson: true,
            noPlaylist: true,
            noCheckCertificates: true,
            noWarnings: true,
            extractorArgs: 'youtube:player_client=ios,tv,web_creator,mweb,android'
        }, { shell: true });

        const finalFormats = info.formats
            .filter(f => f.height || f.acodec !== 'none')
            .map(f => ({
                formatId: f.format_id,
                extension: f.ext === 'webm' || !f.ext ? 'mp4' : f.ext,
                resolution: f.height ? `${f.height}p` : 'audio',
                quality: f.format_note || '',
                filesize: f.filesize || f.filesize_approx || 0,
                hasVideo: f.vcodec !== 'none',
                hasAudio: f.acodec !== 'none'
            }));

        return {
            title: info.title,
            thumbnail: info.thumbnail,
            duration: info.duration_string,
            uploader: info.uploader || info.channel,
            formats: finalFormats,
            source: 'yt-dlp',
            raw: info
        };
    } catch (e) {
        console.error('yt-dlp failed:', e.message);
        lastError = e;
    }

    // Attempt 3: Proxied API Fallback (Piped/Invidious)
    try {
        console.log('Attempting extraction via Proxied API fallback...');
        const axios = require('axios');
        const videoIdMatch = videoUrl.match(/(?:v=|\/|embed\/|shorts\/)([0-9A-Za-z_-]{11})/);
        const videoId = videoIdMatch ? videoIdMatch[1] : videoUrl.split('/').pop().split('?')[0];
        
        const response = await axios.get(`https://pipedapi.kavin.rocks/streams/${videoId}`, { timeout: 10000 });
        const data = response.data;

        const finalFormats = data.videoStreams.map(s => ({
            formatId: s.url,
            extension: 'mp4',
            resolution: s.quality,
            quality: s.quality,
            filesize: s.contentLength || 0,
            hasVideo: true,
            hasAudio: !s.videoOnly,
            url: s.url
        })).concat(data.audioStreams.map(s => ({
            formatId: s.url,
            extension: 'mp3',
            resolution: 'audio',
            quality: `${s.bitrate}kbps`,
            filesize: s.contentLength || 0,
            hasVideo: false,
            hasAudio: true,
            url: s.url
        })));

        return {
            title: data.title,
            thumbnail: data.thumbnailUrl,
            duration: new Date(data.duration * 1000).toISOString().substr(11, 8).replace(/^00:/, ''),
            uploader: data.uploader,
            formats: finalFormats,
            source: 'piped-api'
        };
    } catch (e) {
        console.error('Proxied API failed:', e.message);
        lastError = e;
    }

    throw new Error(`All extraction methods failed. YouTube is blocking the server. Last error: ${lastError.message}`);
}

// Endpoint to get video information
app.get('/api/info', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).json({ error: 'URL is required' });

    try {
        const info = await fetchVideoInfo(videoUrl);
        const urlHash = crypto.createHash('md5').update(videoUrl).digest('hex');
        const infoFile = path.join(process.env.TEMP, `info_${urlHash}.json`);
        
        // Cache info for downloads
        fs.writeFileSync(infoFile, JSON.stringify(info));

        res.json({
            ...info,
            urlHash: urlHash
        });
    } catch (e) {
        console.error('API Info Error:', e);
        res.status(500).json({ 
            error: 'Failed to fetch video information. YouTube is aggressively blocking data center IPs.', 
            details: e.message 
        });
    }
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
    const cachedInfo = JSON.parse(fs.readFileSync(infoFile));
    const isPlayDL = cachedInfo.source === 'play-dl';
    
    // For play-dl, we might already have the URL or need to re-fetch it
    const formatData = cachedInfo.formats.find(f => f.formatId === format);

    if (hasAudio === 'true' || hasAudio === true || (formatData && formatData.hasAudio)) {
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(sanitizedTitle)}.${finalExt}"`);
        
        if (isPlayDL && formatData.url) {
            // Direct streaming for play-dl URLs
            axios({
                method: 'get',
                url: formatData.url,
                responseType: 'stream',
                headers: { 'User-Agent': 'Mozilla/5.0' }
            }).then(response => response.data.pipe(res))
              .catch(e => res.status(500).send('Streaming failed'));
            return;
        }

        const ytdlp = spawn(YTDLP_PATH, [
            ...sourceArg,
            '-f', format,
            '-o', '-',
            '--extractor-args', 'youtube:player_client=ios,tv,web_creator,mweb,android',
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
            const args = [url, '--dump-json', '--no-playlist', '--no-check-certificates', '--no-warnings', '--extractor-args', 'youtube:player_client=ios,tv,web_creator,mweb,android'];
            const stdout = execFileSync(YTDLP_PATH, args, { maxBuffer: 10 * 1024 * 1024 }).toString();
            info = JSON.parse(stdout);
        }

        const videoFormat = info.formats.find(f => f.formatId === format || f.format_id === format);
        const audioFormat = info.formats.filter(f => f.hasAudio && !f.hasVideo).pop() || info.formats.find(f => f.hasAudio);

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
app.get('/api/audio', async (req, res) => {
    const { url, urlHash, title } = req.query;
    if (!url) return res.status(400).send('URL is required');

    const sanitizedTitle = sanitizeFilename(title || 'audio');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(sanitizedTitle)}.mp3"`);
    res.setHeader('Content-Type', 'audio/mpeg');
    
    const targetHash = urlHash || crypto.createHash('md5').update(url).digest('hex');
    const infoFile = path.join(process.env.TEMP, `info_${targetHash}.json`);
    
    try {
        let infoData;
        if (fs.existsSync(infoFile)) {
            infoData = JSON.parse(fs.readFileSync(infoFile));
        } else {
            infoData = await fetchVideoInfo(url);
        }

        const audioFormat = infoData.formats.filter(f => f.hasAudio && !f.hasVideo).pop() || infoData.formats.find(f => f.hasAudio);
        const audioUrl = audioFormat ? audioFormat.url : null;

        if (audioUrl) {
            const ffmpegProcess = spawn(FFMPEG_PATH, [
                '-i', audioUrl,
                '-codec:a', 'libmp3lame',
                '-qscale:a', '2',
                '-f', 'mp3',
                'pipe:1'
            ]);
            ffmpegProcess.stdout.pipe(res);
            res.on('close', () => ffmpegProcess.kill());
            return;
        }

        // Fallback to yt-dlp
        const ytdlp = spawn(YTDLP_PATH, [
            url,
            '-f', 'bestaudio', 
            '-o', '-',
            '--extractor-args', 'youtube:player_client=ios,tv,web_creator,mweb,android',
            '--concurrent-fragments', '4',
            '--http-chunk-size', '10M',
            '--quiet',
            '--no-warnings'
        ]);
        const ffmpegProcessFallback = spawn(FFMPEG_PATH, [
            '-i', 'pipe:0',
            '-codec:a', 'libmp3lame',
            '-qscale:a', '2',
            '-f', 'mp3',
            'pipe:1'
        ]);

        ytdlp.stdout.pipe(ffmpegProcessFallback.stdin);
        ffmpegProcessFallback.stdout.pipe(res);

        res.on('close', () => {
            ytdlp.kill();
            ffmpegProcessFallback.kill();
        });
    } catch (e) {
        console.error('Audio extraction failed:', e);
        res.status(500).send('Audio extraction failed');
    }
});

app.listen(PORT, () => {
    console.log(`NexDown Server running at http://localhost:${PORT}`);
});

module.exports = app;
