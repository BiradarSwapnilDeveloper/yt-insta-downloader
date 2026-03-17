const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// We imagine we have the URLs. Instead of getting them from cache, let's use yt-dlp to get them quickly
const execSync = require('child_process').execSync;

try {
    const ytdlpPath = path.join(__dirname, 'yt-dlp.exe');
    const ffmpegPath = path.join(__dirname, 'ffmpeg.exe');
    const url = 'https://www.youtube.com/watch?v=M7FIvfx5J10';

    console.log('Fetching URLs...');
    // getting 136 (720p) and 140 (audio) URLs
    const vUrl = execSync(`"${ytdlpPath}" -g -f 136 ${url}`).toString().trim();
    const aUrl = execSync(`"${ytdlpPath}" -g -f 140 ${url}`).toString().trim();
    console.log('Got URLs. Streaming with ffmpeg...');

    const ffmpeg = spawn(ffmpegPath, [
        '-i', vUrl,
        '-i', aUrl,
        '-c', 'copy',
        '-movflags', 'frag_keyframe+empty_moov',
        '-f', 'mp4',
        'pipe:1'
    ]);

    let bytes = 0;
    let started = Date.now();
    ffmpeg.stdout.on('data', d => {
        bytes += d.length;
        if (bytes > 0 && bytes < 10000) {
            console.log(`Time to first byte: ${Date.now() - started}ms. Bytes: ${bytes}`);
        }
    });

    ffmpeg.stderr.on('data', d => {
        // console.log('err:', d.toString());
    });

    ffmpeg.on('close', code => {
        console.log(`Done inline. Total bytes: ${bytes}`);
    });

    setTimeout(() => {
        console.log(`10s check: Streamed ${bytes} bytes so far.`);
        ffmpeg.kill();
    }, 10000);

} catch (e) {
    console.error(e);
}
