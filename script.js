// ============================================================
//  КОНФИГУРАЦИЯ
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyCHr131sI9RwJVzA1JMmv7lt3BMKJw6JQk",
  authDomain: "testvideo-ef426.firebaseapp.com",
  databaseURL: "https://testvideo-ef426-default-rtdb.firebaseio.com",
  projectId: "testvideo-ef426",
  storageBucket: "testvideo-ef426.firebasestorage.app",
  messagingSenderId: "662585422019",
  appId: "1:662585422019:web:013076f9cc5778de14b276"
};

firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// ============================================================
//  СОСТОЯНИЕ
// ============================================================
const myUserId = 'user_' + Math.random().toString(36).substring(2, 9);
let myNickname = "";
let player = null;
let roomRef = null;
let userRef = null; 
let isLeader = false;
let isSyncing = false;
let currentVideoUrl = "";
let syncInterval = null;

// DOM
const nicknameInput = document.getElementById('nickname');
const roomInput = document.getElementById('roomId');
const joinBtn = document.getElementById('joinBtn');
const statusEl = document.getElementById('status');
const playerContainer = document.querySelector('.player-container');
const roleBadge = document.getElementById('roleBadge');
const becomeLeaderBtn = document.getElementById('becomeLeaderBtn');
const syncStatusEl = document.getElementById('syncStatus');
const videoSetup = document.getElementById('videoSetup');
const videoInput = document.getElementById('videoInput');
const setVideoBtn = document.getElementById('setVideoBtn');
const usersListEl = document.getElementById('usersList');
const userCountEl = document.getElementById('userCount');
const blockOverlay = document.getElementById('blockOverlay');

// ============================================================
//  ПАРСИНГ ССЫЛКИ ВК
// ============================================================
function parseVkVideo(input) {
    input = input.trim();
    if (!input) return null;

    if (input.includes('<iframe')) {
        const match = input.match(/src=["'](.*?)["']/);
        if (match) {
            let url = match[1];
            if (!url.includes('js_api=1')) url += (url.includes('?') ? '&' : '?') + 'js_api=1';
            return url;
        }
    }

    const match = input.match(/video(-?\d+)_(\d+)/);
    if (match) {
        return `https://vk.com/video_ext.php?oid=${match[1]}&id=${match[2]}&hd=2&js_api=1`;
    }

    if (input.includes('video_ext.php')) {
        return input.includes('js_api=1') ? input : input + '&js_api=1';
    }

    return null;
}

// ============================================================
//  ЗАГРУЗКА ПЛЕЕРА
// ============================================================
function loadPlayer(videoUrl) {
    if (currentVideoUrl === videoUrl && player) return;
    currentVideoUrl = videoUrl;

    if (player) { try { player.destroy(); } catch(e){} player = null; }
    
    // Очищаем всё, кроме оверлея
    const placeholder = playerContainer.querySelector('.placeholder');
    if (placeholder) placeholder.remove();
    const oldIframe = playerContainer.querySelector('iframe');
    if (oldIframe) oldIframe.remove();

    const iframe = document.createElement('iframe');
    iframe.src = videoUrl;
    iframe.width = "100%";
    iframe.height = "100%";
    iframe.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture;";
    iframe.frameBorder = "0";
    iframe.allowFullscreen = true;
    
    // Вставляем iframe перед оверлеем
    playerContainer.insertBefore(iframe, blockOverlay);

    iframe.addEventListener('load', () => {
        try {
            player = VK.VideoPlayer(iframe);
            player.on('play', onLocalPlay);
            player.on('pause', onLocalPause);
            player.on('seek', onLocalSeek);
            setSyncStatus('Видео загружено. Ожидание действий ведущего.');
        } catch (e) {
            setSyncStatus('Ошибка VK API.');
        }
    });
}

// ============================================================
//  СИНХРОНИЗАЦИЯ И ОТПРАВКА СОСТОЯНИЯ
// ============================================================
function broadcastState(action) {
    if (!roomRef || !isLeader || isSyncing || !player) return;
    
    // VK API getState() возвращает строку: 'playing', 'paused' и т.д.
    const isPlaying = player.getState() === 'playing';
    
    roomRef.child('state').set({
        action: action,
        time: player.getCurrentTime(),
        isPlaying: isPlaying,
        timestamp: Date.now()
    });
}

function onLocalPlay() { broadcastState('play'); }
function onLocalPause() { broadcastState('pause'); }
function onLocalSeek() { broadcastState('seek'); }

function applyRemoteState(state) {
    if (!player || !state || isLeader) return;

    isSyncing = true;
    const localTime = player.getCurrentTime();
    const timeDiff = Math.abs(localTime - state.time);
    const localIsPlaying = player.getState() === 'playing';

    try {
        // 1. Синхронизация времени (если отстали/убежали более чем на 2 секунды)
        // Или если это явная перемотка/пауза
        if (state.action === 'seek' || state.action === 'pause' || timeDiff > 2) {
            player.seek(state.time);
        }

        // 2. Синхронизация Play/Pause
        if (state.isPlaying && !localIsPlaying) {
            player.play();
            setSyncStatus(`▶ Воспроизведение с ${formatTime(state.time)}`);
        } else if (!state.isPlaying && localIsPlaying) {
            player.pause();
            setSyncStatus(`⏸ Пауза на ${formatTime(state.time)}`);
        }
    } catch (e) {
        console.warn("Ошибка синхронизации", e);
    } finally {
        setTimeout(() => { isSyncing = false; }, 500);
    }
}

function formatTime(seconds) {
    if (typeof seconds !== 'number' || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// ============================================================
//  ВХОД В КОМНАТУ
// ============================================================
function joinRoom() {
    myNickname = nicknameInput.value.trim();
    const id = roomInput.value.trim();

    if (!myNickname) return setStatus('Введите ваш ник!', true);
    if (!id) return setStatus('Введите название комнаты!', true);

    if (roomRef) roomRef.off();
    
    roomRef = database.ref(`rooms/${id}`);
    userRef = roomRef.child('users').child(myUserId);
    
    userRef.set({ name: myNickname, joinedAt: firebase.database.ServerValue.TIMESTAMP });
    userRef.onDisconnect().remove();
    roomRef.child('leader').onDisconnect().remove();

    setStatus(`Вы вошли как ${myNickname}`);

    // Список участников
    roomRef.child('users').on('value', (snapshot) => {
        renderUsersList(snapshot.val() || {});
    });

    // Отслеживание роли
    roomRef.child('leader').on('value', (snapshot) => {
        const leaderId = snapshot.val();
        if (leaderId === myUserId) {
            setLeaderUI(true);
            userRef.update({ isLeader: true });
        } else {
            setLeaderUI(false);
            userRef.update({ isLeader: false });
            if (!leaderId) {
                becomeLeaderBtn.style.display = 'inline-block';
                setSyncStatus('Ведущий отключился. Вы можете стать ведущим.');
            }
        }
    });

    // Отслеживание видео
    roomRef.child('videoUrl').on('value', (snap) => {
        const url = snap.val();
        if (url) {
            videoInput.value = url;
            loadPlayer(url);
        }
    });

    // Отслеживание состояния плеера (тайминг и play/pause)
    roomRef.child('state').on('value', (snap) => {
        const state = snap.val();
        if (state) applyRemoteState(state);
    });

    // Запускаем "пульс" для ведущего (каждые 2 секунды)
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(() => {
        if (isLeader && player && player.getState() === 'playing') {
            broadcastState('tick');
        }
    }, 2000);
}

// ============================================================
//  ОТРИСОВКА СПИСКА УЧАСТНИКОВ
// ============================================================
function renderUsersList(users) {
    usersListEl.innerHTML = '';
    const usersArray = Object.keys(users).map(key => ({ id: key, ...users[key] }));
    usersArray.sort((a, b) => (b.isLeader ? 1 : 0) - (a.isLeader ? 1 : 0));
    userCountEl.textContent = usersArray.length;

    usersArray.forEach(user => {
        const li = document.createElement('li');
        li.className = 'user-item';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'user-name';
        if (user.id === myUserId) nameSpan.classList.add('is-me');
        
        nameSpan.textContent = (user.isLeader ? '👑 ' : '👤 ') + user.name;
        li.appendChild(nameSpan);
        usersListEl.appendChild(li);
    });
}

// ============================================================
//  УПРАВЛЕНИЕ ИНТЕРФЕЙСОМ
// ============================================================
setVideoBtn.addEventListener('click', () => {
    if (!roomRef || !isLeader) return;
    const parsedUrl = parseVkVideo(videoInput.value);
    if (!parsedUrl) return alert('Не удалось распознать ссылку.');
    
    roomRef.child('videoUrl').set(parsedUrl).then(() => {
        loadPlayer(parsedUrl);
        // Сбрасываем старое состояние при смене видео
        roomRef.child('state').remove(); 
    });
});

function becomeLeader() {
    if (!roomRef) return;
    roomRef.child('leader').set(myUserId);
}

function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.style.color = isError ? '#f87171' : '#9ca3af';
}

function setSyncStatus(text) { syncStatusEl.textContent = text; }

function setLeaderUI(leader) {
    isLeader = leader;
    if (leader) {
        roleBadge.textContent = '👑 Ведущий';
        roleBadge.classList.add('leader');
        becomeLeaderBtn.style.display = 'none';
        videoSetup.style.display = 'block'; 
        blockOverlay.style.display = 'none'; // Снимаем блокировку с плеера
    } else {
        roleBadge.textContent = '👤 Зритель';
        roleBadge.classList.remove('leader');
        videoSetup.style.display = 'none'; 
        blockOverlay.style.display = 'block'; // Блокируем клики по плееру
        
        roomRef.child('leader').once('value').then(snap => {
            if (!snap.val()) becomeLeaderBtn.style.display = 'inline-block';
        });
    }
}

joinBtn.addEventListener('click', joinRoom);
becomeLeaderBtn.addEventListener('click', becomeLeader);