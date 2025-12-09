// --- Firebase設定 ---

const firebaseConfig = {
  apiKey: "AIzaSyCLvaZbUO45KNW49A0hcEcG0b7GCWef7So",
  authDomain: "pachi-log-d8f45.firebaseapp.com",
  projectId: "pachi-log-d8f45",
  storageBucket: "pachi-log-d8f45.firebasestorage.app",
  messagingSenderId: "1029242934762",
  appId: "1:1029242934762:web:265ee33eadb5854a958e93"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const DOC_ID = 'shared_pachi_data';

// --- DOM要素 ---
const calendarView = document.getElementById('calendar-view');
const analysisView = document.getElementById('analysis-view');
const toggleBtn = document.getElementById('toggle-view-btn');
const rankingList = document.getElementById('ranking-list');
const tabs = document.querySelectorAll('.tab');
const currentMonthEl = document.getElementById('current-month');
const calendarDays = document.getElementById('calendar-days');
const totalBalanceEl = document.getElementById('total-balance');
const modal = document.getElementById('modal');
const form = document.getElementById('record-form');
const dayHistoryList = document.getElementById('day-history-list');
const inputDate = document.getElementById('input-date');
const inputInvest = document.getElementById('input-invest');
const inputRecovery = document.getElementById('input-recovery');
const previewBalance = document.getElementById('preview-balance');

let currentDate = new Date();
let pachiData = [];

// --- 初期化 & イベントリスナー ---
function init() {
    // リアルタイム同期開始
    db.collection('pachidata').doc(DOC_ID).onSnapshot((doc) => {
        pachiData = doc.exists ? (doc.data().list || []) : [];
        renderCalendar();
        if (!modal.classList.contains('hidden')) renderDayHistory(inputDate.value);
        if (!analysisView.classList.contains('hidden')) {
            renderRanking(document.querySelector('.tab.active').dataset.type);
        }
    });

    // 画面切り替え
    toggleBtn.addEventListener('click', () => {
        const isAnalysis = analysisView.classList.contains('hidden');
        calendarView.classList.toggle('hidden', isAnalysis);
        analysisView.classList.toggle('hidden', !isAnalysis);
        toggleBtn.textContent = isAnalysis ? '📅 カレンダーへ' : '📊 分析へ';
        if (isAnalysis) renderRanking('hall');
        else renderCalendar();
    });

    // カレンダー月操作
    document.getElementById('prev-month').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderCalendar();
    });
    document.getElementById('next-month').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        renderCalendar();
    });

    // モーダル操作
    document.getElementById('add-btn').addEventListener('click', () => {
        openModal(new Date().toISOString().split('T')[0]);
    });
    document.getElementById('close-btn').addEventListener('click', () => modal.classList.add('hidden'));

    // 収支プレビュー
    [inputInvest, inputRecovery].forEach(el => {
        el.addEventListener('input', () => {
            const val = Number(inputRecovery.value) - Number(inputInvest.value);
            previewBalance.textContent = val.toLocaleString();
        });
    });

    // 保存処理
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        saveEntry();
    });

    // 分析タブ
    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            tabs.forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            renderRanking(e.target.dataset.type);
        });
    });
}

// --- ロジック関数 ---
function syncToCloud() {
    db.collection('pachidata').doc(DOC_ID).set({
        list: pachiData,
        updatedAt: new Date().toISOString()
    }).catch(err => alert("保存に失敗しました"));
}

function renderCalendar() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    currentMonthEl.textContent = `${year}年 ${month + 1}月`;
    calendarDays.innerHTML = '';

    // 月間収支計算
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const monthTotal = pachiData
        .filter(d => d.date.startsWith(monthPrefix))
        .reduce((sum, d) => sum + d.balance, 0);
    
    totalBalanceEl.textContent = `Total: ¥${monthTotal.toLocaleString()}`;
    totalBalanceEl.className = monthTotal >= 0 ? 'plus' : 'minus';

    // カレンダー生成
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    for (let i = 0; i < firstDay.getDay(); i++) {
        calendarDays.appendChild(document.createElement('div'));
    }

    for (let d = 1; d <= lastDay.getDate(); d++) {
        const dateStr = `${monthPrefix}-${String(d).padStart(2, '0')}`;
        const dayCell = document.createElement('div');
        dayCell.className = 'day-cell' + (dateStr === new Date().toISOString().split('T')[0] ? ' today' : '');
        dayCell.innerHTML = `<div class="date-num">${d}</div>`;

        const dayEntries = pachiData.filter(item => item.date === dateStr);
        if (dayEntries.length > 0) {
            const dayBalance = dayEntries.reduce((sum, item) => sum + item.balance, 0);
            const balanceDiv = document.createElement('div');
            balanceDiv.className = `day-balance ${dayBalance >= 0 ? 'plus' : 'minus'}`;
            balanceDiv.textContent = (dayBalance >= 0 ? '+' : '') + Math.floor(dayBalance / 1000) + 'k';
            dayCell.appendChild(balanceDiv);
        }
        dayCell.addEventListener('click', () => openModal(dateStr));
        calendarDays.appendChild(dayCell);
    }
}

function openModal(dateStr) {
    modal.classList.remove('hidden');
    form.reset();
    inputDate.value = dateStr;
    previewBalance.textContent = "0";
    inputDate.onchange = (e) => renderDayHistory(e.target.value);
    renderDayHistory(dateStr);
}

function saveEntry() {
    const invest = Number(inputInvest.value);
    const recovery = Number(inputRecovery.value);
    pachiData.push({
        id: Date.now(),
        date: inputDate.value,
        rate: document.querySelector('input[name="rate"]:checked').value,
        hall: document.getElementById('input-hall').value,
        machine: document.getElementById('input-machine').value,
        invest: invest,
        recovery: recovery,
        rotation: document.getElementById('input-rotation').value,
        balance: recovery - invest
    });
    syncToCloud();
    form.reset();
    previewBalance.textContent = "0";
    modal.classList.add('hidden');
}

function deleteEntry(id) {
    if (confirm('削除しますか？')) {
        pachiData = pachiData.filter(item => item.id !== id);
        syncToCloud();
    }
}

function renderDayHistory(dateStr) {
    dayHistoryList.innerHTML = '';
    pachiData.filter(d => d.date === dateStr).forEach(item => {
        const li = document.createElement('li');
        li.className = `history-item ${item.balance >= 0 ? 'win' : 'lose'}`;
        li.innerHTML = `
            <div><strong>${item.machine}</strong><br><span style="font-size:0.8rem;color:#666;">${item.hall} (${item.rate})</span></div>
            <div style="text-align:right;">
                <div style="font-weight:bold;">${item.balance > 0 ? '+' : ''}${item.balance.toLocaleString()}</div>
                <button onclick="deleteEntry(${item.id})">削除</button>
            </div>`;
        dayHistoryList.appendChild(li);
    });
}

function renderRanking(type) {
    rankingList.innerHTML = '';
    const stats = {};
    pachiData.forEach(item => {
        const key = type === 'hall' ? item.hall : item.machine;
        if (!key) return;
        if (!stats[key]) stats[key] = { name: key, win: 0, total: 0, balance: 0 };
        stats[key].total++;
        if (item.balance >= 0) stats[key].win++;
        stats[key].balance += item.balance;
    });

    Object.values(stats).sort((a, b) => b.balance - a.balance).forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'rank-item';
        const rankClass = index < 3 ? `rank-${index + 1}` : '';
        li.innerHTML = `
            <div class="rank-pos ${rankClass}">${index + 1}</div>
            <div style="flex:1; margin-left:10px;"><h4>${item.name}</h4><div style="font-size:0.8rem;color:#555;">勝率: ${Math.round((item.win / item.total) * 100)}%</div></div>
            <div style="font-weight:bold; color:${item.balance >= 0 ? '#007bff' : '#dc3545'}">${item.balance > 0 ? '+' : ''}${item.balance.toLocaleString()}</div>`;
        rankingList.appendChild(li);
    });
}

init();
window.deleteEntry = deleteEntry;