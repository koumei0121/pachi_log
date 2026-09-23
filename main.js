// --- Firebase 設定 ---
const firebaseConfig = {
    apiKey: "AIzaSyDJe4QNGOZy7FHv7BCZglp2aLkt8CpVHhM",
    authDomain: "pachi-log-d8f45.firebaseapp.com",
    projectId: "pachi-log-d8f45",
    storageBucket: "pachi-log-d8f45.firebasestorage.app",
    messagingSenderId: "1029242934762",
    appId: "1:1029242934762:web:265ee33eadb5854a958e93"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// --- DOM 要素 ---
const authBtn = document.getElementById('auth-btn');
const userDisplayName = document.getElementById('user-display-name');
const calendarView = document.getElementById('calendar-view');
const analysisView = document.getElementById('analysis-view');
const toggleBtn = document.getElementById('toggle-view-btn');
const rankingList = document.getElementById('ranking-list');
const chartContainer = document.getElementById('chart-container');
const tabs = document.querySelectorAll('.tab');
const modal = document.getElementById('modal');
const form = document.getElementById('record-form');

// --- アプリ状態変数 ---
let currentDate = new Date();
let pachiData = [];
let editingId = null;
let currentUser = null;
let unsubscribeFirestore = null;
let balanceChart = null;

// --- 共通計算ロジック（プレビューと保存で共有） ---
function getRateConfig(rateValue) {
    if (!rateValue) return { isSlot: false, unit: '円', multiplier: 1 };
    if (rateValue.includes('20円スロ')) return { isSlot: true, unit: '枚', multiplier: 20 };
    if (rateValue.includes('5円スロ')) return { isSlot: true, unit: '枚', multiplier: 5 };
    return { isSlot: false, unit: '円', multiplier: 1 };
}

function calculateMetrics() {
    const rateVal = document.querySelector('input[name="rate"]:checked')?.value || '4円パチ';
    const config = getRateConfig(rateVal);
    
    const invest = Number(document.getElementById('input-invest').value) || 0;
    const recovery = Number(document.getElementById('input-recovery').value) || 0;
    const startRot = Number(document.getElementById('input-start-rot').value) || 0;
    const endRot = Number(document.getElementById('input-end-rot').value) || 0;
    
    const rotation = Math.max(0, endRot - startRot);
    let balanceYen = 0, coinDiff = 0, ratePerUnit = 0;

    if (config.isSlot) {
        coinDiff = recovery - invest;
        balanceYen = coinDiff * config.multiplier;
        if (invest > 0 && rotation > 0) ratePerUnit = (rotation / invest) * 50;
    } else {
        balanceYen = recovery - invest;
        if (invest > 0 && rotation > 0) ratePerUnit = (rotation / invest) * 1000;
    }

    return { 
        config, invest, recovery, startRot, endRot, rotation, 
        balanceYen, coinDiff, ratePerUnit: parseFloat(ratePerUnit.toFixed(1)), rateVal 
    };
}

// --- ラベルと計算結果の画面更新 ---
function updateUI() {
    const metrics = calculateMetrics();
    const { config } = metrics;

    document.getElementById('label-invest').textContent = `投資(${config.unit})`;
    document.getElementById('label-recovery').textContent = `回収(${config.unit})`;
    document.getElementById('label-start-rot').textContent = config.isSlot ? '開始ゲーム' : '開始回転数';
    document.getElementById('label-end-rot').textContent = config.isSlot ? '終了ゲーム' : '終了回転数';
    document.getElementById('label-calc-rot').textContent = config.isSlot ? '総ゲーム数' : '総回転数';
    document.getElementById('label-calc-rate').textContent = config.isSlot ? '50枚ベース' : '1k回転率';
    document.getElementById('label-first-hit').textContent = config.isSlot ? '初当り/ボーナス' : '初当り回数';
    document.getElementById('label-total-hit').textContent = config.isSlot ? 'AT/ART回数' : '総大当り回数';

    document.getElementById('display-calc-rot').textContent = metrics.rotation;
    document.getElementById('display-rate').textContent = metrics.invest > 0 ? `${metrics.ratePerUnit} ${config.isSlot ? 'G' : '/k'}` : (config.isSlot ? '0.0 G' : '0.0 /k');
    document.getElementById('preview-balance').textContent = metrics.balanceYen.toLocaleString();
    document.getElementById('preview-coins').textContent = config.isSlot ? `(${metrics.coinDiff >= 0 ? '+' : ''}${metrics.coinDiff.toLocaleString()} 枚)` : '';
}

// --- 初期化 & イベント登録 ---
function init() {
    authBtn.addEventListener('click', handleAuth);
    auth.onAuthStateChanged(handleAuthStateChanged);

    toggleBtn.addEventListener('click', toggleView);
    document.getElementById('prev-month').addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() - 1); renderCalendar(); });
    document.getElementById('next-month').addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar(); });
    
    document.getElementById('add-btn').addEventListener('click', () => openModal(new Date().toISOString().split('T')[0]));
    document.getElementById('close-btn').addEventListener('click', () => modal.classList.add('hidden'));

    document.getElementById('input-date').addEventListener('change', (e) => renderDayHistory(e.target.value));
    
    // イベント監視（input=文字入力、change=ラジオボタン切替）
    form.addEventListener('input', updateUI);
    form.addEventListener('change', updateUI);
    form.addEventListener('submit', (e) => { e.preventDefault(); saveEntry(); });

    tabs.forEach(tab => tab.addEventListener('click', (e) => {
        tabs.forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        renderCurrentAnalysisTab();
    }));
}

// --- 認証関連 ---
function handleAuth() {
    if (currentUser) {
        auth.signOut().catch(err => alert("エラー: " + err.message));
    } else {
        authBtn.disabled = true;
        authBtn.textContent = 'ログイン中...';
        auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch(err => {
            if (err.code !== 'auth/popup-closed-by-user') alert("エラー: " + err.message);
        }).finally(() => {
            authBtn.disabled = false;
            if (!currentUser) authBtn.textContent = 'Googleログイン';
        });
    }
}

function handleAuthStateChanged(user) {
    if (user) {
        currentUser = user;
        authBtn.textContent = 'ログアウト';
        userDisplayName.textContent = user.displayName ? `${user.displayName} さん` : '';
        subscribeUserData(user.uid);
    } else {
        currentUser = null;
        authBtn.textContent = 'Googleログイン';
        userDisplayName.textContent = '';
        if (unsubscribeFirestore) unsubscribeFirestore();
        pachiData = [];
        renderCalendar();
        renderCurrentAnalysisTab();
    }
}

// --- Firestore処理 ---
function subscribeUserData(uid) {
    if (unsubscribeFirestore) unsubscribeFirestore();
    unsubscribeFirestore = db.collection('pachidata').doc(uid).onSnapshot((doc) => {
        pachiData = doc.exists ? (doc.data().list || []) : [];
        updateDatalists();
        updateQuickChips();
        renderCalendar();
        if (!modal.classList.contains('hidden')) renderDayHistory(document.getElementById('input-date').value);
        if (!analysisView.classList.contains('hidden')) renderCurrentAnalysisTab();
    });
}

function syncToCloud() {
    if (!currentUser) return alert("ログインが必要です。");
    db.collection('pachidata').doc(currentUser.uid).set({
        userId: currentUser.uid,
        list: pachiData,
        updatedAt: new Date().toISOString()
    }).catch(() => alert("保存に失敗しました。"));
}

// --- 候補自動生成（サジェスト＆クイックチップ） ---
function updateDatalists() {
    const hallList = document.getElementById('hall-candidates');
    const machineList = document.getElementById('machine-candidates');
    
    // 安全対策: 要素がない場合は中断
    if (!hallList || !machineList) return; 

    const createOptions = (key) => [...new Set(pachiData.map(d => d[key]).filter(Boolean))].map(v => `<option value="${v}">`).join('');
    hallList.innerHTML = createOptions('hall');
    machineList.innerHTML = createOptions('machine');
}

function updateQuickChips() {
    const getTop3 = (key) => {
        const counts = {};
        pachiData.forEach(d => { if (d[key]) counts[d[key]] = (counts[d[key]] || 0) + 1; });
        return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
    };
    
    const renderChips = (id, targetId, items) => {
        const container = document.getElementById(id);
        const target = document.getElementById(targetId);
        
        // 安全対策
        if (!container || !target) return;
        
        container.innerHTML = '';
        items.forEach(name => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'quick-chip';
            btn.textContent = name;
            btn.onclick = () => { 
                target.value = name; 
                target.focus(); 
                updateUI(); // 自動入力後の表示状態同期
            };
            container.appendChild(btn);
        });
    };

    renderChips('quick-halls', 'input-hall', getTop3('hall'));
    renderChips('quick-machines', 'input-machine', getTop3('machine'));
}

// --- ビュー切り替え ---
function toggleView() {
    const isAnalysis = analysisView.classList.contains('hidden');
    calendarView.classList.toggle('hidden', isAnalysis);
    analysisView.classList.toggle('hidden', !isAnalysis);
    toggleBtn.textContent = isAnalysis ? 'カレンダー表示' : '分析表示';
    if (isAnalysis) renderCurrentAnalysisTab(); else renderCalendar();
}

// --- カレンダー描画 ---
function renderCalendar() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    document.getElementById('current-month').textContent = `${year}年 ${month + 1}月`;
    const calendarDays = document.getElementById('calendar-days');
    calendarDays.innerHTML = '';

    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const monthTotal = pachiData.filter(d => d.date.startsWith(monthPrefix)).reduce((sum, d) => sum + d.balance, 0);
    
    const totalEl = document.getElementById('total-balance');
    totalEl.textContent = `Total: ${monthTotal.toLocaleString()} 円`;
    totalEl.className = monthTotal >= 0 ? 'plus' : 'minus';

    for (let i = 0; i < new Date(year, month, 1).getDay(); i++) {
        calendarDays.appendChild(document.createElement('div'));
    }

    const lastDay = new Date(year, month + 1, 0).getDate();
    for (let d = 1; d <= lastDay; d++) {
        const dateStr = `${monthPrefix}-${String(d).padStart(2, '0')}`;
        const dayCell = document.createElement('div');
        dayCell.className = 'day-cell' + (dateStr === new Date().toISOString().split('T')[0] ? ' today' : '');
        dayCell.innerHTML = `<div class="date-num">${d}</div>`;

        const dayBalance = pachiData.filter(item => item.date === dateStr).reduce((sum, item) => sum + item.balance, 0);
        if (dayBalance !== 0) {
            dayCell.innerHTML += `<div class="day-balance ${dayBalance >= 0 ? 'plus' : 'minus'}">${dayBalance >= 0 ? '+' : ''}${Math.floor(dayBalance / 1000)}k</div>`;
        }
        dayCell.onclick = () => openModal(dateStr);
        calendarDays.appendChild(dayCell);
    }
}

// --- モーダル制御 ---
function openModal(dateStr) {
    modal.classList.remove('hidden');
    editingId = null;
    form.reset();
    document.getElementById('input-date').value = dateStr;
    const defaultRadio = document.querySelector('input[name="rate"][value="4円パチ"]');
    if (defaultRadio) defaultRadio.checked = true;
    
    updateUI();
    updateDatalists();
    updateQuickChips();
    renderDayHistory(dateStr);
}

function startEdit(id) {
    const target = pachiData.find(item => item.id === id);
    if (!target) return;
    editingId = id;
    
    document.getElementById('input-date').value = target.date;
    document.querySelectorAll('input[name="rate"]').forEach(r => {
        if (r.value === target.rate || (target.rate && r.value.startsWith(target.rate))) r.checked = true;
    });

    document.getElementById('input-hall').value = target.hall || '';
    document.getElementById('input-machine').value = target.machine || '';
    document.getElementById('input-invest').value = target.invest || '';
    document.getElementById('input-recovery').value = target.recovery || '';
    document.getElementById('input-start-rot').value = target.startRot || '';
    document.getElementById('input-end-rot').value = target.endRot || '';
    document.getElementById('input-first-hit').value = target.firstHit || '';
    document.getElementById('input-total-hit').value = target.totalHit || '';

    updateUI();
    modal.classList.remove('hidden');
}

function saveEntry() {
    if (!currentUser) return alert("保存するにはGoogleログインが必要です。");

    const metrics = calculateMetrics();
    const entryData = {
        date: document.getElementById('input-date').value,
        rate: metrics.rateVal,
        hall: document.getElementById('input-hall').value,
        machine: document.getElementById('input-machine').value,
        invest: metrics.invest,
        recovery: metrics.recovery,
        balance: metrics.balanceYen,
        startRot: metrics.startRot,
        endRot: metrics.endRot,
        rotation: metrics.rotation,
        ratePerUnit: metrics.ratePerUnit,
        firstHit: document.getElementById('input-first-hit').value || 0,
        totalHit: document.getElementById('input-total-hit').value || 0
    };

    if (editingId) {
        const index = pachiData.findIndex(item => item.id === editingId);
        if (index !== -1) pachiData[index] = { ...entryData, id: editingId };
    } else {
        pachiData.push({ ...entryData, id: Date.now() });
    }

    syncToCloud();
    
    // 保存後の状態リセット
    editingId = null; 
    form.reset();     
    modal.classList.add('hidden');
    
    renderCalendar();
    if (!analysisView.classList.contains('hidden')) renderCurrentAnalysisTab();
}

function deleteEntry(id) {
    if (confirm('削除してもよろしいですか？')) {
        pachiData = pachiData.filter(item => item.id !== id);
        syncToCloud();
    }
}

// --- 履歴表示 ---
function renderDayHistory(dateStr) {
    const list = document.getElementById('day-history-list');
    list.innerHTML = '';
    pachiData.filter(d => d.date === dateStr).forEach(item => {
        const isSlot = item.rate && item.rate.includes('スロ');
        const diff = item.recovery - item.invest;
        const diffUnit = isSlot ? `(${diff >= 0 ? '+' : ''}${diff.toLocaleString()}枚)` : '';
        
        const li = document.createElement('li');
        li.className = `history-item ${item.balance >= 0 ? 'win' : 'lose'}`;
        li.innerHTML = `
            <div>
                <strong>${item.machine}</strong> <span style="font-size:0.75rem; background:#e2e8f0; padding:2px 6px; border-radius:4px;">${item.rate}</span><br>
                <span style="font-size:0.8rem; color:#555;">
                    ${item.hall} <br>
                    投資:${item.invest.toLocaleString()}${isSlot ? '枚' : '円'} / 回収:${item.recovery.toLocaleString()}${isSlot ? '枚' : '円'} ${diffUnit}<br>
                    ${isSlot ? '総G数' : '総回転'}:${item.rotation || 0} / ${isSlot ? '50枚' : '1k'}:${item.ratePerUnit || 0}
                </span>
            </div>
            <div style="text-align:right;">
                <div style="font-weight:bold; margin-bottom:5px;">${item.balance >= 0 ? '+' : ''}${item.balance.toLocaleString()} 円</div>
                <button onclick="startEdit(${item.id})" class="edit-btn">編集</button>
                <button onclick="deleteEntry(${item.id})" class="delete-btn">削除</button>
            </div>`;
        list.appendChild(li);
    });
}

// --- 分析タブ・グラフ処理 ---
function renderCurrentAnalysisTab() {
    const type = document.querySelector('.tab.active')?.dataset.type;
    if (!type) return;

    if (type === 'monthly' || type === 'yearly') {
        rankingList.classList.add('hidden');
        chartContainer.classList.remove('hidden');
        renderBalanceChart(type);
    } else {
        chartContainer.classList.add('hidden');
        rankingList.classList.remove('hidden');
        renderRanking(type);
    }
}

function renderRanking(type) {
    rankingList.innerHTML = '';
    const stats = {};
    pachiData.forEach(item => {
        const key = item[type];
        if (!key) return;
        if (!stats[key]) stats[key] = { name: key, win: 0, total: 0, balance: 0 };
        stats[key].total++;
        if (item.balance >= 0) stats[key].win++;
        stats[key].balance += item.balance;
    });

    Object.values(stats).sort((a, b) => b.balance - a.balance).forEach((item, i) => {
        const li = document.createElement('li');
        li.className = 'rank-item';
        li.innerHTML = `
            <div class="rank-pos ${i < 3 ? 'rank-' + (i + 1) : ''}">${i + 1}</div>
            <div style="flex:1; margin-left:10px;"><h4>${item.name}</h4><div style="font-size:0.8rem;color:#555;">勝率: ${Math.round(item.win/item.total*100)}%</div></div>
            <div style="font-weight:bold; color:${item.balance >= 0 ? '#007bff' : '#dc3545'}">${item.balance >= 0 ? '+' : ''}${item.balance.toLocaleString()} 円</div>`;
        rankingList.appendChild(li);
    });
}

function renderBalanceChart(periodType) {
    const ctx = document.getElementById('balanceChart').getContext('2d');
    const aggregated = {};

    if (periodType === 'monthly') {
        const year = currentDate.getFullYear();
        for (let m = 1; m <= 12; m++) aggregated[`${year}-${String(m).padStart(2, '0')}`] = 0;
        pachiData.forEach(d => { if (aggregated[d.date.substring(0, 7)] !== undefined) aggregated[d.date.substring(0, 7)] += d.balance; });
    } else {
        const thisYear = new Date().getFullYear();
        for (let y = thisYear - 2; y <= thisYear; y++) aggregated[String(y)] = 0;
        pachiData.forEach(d => { aggregated[d.date.substring(0, 4)] = (aggregated[d.date.substring(0, 4)] || 0) + d.balance; });
    }

    const sortedKeys = Object.keys(aggregated).sort();
    const labels = sortedKeys.map(k => periodType === 'monthly' ? `${Number(k.split('-')[1])}月` : `${k}年`);
    const dataVals = sortedKeys.map(k => aggregated[k]);
    const bgColors = dataVals.map(v => v >= 0 ? 'rgba(0, 123, 255, 0.7)' : 'rgba(220, 53, 69, 0.7)');

    if (balanceChart) balanceChart.destroy();
    balanceChart = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ label: '収支 (円)', data: dataVals, backgroundColor: bgColors, borderWidth: 1, borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
}

init();
window.startEdit = startEdit;
window.deleteEntry = deleteEntry;
