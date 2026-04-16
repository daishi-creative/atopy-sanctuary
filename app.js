// ============================================
// Firebase 初期化
// ============================================
const firebaseConfig = {
    apiKey: "__FIREBASE_API_KEY__",
    authDomain: "atopy-sanctuary.firebaseapp.com",
    projectId: "atopy-sanctuary",
    storageBucket: "atopy-sanctuary.firebasestorage.app",
    messagingSenderId: "64212158956",
    appId: "1:64212158956:web:e7ee30b47b62d76e6e98c9"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ============================================
// XSS 対策: HTML エスケープ
// ============================================
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ============================================
// サイドドロワー
// ============================================
function openDrawer() {
    const drawer = document.getElementById('side-drawer');
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    document.getElementById('drawer-backdrop').classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeDrawer() {
    const drawer = document.getElementById('side-drawer');
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    document.getElementById('drawer-backdrop').classList.remove('open');
    document.body.style.overflow = '';
}

let GLOBAL_VOICES = [];
let currentMode = 'universe';
let activeFilter = null;
let universeInterval = null;
const MAX_CARDS_ON_SCREEN = 15;

// 配置済みカードの位置を記録（重なり回避用）
let placedPositions = [];

// ============================================
// V3: 魂のモデレーション・フィルター
// ============================================
const SENSITIVE_WORDS = ['死ね', '殺す', '死にたい', '自殺', '消えたい', '無理', '嫌だ', 'Fuck', 'fuck', 'FUCK', 'ふぁっく', 'くそ', 'クソ', 'しね', 'SHINE'];
const DRUG_KEYWORDS = ['ステロイド', '脱ステ', '漢方', 'よもぎ', '食事療法', '処方', 'プロトピック', 'コレクチム'];
const RESULT_KEYWORDS = ['治る', '効く', '完治', '改善', '良くなった', '最高', '止まった', '引いた'];
const STRONG_CLAIMS = ['特効薬', '魔法の', '絶対に治る', '完治しました'];

const RECEPTION_MESSAGES = [
    "おめでとうございます。ずっと抱えていたその本音は、今、解放されました。ここから、あなたの新しい治癒が始まります。",
    "解毒完了。あなたが曝け出したその毒は、誰かの救いという薬に変わります。心に灯った希望力を、信じてください。",
    "よく、ここまで一人で耐えてこられましたね。ここは、何をも拒まない聖域。あなたの本音が、治癒の扉を叩きました。",
    "その一言が、これまでの自分を塗り替える。あなたは今、治癒への『希望力』を自らの手で掴み取りました。"
];

// V4.4: 自動タグ付けマッピング
const AUTO_TAG_MAPPING = {
    "食事": ["食事", "ごはん", "自炊", "グルテンフリー", "お菓子", "砂糖", "コーヒー", "野菜"],
    "運動": ["運動", "ジョギング", "ヨガ", "散歩", "ジム", "スポーツ", "筋トレ", "歩く"],
    "睡眠": ["睡眠", "寝る", "熟睡", "不眠", "眠れない", "中途覚醒"],
    "保湿": ["保湿", "クリーム", "ワセリン", "スキンケア", "化粧水", "オイル"],
    "メンタル": ["メンタル", "心", "ストレス", "自律神経", "不安", "マインドフルネス"],
    "脱ステ": ["脱ステ", "ステロイド", "離脱"],
    "視線": ["視線", "見られる", "人目", "他人の目"],
    "温泉": ["温泉", "お風呂", "入浴"],
    "家族": ["家族", "親", "子供", "旦那", "嫁", "遺伝"],
    "仲間": ["仲間", "ここなら", "一人じゃない", "コミュニティ", "ダイシ"]
};

function suggestTags(message) {
    const suggested = new Set();
    const text = message.toLowerCase();
    
    for (const [tag, keywords] of Object.entries(AUTO_TAG_MAPPING)) {
        if (keywords.some(k => text.includes(k.toLowerCase()))) {
            suggested.add(tag);
        }
    }
    
    return suggested.size > 0 ? Array.from(suggested) : ["共感"];
}

function moderateVoice(message) {
    // まず HTML エスケープして XSS を防ぐ
    let sanitized = escapeHtml(message);
    let isSensitive = false;
    let isMedical = false;

    // 1. ピンポイントボカシ（強い言葉のみを<span>で囲む）
    // SENSITIVE_WORDS は通常 HTML 特殊文字を含まないため、エスケープ後も split/join で一致する
    SENSITIVE_WORDS.forEach(word => {
        if (message.includes(word)) {
            isSensitive = true;
            // 伏字処理（死 -> 〇）
            const replacement = word[0] + '〇'.repeat(word.length - 1);
            const spanWrapped = `<span class="word-blur">${replacement}</span>`;
            sanitized = sanitized.split(word).join(spanWrapped);
        }
    });

    // 2. 医療キーワード（文脈判定：手法 × 結果）
    const hasDrug = DRUG_KEYWORDS.some(k => message.includes(k));
    const hasResult = RESULT_KEYWORDS.some(k => message.includes(k));
    const hasStrongClaim = STRONG_CLAIMS.some(k => message.includes(k));

    if ((hasDrug && hasResult) || hasStrongClaim) {
        isMedical = true;
    }

    return {
        sanitized,
        isSensitive,
        isMedical,
        status: isSensitive ? 'pending' : 'approved'
    };
}

function setupFirestoreListener() {
    db.collection('voices')
        .orderBy('createdAt', 'desc')
        .onSnapshot(snapshot => {
            const rawVoices = snapshot.docs.map(docSnap => {
                const data = docSnap.data();
                const mod = moderateVoice(data.message || '');
                const autoTags = suggestTags(data.message || '');
                const finalTags = Array.from(new Set([...(data.tags || []), ...autoTags]));
                return {
                    id: docSnap.id,
                    handle: data.handle || '匿名',
                    message: mod.sanitized,
                    age: data.age || '',
                    gender: data.gender || '',
                    tags: finalTags,
                    type: data.type || 'pain',
                    isMedical: mod.isMedical,
                    isSensitive: mod.isSensitive,
                    status: data.status || mod.status,
                    createdAt: data.createdAt
                };
            });

            GLOBAL_VOICES = rawVoices.filter(v =>
                !/テスト|てすと|test|あいうえお/i.test(v.message) &&
                !/テスト|てすと|test/i.test(v.handle)
            );

            updateCounter();
            setPolarisVoice();

            if (currentMode === 'list') {
                renderListView(activeFilter);
            }

            const adminPanel = document.getElementById('admin-panel');
            if (adminPanel && adminPanel.classList.contains('active')) {
                renderAdminVoices();
            }
        }, error => {
            console.error('Firestore 接続エラー:', error);
        });
}

// ============================================
// 重なり回避ロジック
// ============================================
function findSafePosition(cardWidth, cardHeight) {
    const margin = 30;
    const headerZone = 500;    // デッドゾーン：ヘッダー、バッジ、憲法、北極星をすべて保護（マニフェスト増量に伴い拡張）
    const keywordZone = 220;   // 右側キーワード避け
    const bottomZone = 100;    // 下部UI避け
    
    const maxX = window.innerWidth - cardWidth - keywordZone;
    const maxY = window.innerHeight - cardHeight - bottomZone;
    

    const minX = margin;
    const minY = headerZone;

    // 最大20回試行して重ならない位置を探す
    for (let attempt = 0; attempt < 20; attempt++) {
        const x = minX + Math.random() * (maxX - minX);
        const y = minY + Math.random() * (maxY - minY);
        
        let overlaps = false;
        for (const pos of placedPositions) {
            const dx = Math.abs(x - pos.x);
            const dy = Math.abs(y - pos.y);
            if (dx < (cardWidth + pos.w) / 2 + 40 && dy < (cardHeight + pos.h) / 2 + 30) {
                overlaps = true;
                break;
            }
        }
        
        if (!overlaps) {
            const record = { x, y, w: cardWidth, h: cardHeight, time: Date.now() };
            placedPositions.push(record);
            // 古い記録を削除（30秒以上前のもの）
            placedPositions = placedPositions.filter(p => Date.now() - p.time < 30000);
            return { x, y };
        }
    }
    
    // 全部重なるなら、ランダム配置（古い記録をクリア）
    placedPositions = placedPositions.slice(-5);
    return {
        x: minX + Math.random() * (maxX - minX),
        y: minY + Math.random() * (maxY - minY)
    };
}

// ============================================
// 宇宙モード
// ============================================
function createVoiceCard(data) {
    const card = document.createElement('div');
    const type = data.type || 'pain';
    card.className = `voice-card type-${type}`;
    
    const len = data.message.length;
    let sizeClass = 'default';
    if (len < 15) {
        sizeClass = 'tiny';
        card.classList.add('tiny');
    } else if (len < 30) {
        sizeClass = 'short';
        card.classList.add('short');
    } else if (len > 120) {
        sizeClass = 'long';
        card.classList.add('long');
    } else if (len > 80) {
        sizeClass = 'medium-long';
        card.classList.add('medium-long');
    }

    card.dataset.id = data.id;
    card.dataset.tags = JSON.stringify(data.tags || ["共感"]);
    
    // カードサイズに基づいて安全な位置を取得
    const widthMap = { 'tiny': 160, 'short': 220, 'long': 400, 'medium-long': 340, 'default': 280 };
    const estimatedWidth = widthMap[sizeClass] || 280;
    const estimatedHeight = len < 30 ? 80 : len > 100 ? 200 : 140;
    
    const pos = findSafePosition(estimatedWidth, estimatedHeight);
    card.style.left = `${pos.x}px`;
    card.style.top = `${pos.y}px`;
    
    // 個性的な回転とアニメーション
    const rotation = (Math.random() - 0.5) * 6;
    card.style.transform = `rotate(${rotation}deg)`;
    
    const animDuration = 25 + Math.random() * 20;
    const animDelay = Math.random() * 3;
    card.style.animationDuration = `${animDuration}s`;
    card.style.animationDelay = `${animDelay}s`;

    const ageText = (data.age && data.age !== '??') ? data.age : '';
    const genderText = (data.gender && data.gender !== '??') ? data.gender : '';
    
    // フォントサイズの個性
    const baseFontSize = len < 15 ? 1.05 : len < 30 ? 0.95 : len > 100 ? 0.82 : 0.88;
    const fontVariation = (Math.random() - 0.5) * 0.08;

    card.innerHTML = `
        ${data.isMedical ? '<div class="medical-badge">※体験談</div>' : ''}
        <div class="handle">${escapeHtml(data.handle)}</div>
        <div class="message" style="font-size: ${baseFontSize + fontVariation}rem">
            ${data.message}
        </div>
        <div class="meta" style="${(!ageText && !genderText) ? 'display:none;' : ''}">
            <span>${escapeHtml(ageText)}</span>
            <span>${escapeHtml(genderText)}</span>
        </div>
    `;

    if (data.status === 'pending') {
        card.classList.add('pending');
    }

    // 負荷対策：一定時間後に自動削除（removeInnerTimer も card に紐付けて掴み時にキャンセル可能に）
    let removeInnerTimer = null;
    let removeTimer = setTimeout(() => {
        if (!card.classList.contains('expanded') && !card.classList.contains('resonating')) {
            card.style.transition = 'opacity 2s ease';
            card.style.opacity = '0';
            removeInnerTimer = setTimeout(() => card.remove(), 2000);
        }
    }, 35000 + Math.random() * 15000);

    let startX, startY, dist = 0, isDragging = false;

    card.addEventListener('mousedown', (e) => {
        clearTimeout(removeTimer);
        if (removeInnerTimer) { clearTimeout(removeInnerTimer); removeInnerTimer = null; }
        startX = e.clientX;
        startY = e.clientY;
        dist = 0;
        isDragging = true;
        const rect = card.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const offsetY = e.clientY - rect.top;

        card.style.animation = 'none';
        card.style.transition = 'none';
        card.style.opacity = '1';
        card.style.zIndex = '1000';

        const onMouseMove = (me) => {
            if (!isDragging) return;
            dist = Math.sqrt((me.clientX - startX) ** 2 + (me.clientY - startY) ** 2);
            card.style.top = `${me.clientY - offsetY}px`;
            card.style.left = `${me.clientX - offsetX}px`;
        };

        const onMouseUp = () => {
            isDragging = false;
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            if (dist < 5) handleCardClick(card);
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    });
    
    return card;
}

function handleCardClick(card) {
    document.querySelectorAll('.voice-card.expanded').forEach(c => {
        if (c !== card) c.classList.remove('expanded');
    });
    const wasExpanded = card.classList.contains('expanded');
    card.classList.toggle('expanded');

    if (!wasExpanded) {
        visualizeHighlight(card, 'card');
    }
}

// 負荷対策：画面上のカード数を制限
function enforceCardLimit() {
    const container = document.getElementById('voices-container');
    const cards = container.querySelectorAll('.voice-card');
    if (cards.length > MAX_CARDS_ON_SCREEN) {
        const toRemove = cards.length - MAX_CARDS_ON_SCREEN;
        for (let i = 0; i < toRemove; i++) {
            if (!cards[i].classList.contains('expanded') && !cards[i].classList.contains('resonating')) {
                cards[i].style.transition = 'opacity 1s ease';
                cards[i].style.opacity = '0';
                setTimeout(() => cards[i]?.remove(), 1000);
            }
        }
    }
}

function activateTag(tagName) {
    const voicesContainer = document.getElementById('voices-container');
    const allCards = document.querySelectorAll('.voice-card');
    
    const wasActive = document.querySelector(`.keyword.active`);
    resetHighlights();
    
    if (wasActive && wasActive.innerText.trim() === tagName) return;

    document.querySelectorAll('.keyword').forEach(k => {
        if (k.innerText.trim() === tagName) k.classList.add('active');
    });

    let relatedOnScreen = [], unrelatedOnScreen = [];
    allCards.forEach(card => {
        const cardTags = JSON.parse(card.dataset.tags);
        (cardTags.includes(tagName) ? relatedOnScreen : unrelatedOnScreen).push(card);
    });

    const existingIds = new Set([...allCards].map(c => c.dataset.id));
    const missing = GLOBAL_VOICES.filter(v => v.tags.includes(tagName) && !existingIds.has(String(v.id)));

    missing.slice(0, 8).forEach((v, i) => {
        setTimeout(() => {
            const card = createVoiceCard(v);
            card.classList.add('resonating');
            voicesContainer.appendChild(card);
            requestAnimationFrame(() => {
                card.style.zIndex = '100';
                card.style.borderColor = 'var(--accent-blue)';
                card.style.boxShadow = '0 0 25px var(--accent-glow)';
            });
        }, i * 150);
    });

    relatedOnScreen.forEach(card => {
        card.classList.add('resonating');
        card.style.zIndex = '100';
        card.style.borderColor = 'var(--accent-blue)';
        card.style.boxShadow = '0 0 25px var(--accent-glow)';
        card.style.opacity = '1';
        card.style.animation = 'none';
    });

    unrelatedOnScreen.forEach(card => {
        card.style.opacity = '0.06';
        card.style.borderColor = '';
        card.style.boxShadow = '';
    });
}

function visualizeHighlight(source, type = 'card') {
    let targetTags = type === 'card' 
        ? JSON.parse(source.dataset.tags) 
        : [source.innerText.trim()];

    document.querySelectorAll('.voice-card').forEach(card => {
        const cardTags = JSON.parse(card.dataset.tags);
        const match = targetTags.some(tag => cardTags.includes(tag));
        card.style.opacity = match ? '1' : '0.1';
        card.style.borderColor = match ? 'var(--accent-blue)' : '';
        card.style.boxShadow = match ? '0 0 20px var(--accent-glow)' : '';
    });
}

function resetHighlights() {
    document.querySelectorAll('.voice-card').forEach(card => {
        card.classList.remove('resonating');
        card.style.opacity = '';
        card.style.zIndex = '';
        card.style.borderColor = '';
        card.style.boxShadow = '';
    });
    document.querySelectorAll('.keyword.active').forEach(k => k.classList.remove('active'));
}


// ============================================
// V4: 本音投稿フォームの制御
// ============================================
function initPostForm() {
    const openBtn = document.getElementById('open-post-btn');
    const closeBtn = document.getElementById('close-post-btn');
    const submitBtn = document.getElementById('submit-post-btn');
    const overlay = document.getElementById('post-overlay');

    if (!openBtn || !closeBtn || !submitBtn || !overlay) return;

    openBtn.addEventListener('click', () => {
        overlay.classList.add('active');
        document.getElementById('post-message').focus();
    });

    closeBtn.addEventListener('click', () => {
        overlay.classList.remove('active');
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('active');
    });

    // モード切り替え (V4.2: Twin Stars)
    const typeTabs = document.querySelectorAll('.type-tab');
    const messageArea = document.getElementById('post-message');
    let currentType = 'pain';

    const placeholders = {
        pain: "例：かゆくて眠れない、誰にもわかってもらえない、でも今日は少しだけマシかも...",
        dream: "例：治ったら海に行きたい、白いTシャツを着て笑いたい、世界をもっと楽しみたい..."
    };

    typeTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            typeTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentType = tab.dataset.type;
            messageArea.placeholder = placeholders[currentType];
        });
    });

    submitBtn.addEventListener('click', () => {
        const message = document.getElementById('post-message').value.trim();
        const handle = document.getElementById('post-handle').value.trim();
        const age = document.getElementById('post-age').value;
        const gender = document.getElementById('post-gender').value; // v4.4

        if (!message) {
            document.getElementById("post-message").parentElement.classList.add("is-error");
            return;
        }

        if (!handle) {
            document.getElementById("post-handle").parentElement.classList.add("is-error");
            return;
        }

        // 送信処理（属性を含める）
        handleVoiceSubmission({ message, handle, age, gender, type: currentType });

        // フォームリセット & 閉じる
        document.getElementById('post-message').value = '';
        document.getElementById('post-handle').value = '';
        document.getElementById('post-age').value = '';
        overlay.classList.remove('active');
    });

    // 入力時のエラー解除 (V4.3)
    const inputs = [document.getElementById("post-message"), document.getElementById("post-handle")];
    inputs.forEach(el => {
        el.addEventListener("input", () => {
            el.parentElement.classList.remove("is-error");
        });
    });
}

async function handleVoiceSubmission(data) {
    const autoTags = suggestTags(data.message);
    const modResult = moderateVoice(data.message);

    const voiceData = {
        handle: data.handle || '匿名',
        message: data.message,
        age: data.age || '',
        gender: data.gender || '',
        tags: autoTags,
        type: data.type || 'pain',
        isMedical: modResult.isMedical,
        isSensitive: modResult.isSensitive,
        status: modResult.status,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        await db.collection('voices').add(voiceData);
        const randomMsg = RECEPTION_MESSAGES[Math.floor(Math.random() * RECEPTION_MESSAGES.length)];
        openModal(randomMsg + "<br><br>—— ダイシより");
        triggerSyncPulse();
    } catch (e) {
        console.error('投稿エラー:', e);
        openModal('接続に問題が発生しました。もう一度お試しください。');
    }
}

// ============================================
// 管理画面
// ============================================
const ADMIN_PASSWORD = 'atopy2025';

function openAdminPanel() {
    document.getElementById('admin-login-overlay').classList.add('active');
    setTimeout(() => document.getElementById('admin-password-input').focus(), 100);
}

function checkAdminPassword() {
    const input = document.getElementById('admin-password-input').value;
    if (input !== ADMIN_PASSWORD) {
        document.getElementById('admin-password-input').value = '';
        document.getElementById('admin-password-input').placeholder = 'パスワードが違います';
        return;
    }
    document.getElementById('admin-login-overlay').classList.remove('active');
    document.getElementById('admin-password-input').value = '';
    document.getElementById('admin-panel').classList.add('active');
    renderAdminVoices();
}

function closeAdminPanel() {
    document.getElementById('admin-login-overlay').classList.remove('active');
    document.getElementById('admin-panel').classList.remove('active');
}

function renderAdminVoices() {
    const container = document.getElementById('admin-voice-list');
    container.innerHTML = '<p style="color:var(--text-muted); text-align:center;">読み込み中...</p>';

    db.collection('voices').orderBy('createdAt', 'desc').get().then(snapshot => {
        container.innerHTML = '';
        if (snapshot.empty) {
            container.innerHTML = '<p style="color:var(--text-muted); text-align:center;">データがありません</p>';
            return;
        }
        snapshot.docs.forEach(docSnap => {
            const data = docSnap.data();
            const statusColor = { approved: '#4ade80', rejected: '#f87171', pending: '#fbbf24' }[data.status] || '#fbbf24';
            const createdAt = data.createdAt ? new Date(data.createdAt.seconds * 1000).toLocaleString('ja-JP') : '不明';
            const item = document.createElement('div');
            item.style.cssText = 'border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:1rem;margin-bottom:1rem;background:rgba(255,255,255,0.03);';
            item.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.5rem;">
                    <span style="font-weight:600;color:var(--text-bright);">${escapeHtml(data.handle || '匿名')}</span>
                    <span style="font-size:0.75rem;color:${statusColor};border:1px solid ${statusColor};padding:2px 8px;border-radius:20px;">${escapeHtml(data.status || 'pending')}</span>
                </div>
                <p style="font-size:0.9rem;color:var(--text-muted);margin:0.5rem 0;white-space:pre-wrap;">${escapeHtml(data.message || '')}</p>
                <div style="font-size:0.75rem;color:rgba(255,255,255,0.3);margin-bottom:0.75rem;">${escapeHtml(data.age || '')} ${escapeHtml(data.gender || '')} ／ ${escapeHtml(createdAt)}</div>
                <div style="display:flex;gap:0.5rem;">
                    <button onclick="approveVoice('${docSnap.id}')" style="background:rgba(74,222,128,0.15);color:#4ade80;border:1px solid #4ade80;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:0.8rem;">承認</button>
                    <button onclick="rejectVoice('${docSnap.id}')" style="background:rgba(248,113,113,0.15);color:#f87171;border:1px solid #f87171;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:0.8rem;">却下</button>
                    <button onclick="deleteVoice('${docSnap.id}')" style="background:rgba(100,100,100,0.15);color:rgba(255,255,255,0.4);border:1px solid rgba(255,255,255,0.2);border-radius:6px;padding:4px 12px;cursor:pointer;font-size:0.8rem;">削除</button>
                </div>
            `;
            container.appendChild(item);
        });
    });
}

async function approveVoice(id) {
    try {
        await db.collection('voices').doc(id).update({ status: 'approved' });
        renderAdminVoices();
    } catch (e) {
        alert('承認に失敗しました: ' + e.message);
    }
}

async function rejectVoice(id) {
    try {
        await db.collection('voices').doc(id).update({ status: 'rejected' });
        renderAdminVoices();
    } catch (e) {
        alert('却下に失敗しました: ' + e.message);
    }
}

async function deleteVoice(id) {
    if (!confirm('この投稿を完全に削除しますか？')) return;
    try {
        await db.collection('voices').doc(id).delete();
        renderAdminVoices();
    } catch (e) {
        alert('削除に失敗しました: ' + e.message);
    }
}

async function migrateVoicesJson() {
    if (!confirm('voices.json のデータを Firestore に移行します。重複する場合があります。続けますか？')) return;
    try {
        const response = await fetch('voices.json');
        const voices = await response.json();
        let count = 0;
        for (const v of voices) {
            await db.collection('voices').add({
                handle: v.handle || '匿名',
                message: v.message || '',
                age: v.age || '',
                gender: v.gender || '',
                tags: v.tags || [],
                type: v.type || 'pain',
                isMedical: v.isMedical || false,
                isSensitive: v.isSensitive || false,
                status: v.status || 'approved',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            count++;
        }
        alert(`${count} 件を Firestore に移行しました`);
        renderAdminVoices();
    } catch (e) {
        alert('移行に失敗しました: ' + e.message);
    }
}

function updateCounter() {
    const counter = document.getElementById('total-counter');
    const phaseEl = document.getElementById('phase-progress');
    const approvedCount = GLOBAL_VOICES.filter(v => v.status === 'approved').length;
    const pendingCount = GLOBAL_VOICES.filter(v => v.status === 'pending').length;

    counter.innerHTML = `
        ${approvedCount.toLocaleString()}
        ${pendingCount > 0 ? `<small style="font-size:0.8rem;opacity:0.5;margin-left:8px;">(審査中 ${pendingCount})</small>` : ''}
    `;

    if (phaseEl) {
        const phases = [
            { label: 'Phase 1', target: 100, desc: '孤独の解体・共鳴の発生' },
            { label: 'Phase 2', target: 500, desc: '制度的バグの可視化' },
            { label: 'Phase 3', target: 1000, desc: '行政・政治へのロビー活動' },
            { label: 'Phase 4', target: 10000, desc: '社会パラダイムの変革' }
        ];
        const next = phases.find(p => approvedCount < p.target) || phases[phases.length - 1];
        const remaining = next.target - approvedCount;
        const pct = Math.min(100, Math.round((approvedCount / next.target) * 100));

        phaseEl.innerHTML = `
            <div class="phase-label">${next.label}まで あと <strong>${remaining.toLocaleString()}件</strong></div>
            <div class="phase-bar-wrap">
                <div class="phase-bar" style="width:${pct}%"></div>
            </div>
            <div class="phase-desc">${next.desc}</div>
        `;
    }
}

function openModal(text) {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-text');
    content.innerHTML = text;
    overlay.classList.add('active');
}

function closeModal() {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('active');
}

// ============================================
// V4: 宇宙の調律（ライブ感 & 北極星）
// ============================================
function initV4() {
    // 1. 背景Orbsの初期化（ランダム位置）
    document.querySelectorAll('.presence-orb').forEach(orb => {
        orb.style.left = `${Math.random() * 80}%`;
        orb.style.top = `${Math.random() * 80}%`;
        orb.style.animationDelay = `-${Math.random() * 60}s`;
    });

    // 2. 今日の北極星（レゾナンス・ボイス）の選定
    setPolarisVoice();
}

function setPolarisVoice() {
    const polarisEl = document.getElementById('polaris-voice');
    if (!polarisEl || GLOBAL_VOICES.length === 0) return;

    // 承認済みの声からランダムに選定（型問わず）
    const approved = GLOBAL_VOICES.filter(v => v.status === 'approved');
    if (approved.length === 0) return;

    const target = approved[Math.floor(Math.random() * approved.length)];

    // ボカシタグを除去
    const cleanText = target.message.replace(/<[^>]*>?/gm, '');
    polarisEl.innerText = `「 ${cleanText} 」`;
}

function triggerSyncPulse() {
    const overlay = document.querySelector('.bg-overlay');
    overlay.classList.remove('sync-flash');
    void overlay.offsetWidth; // reflow
    overlay.classList.add('sync-flash');
}

// ============================================
// 一覧モード
// ============================================
function renderListView(filterTag = null) {
    const listScroll = document.getElementById('list-scroll');
    const listCount = document.getElementById('list-count');
    listScroll.innerHTML = '';

    const filtered = filterTag 
        ? GLOBAL_VOICES.filter(v => v.tags.includes(filterTag))
        : GLOBAL_VOICES;

    listCount.innerText = `${filtered.length} 件の声`;

    filtered.forEach(v => {
        const item = document.createElement('div');
        item.className = 'list-item';
        if (v.status === 'pending') item.classList.add('pending');

        const ageText = (v.age && v.age !== '??') ? v.age : '';
        const genderText = (v.gender && v.gender !== '??') ? v.gender : '';
        const tagsHtml = (v.tags || []).map(t => `<span class="tag-label">${escapeHtml(t)}</span>`).join('');

        item.innerHTML = `
            ${v.isMedical ? '<div class="medical-badge" style="position:relative; top:0; right:0; float:right; margin-bottom:5px;">※体験談</div>' : ''}
            <div class="handle">${escapeHtml(v.handle)}</div>
            <div class="message">${v.message}</div>
            <div class="meta" style="${(!ageText && !genderText) ? 'display:none;' : ''}">
                <span>${escapeHtml(ageText)}</span>
                <span>${escapeHtml(genderText)}</span>
            </div>
            <div class="tags">${tagsHtml}</div>
        `;

        item.addEventListener('click', () => toggleListItemExpand(item));
        listScroll.appendChild(item);
    });

    // 省略表示（フェード）を必要なカードだけに付与
    requestAnimationFrame(() => {
        listScroll.querySelectorAll('.list-item').forEach(el => {
            const msg = el.querySelector('.message');
            if (msg && msg.scrollHeight > msg.clientHeight + 1) {
                el.classList.add('is-clamped');
            }
        });
    });
}

function toggleListItemExpand(item) {
    const wasExpanded = item.classList.contains('expanded');
    closeListItemExpand();
    if (!wasExpanded) {
        item.classList.add('expanded');
        let backdrop = document.getElementById('list-item-backdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.id = 'list-item-backdrop';
            backdrop.className = 'list-item-backdrop';
            backdrop.addEventListener('click', closeListItemExpand);
            document.body.appendChild(backdrop);
        }
        requestAnimationFrame(() => backdrop.classList.add('open'));
    }
}

function closeListItemExpand() {
    document.querySelectorAll('.list-item.expanded').forEach(el => el.classList.remove('expanded'));
    const backdrop = document.getElementById('list-item-backdrop');
    if (backdrop) backdrop.classList.remove('open');
}

function openTagOverlay() {
    const overlay = document.getElementById('tag-overlay');
    overlay.style.display = 'flex';
    setTimeout(() => overlay.style.opacity = '1', 10);
    renderTagCloud();
}

function closeTagOverlay() {
    const overlay = document.getElementById('tag-overlay');
    overlay.style.opacity = '0';
    setTimeout(() => overlay.style.display = 'none', 500);
}

function renderTagCloud() {
    const container = document.getElementById('tag-cloud-container');
    container.innerHTML = '';
    
    const allTags = [...new Set(GLOBAL_VOICES.flatMap(v => v.tags))];
    
    allTags.forEach(tag => {
        const btn = document.createElement('span');
        btn.className = `cloud-tag ${activeFilter === tag ? 'active' : ''}`;
        btn.innerText = tag;
        btn.addEventListener('click', () => {
            activeFilter = tag;
            renderListView(tag);
            closeTagOverlay();
            // 一覧のツールバーも更新
            buildListFilter();
        });
        container.appendChild(btn);
    });
}

function buildListFilter() {
    const filterContainer = document.getElementById('list-filter');
    filterContainer.innerHTML = '';

    const allTags = Array.from(new Set(GLOBAL_VOICES.flatMap(v => v.tags))).slice(0, 7); // 主要なタグのみ表示
    
    // 「すべて」ボタン
    const allBtn = document.createElement('span');
    allBtn.className = `filter-tag ${!activeFilter ? 'active' : ''}`;
    allBtn.innerText = 'すべて';
    allBtn.addEventListener('click', () => {
        activeFilter = null;
        renderListView(null);
        buildListFilter();
    });
    filterContainer.appendChild(allBtn);

    allTags.forEach(tag => {
        const btn = document.createElement('span');
        btn.className = `filter-tag ${activeFilter === tag ? 'active' : ''}`;
        btn.innerText = tag;
        btn.addEventListener('click', () => {
            activeFilter = tag;
            renderListView(tag);
            buildListFilter();
        });
        filterContainer.appendChild(btn);
    });

    // 「もっと見る / タグ検索」ボタン（V4.4: 絵文字を削除し品格を向上）
    const moreBtn = document.createElement('button');
    moreBtn.className = 'tag-menu-btn';
    moreBtn.innerText = 'カテゴリーを選択';
    moreBtn.style.marginLeft = '0.5rem';
    moreBtn.addEventListener('click', openTagOverlay);
    filterContainer.appendChild(moreBtn);
}

function switchMode(mode) {
    currentMode = mode;
    const voicesContainer = document.getElementById('voices-container');
    const listView = document.getElementById('list-view');

    document.body.classList.toggle('list-mode', mode === 'list'); // bodyにクラスを付与してCSSで一括制御

    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    if (mode === 'universe') {
        voicesContainer.style.display = '';
        listView.classList.add('hidden');
        // 古いカードを一掃してから再投入（透明化バグ対策）
        voicesContainer.innerHTML = '';
        const approved = GLOBAL_VOICES.filter(v => v.status === 'approved');
        approved.forEach((voice, i) => {
            setTimeout(() => {
                voicesContainer.appendChild(createVoiceCard(voice));
            }, i * 250);
        });
        startUniverseLoop();
    } else {
        voicesContainer.style.display = 'none';
        listView.classList.remove('hidden');
        stopUniverseLoop();
        buildListFilter();
        renderListView(activeFilter);
    }
}

function startUniverseLoop() {
    if (universeInterval) return;
    let index = 0;
    universeInterval = setInterval(() => {
        const voicesContainer = document.getElementById('voices-container');
        const approved = GLOBAL_VOICES.filter(v => v.status === 'approved');
        if (approved.length === 0) return;
        const displayedIds = new Set([...voicesContainer.querySelectorAll('.voice-card')].map(c => c.dataset.id));
        const available = approved.filter(v => !displayedIds.has(String(v.id)));
        if (available.length === 0) return;
        const voice = available[index % available.length];
        voicesContainer.appendChild(createVoiceCard(voice));
        enforceCardLimit();
        index++;
    }, 6000);
}

function stopUniverseLoop() {
    if (universeInterval) {
        clearInterval(universeInterval);
        universeInterval = null;
    }
}

async function init() {
    const voicesContainer = document.getElementById('voices-container');

    // Firestore リアルタイムリスナーを設定
    setupFirestoreListener();
    initV4();

    // 初期データが届くまで待機
    await new Promise(resolve => setTimeout(resolve, 900));

    // 初期バースト：承認済みを1件ずつ表示（重複なし）
    const approved = GLOBAL_VOICES.filter(v => v.status === 'approved');
    if (approved.length > 0) {
        approved.forEach((voice, i) => {
            setTimeout(() => {
                voicesContainer.appendChild(createVoiceCard(voice));
            }, i * 350);
        });
        startUniverseLoop();
    }

    // モード切替ボタン
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => switchMode(btn.dataset.mode));
    });

    // 宇宙空間クリックでリセット（キーワード・ボタン以外のクリック）
    document.body.addEventListener('mousedown', (e) => {
        const target = e.target;
        if (target.classList.contains('keyword') ||
            target.classList.contains('mode-btn') ||
            target.classList.contains('simulate-btn') ||
            target.closest('.keyword') ||
            target.closest('.mode-btn') ||
            target.closest('.simulate-btn')) {
            return;
        }
        resetHighlights();
    });

    initPostForm();

    // ESC キーで各種オーバーレイを閉じる
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const drawer = document.getElementById('side-drawer');
        if (drawer && drawer.classList.contains('open')) {
            closeDrawer();
            return;
        }
        const modal = document.getElementById('modal-overlay');
        if (modal && modal.classList.contains('active')) {
            closeModal();
            return;
        }
        const postOverlay = document.getElementById('post-overlay');
        if (postOverlay && postOverlay.classList.contains('active')) {
            postOverlay.classList.remove('active');
            return;
        }
        if (document.querySelector('.list-item.expanded')) {
            closeListItemExpand();
            return;
        }
    });

    // モバイルは常に一覧モード
    const urlParams = new URLSearchParams(window.location.search);
    if (window.innerWidth <= 768) {
        switchMode('list');
    } else if (urlParams.get('view') === 'list' || window.location.hash === '#list') {
        switchMode('list');
    }
    if (urlParams.has('admin')) {
        openAdminPanel();
    }
}

document.addEventListener('DOMContentLoaded', init);
