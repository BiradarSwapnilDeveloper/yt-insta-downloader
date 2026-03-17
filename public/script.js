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

    if (!url) {
        showError('Please paste a YouTube URL');
        return;
    }

    // Basic URL validation
    if (!url.includes('youtube.com') && !url.includes('youtu.be') && !url.includes('instagram.com')) {
        showError('Invalid URL. Only YouTube and Instagram links are supported.');
        return;
    }

    // UI State: Loading
    errorBox.style.display = 'none';
    resultContainer.innerHTML = '';
    loading.style.display = 'block';

    try {
        if (window.location.protocol === 'file:') {
            showError('Please access the site via http://localhost:3000 instead of opening the file directly.');
            return;
        }

        const response = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
        const data = await response.json();

        if (data.error) {
            showError(data.details ? data.error + ' Details: ' + data.details : data.error);
        } else {
            currentVideoInfo = data;
            renderResult(data, url);
        }
    } catch (err) {
        console.error('Fetch error:', err);
        showError('Could not connect to the server. Ensure the backend is running and you are using http://localhost:3000');
    } finally {
        loading.style.display = 'none';
    }
}

function renderResult(data, originalUrl) {
    const container = document.getElementById('result-container');
    
    // Split formats into Video and Audio
    const videoFormats = data.formats.filter(f => f.hasVideo).sort((a,b) => (parseInt(b.resolution) || 0) - (parseInt(a.resolution) || 0));
    const audioFormats = data.formats.filter(f => !f.hasVideo && f.hasAudio);

    container.innerHTML = `
        <div class="glass-card">
            <div class="preview-side">
                <img src="${data.thumbnail}" class="video-thumb" alt="${data.title}">
                <span class="duration-badge">${data.duration}</span>
            </div>
            <div class="info-side">
                <h2>${data.title}</h2>
                <div class="uploader">${data.uploader}</div>
                
                <div class="tabs">
                    <button class="tab-btn active" onclick="switchTab(this, 'video-formats')">Video</button>
                    <button class="tab-btn" onclick="switchTab(this, 'audio-formats')">MP3 / Audio</button>
                </div>

                <div id="video-formats" class="format-list active">
                    <div class="format-grid">
                        ${videoFormats.slice(0, 10).map(f => `
                            <div class="format-item">
                                <div class="fmt-info">
                                    <strong>${f.resolution}</strong>
                                    <span style="color:var(--text-muted); font-size:0.8rem; margin-left:8px;">${f.extension.toUpperCase()}</span>
                                </div>
                                <button class="download-icon-btn" onclick="startDownload('${originalUrl}', '${f.formatId}', '${f.extension}', \`${data.title}\`, ${f.hasAudio}, '${data.urlHash}')">
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
                                <span style="color:var(--text-muted); font-size:0.8rem; margin-left:8px;">320kbps</span>
                            </div>
                            <button class="download-icon-btn" onclick="startAudioDownload('${originalUrl}', \`${data.title}\`, '${data.urlHash}')">
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
    // Buttons
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Content
    document.getElementById('video-formats').style.display = 'none';
    document.getElementById('audio-formats').style.display = 'none';
    document.getElementById(targetId).style.display = 'block';
}

function startDownload(url, formatId, ext, title, hasAudio, urlHash) {
    showToast("Starting Download instantly... Please wait", 3000);
    const downloadUrl = `/api/download?url=${encodeURIComponent(url)}&urlHash=${urlHash}&format=${formatId}&ext=${ext}&title=${encodeURIComponent(title)}&hasAudio=${hasAudio}`;
    window.location.href = downloadUrl;
}

function startAudioDownload(url, title, urlHash) {
    showToast("Processing high-quality MP3 audio... Please wait.", 5000);
    const downloadUrl = `/api/audio?url=${encodeURIComponent(url)}&urlHash=${urlHash}&title=${encodeURIComponent(title)}`;
    window.location.href = downloadUrl;
}

function showToast(message, duration = 4000) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.style.position = 'fixed';
        toast.style.bottom = '20px';
        toast.style.left = '50%';
        toast.style.transform = 'translateX(-50%)';
        toast.style.background = 'rgba(0, 0, 0, 0.8)';
        toast.style.color = 'white';
        toast.style.padding = '12px 24px';
        toast.style.borderRadius = '50px';
        toast.style.zIndex = '10000';
        toast.style.fontFamily = 'inherit';
        toast.style.fontWeight = '500';
        toast.style.boxShadow = '0 10px 30px rgba(0,255,136,0.2)';
        toast.style.border = '1px solid rgba(0, 255, 136, 0.3)';
        toast.style.transition = 'opacity 0.3s ease';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.display = 'block';
    
    // reset opacity immediately in case it's mid-transition
    setTimeout(() => { toast.style.opacity = '1'; }, 10);

    // clear any existing timeout
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
    setTimeout(() => {
        errorBox.style.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
}
