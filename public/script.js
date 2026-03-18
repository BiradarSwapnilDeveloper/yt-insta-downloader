document.getElementById('fetch-btn').addEventListener('click', fetchVideoInfo);
document.getElementById('url-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') fetchVideoInfo();
});

let currentVideoInfo = null;

async function fetchVideoInfo() {
    const url = document.getElementById('url-input').value.trim();
    const errorBox = document.getElementById('error-box');
    const loading = document.getElementById('loading');
    const resultContainer = document.getElementById('result-container');

    if (!url) { showError('Please paste a YouTube or Instagram URL'); return; }
    if (!url.includes('youtube.com') && !url.includes('youtu.be') && !url.includes('instagram.com')) {
        showError('Invalid URL. Only YouTube and Instagram links are supported.');
        return;
    }

    errorBox.style.display = 'none';
    resultContainer.innerHTML = '';
    loading.style.display = 'block';

    try {
        if (window.location.protocol === 'file:') {
            showError('Please access via http://localhost:3000');
            return;
        }

        const response = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
        const data = await response.json();

        if (data.error) {
            showError(data.error);
        } else {
            currentVideoInfo = data;
            renderResult(data, url);
        }
    } catch (err) {
        showError('Cannot connect to server. Make sure http://localhost:3000 is running.');
    } finally {
        loading.style.display = 'none';
    }
}

function renderResult(data, originalUrl) {
    const container = document.getElementById('result-container');

    // ---- QUALITY OPTIONS ----
    // Fixed quality list with yt-dlp format selectors
    const isInstagram = originalUrl.includes('instagram.com');

    const videoQualities = isInstagram
        ? [
            { label: 'Best Quality', fmt: 'best', ext: 'mp4' }
          ]
        : [
            { label: '1080p HD',  fmt: 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]', ext: 'mp4' },
            { label: '720p HD',   fmt: 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]',   ext: 'mp4' },
            { label: '480p',      fmt: 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]',   ext: 'mp4' },
            { label: '360p',      fmt: 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360]',   ext: 'mp4' },
            { label: '144p',      fmt: 'bestvideo[height<=144][ext=mp4]+bestaudio[ext=m4a]/best[height<=144]',   ext: 'mp4' },
          ];

    container.innerHTML = `
        <div class="glass-card">
            <div class="preview-side">
                <img src="${data.thumbnail}" class="video-thumb" alt="${data.title || 'Video'}">
                <span class="duration-badge">${data.duration || ''}</span>
            </div>
            <div class="info-side">
                <h2>${data.title || 'Untitled'}</h2>
                <div class="uploader">${data.uploader || ''}</div>

                <div class="tabs">
                    <button class="tab-btn active" onclick="switchTab(this, 'video-formats')">Video</button>
                    <button class="tab-btn" onclick="switchTab(this, 'audio-formats')">MP3 / Audio</button>
                </div>

                <div id="video-formats" class="format-list active">
                    <div class="format-grid">
                        ${videoQualities.map(q => `
                            <div class="format-item">
                                <div class="fmt-info">
                                    <strong>${q.label}</strong>
                                    <span style="color:var(--text-muted);font-size:0.8rem;margin-left:8px;">MP4</span>
                                </div>
                                <button class="download-icon-btn" onclick="startDownload('${originalUrl}', '${encodeURIComponent(q.fmt)}', '${q.ext}', \`${data.title || 'video'}\`, '${data.urlHash || ''}')">
                                    <i class="fas fa-download"></i>
                                </button>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div id="audio-formats" class="format-list" style="display:none">
                    <div class="format-grid">
                        <div class="format-item">
                            <div class="fmt-info">
                                <strong>High Quality MP3</strong>
                                <span style="color:var(--text-muted);font-size:0.8rem;margin-left:8px;">320kbps</span>
                            </div>
                            <button class="download-icon-btn" onclick="startAudioDownload('${originalUrl}', \`${data.title || 'audio'}\`, '${data.urlHash || ''}')">
                                <i class="fas fa-music"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function switchTab(btn, targetId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('video-formats').style.display = 'none';
    document.getElementById('audio-formats').style.display = 'none';
    document.getElementById(targetId).style.display = 'block';
}

function startDownload(url, format, ext, title, urlHash) {
    showToast('Starting download... Please wait', 4000);
    const decodedFormat = decodeURIComponent(format);
    const downloadUrl = `/api/download?url=${encodeURIComponent(url)}&urlHash=${urlHash}&format=${encodeURIComponent(decodedFormat)}&ext=${ext}&title=${encodeURIComponent(title)}&hasAudio=true`;
    window.location.href = downloadUrl;
}

function startAudioDownload(url, title, urlHash) {
    showToast('Processing MP3 audio... Please wait.', 6000);
    window.location.href = `/api/audio?url=${encodeURIComponent(url)}&urlHash=${urlHash}&title=${encodeURIComponent(title)}`;
}

function showToast(message, duration = 4000) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        Object.assign(toast.style, {
            position: 'fixed', bottom: '20px', left: '50%',
            transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.85)',
            color: 'white', padding: '12px 24px', borderRadius: '50px',
            zIndex: '10000', fontFamily: 'inherit', fontWeight: '500',
            boxShadow: '0 10px 30px rgba(0,255,136,0.2)',
            border: '1px solid rgba(0,255,136,0.3)', transition: 'opacity 0.3s ease'
        });
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.display = 'block';
    toast.style.opacity = '1';
    if (toast.hideTimeout) clearTimeout(toast.hideTimeout);
    toast.hideTimeout = setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.style.display = 'none', 300);
    }, duration);
}

function showError(msg) {
    const errorBox = document.getElementById('error-box');
    errorBox.textContent = msg;
    errorBox.style.display = 'block';
}
