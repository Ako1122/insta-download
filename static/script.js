
// ============================================================
// Instagram 下載器 - 前端邏輯
// ============================================================

const urlInput = document.getElementById('urlInput');
const parseBtn = document.getElementById('parseBtn');
const loading = document.getElementById('loading');
const errorMsg = document.getElementById('errorMsg');
const resultCard = document.getElementById('resultCard');
const postInfo = document.getElementById('postInfo');
const mediaList = document.getElementById('mediaList');

// 按 Enter 也能觸發解析
urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') parseURL();
});

/**
 * 主要解析函式：送出 Instagram 網址到後端 API
 */
async function parseURL() {
    const url = urlInput.value.trim();

    // 驗證輸入
    if (!url) {
        showError('請輸入 Instagram 網址');
        return;
    }

    if (!url.includes('instagram.com') && !url.includes('instagr.am')) {
        showError('請輸入有效的 Instagram 網址');
        return;
    }

    // 重置 UI
    hideError();
    resultCard.classList.remove('active');
    loading.classList.add('active');
    parseBtn.disabled = true;
    parseBtn.textContent = '解析中...';

    try {
        const response = await fetch('/api/parse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
        });

        const data = await response.json();

        if (data.success) {
            renderResult(data);
        } else {
            showError(data.error || '解析失敗，請稍後再試');
        }
    } catch (err) {
        showError('網路錯誤，請確認伺服器是否正在運行');
    } finally {
        loading.classList.remove('active');
        parseBtn.disabled = false;
        parseBtn.textContent = '解析下載';
    }
}

/**
 * 渲染解析結果
 */
function renderResult(data) {
    // 類型標籤對照
    const typeLabels = {
        video: '🎬 影片',
        image: '🖼️ 圖片',
        carousel: '📸 輪播貼文',
    };

    // 貼文資訊區
    postInfo.innerHTML = `
        ${data.thumbnail
            ? `<img class="thumbnail" src="${escapeHtml(data.thumbnail)}" alt="縮圖" />`
            : ''
        }
        <div class="details">
            <div class="author">${data.author ? '@' + escapeHtml(data.author) : '未知用戶'}</div>
            <div class="caption">${escapeHtml(data.caption || '無說明文字')}</div>
            <div class="meta">
                <span class="tag">${typeLabels[data.type] || data.type}</span>
                <span class="tag">共 ${data.medias.length} 個檔案</span>
            </div>
        </div>
    `;

    // 媒體列表區
    let html = '<h3>可下載的檔案：</h3>';

    data.medias.forEach((media, index) => {
        const isVideo = media.type === 'video';
        const icon = isVideo ? '🎬' : '🖼️';
        const iconClass = isVideo ? 'video' : 'image';
        const label = isVideo ? '影片' : '圖片';
        const ext = isVideo ? 'mp4' : 'jpg';
        const indexLabel = media.index ? ` #${media.index}` : '';

        html += `
            <div class="media-item">
                <div class="info">
                    <div class="icon ${iconClass}">${icon}</div>
                    <div>
                        <div class="label">${label}${indexLabel}</div>
                        <div class="quality">${escapeHtml(media.quality || '原始畫質')}</div>
                    </div>
                </div>
                <a class="btn-download"
                   href="${escapeHtml(media.url)}"
                   target="_blank"
                   download="instagram_${data.shortcode}_${index + 1}.${ext}">
                    下載
                </a>
            </div>
        `;
    });

    mediaList.innerHTML = html;
    resultCard.classList.add('active');

    // 平滑滾動到結果
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * 顯示錯誤訊息
 */
function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.add('active');
}

/**
 * 隱藏錯誤訊息
 */
function hideError() {
    errorMsg.classList.remove('active');
}

/**
 * HTML 跳脫（防止 XSS 攻擊）
 */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

