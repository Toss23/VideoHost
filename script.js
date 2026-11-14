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
let iframeEl = null;
let roomRef = null;
let userRef = null; 
let isLeader = false;
let isSyncing = false;
let currentVideoUrl = "";
let syncInterval = null;
let lastSeekTime = 0;

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
    if (match) return `https://vk.com/video_ext.php?oid=${match[1]}&id=${match[2]}&hd=2&js_api=1`;
    if (input.includes('video_ext.php')) return input.includes('js_api=1') ? input : input + '&js_api=1';
    return null;
}

// ============================================================
//  ЗАГРУЗКА ПЛЕЕРА
// ============================================================
function loadPlayer(videoUrl) {
    if (currentVideoUrl === videoUrl && player) return;
    currentVideoUrl = videoUrl;

    if (player) { try { player.destroy(); } catch(e){} player = null; }
    const oldIframe = playerContainer.querySelector('iframe');
    if (oldIframe) oldIframe.remove();

    iframeEl = document.createElement('iframe');
    iframeEl.src = videoUrl;
    iframeEl.width = "100%";
    iframeEl.height = "100%";
    iframeEl.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture;";
    iframeEl.frameBorder = "0";
    iframeEl.allowFullscreen = true;
    
    playerContainer.appendChild(iframeEl);

    iframeEl.addEventListener('load', () => {
        try {
            player = VK.VideoPlayer(iframeEl);
            player.on('play', onLocalPlay);
            player.on('pause', onLocalPause);
            player.on('seek', onLocalSeek);
            setSyncStatus('Видео загружено. Ожидание действий ведущего.');
        } catch (e) {
            setSyncStatus('Ошибка VK API. Проверьте ссылку.');
        }
    });
}

// ============================================================
//  СИНХРОНИЗАЦИЯ (ОТПРАВКА)
// ============================================================
function broadcastState(action) {
    if (!roomRef || !isLeader || isSyncing || !player) return;
    
    roomRef.child('state').set({
        action: action,
        time: player.getCurrentTime(),
        isPlaying: player.getState() === 'playing',
        serverTime: firebase.database.ServerValue.TIMESTAMP
    });
}

function onLocalPlay() { broadcastState('play'); }
function onLocalPause() { broadcastState('pause'); }
function onLocalSeek() { broadcastState('seek'); }

// ============================================================
//  СИНХРОНИЗАЦИЯ (ПРИМЕНЕНИЕ У ЗРИТЕЛЕЙ)
// ============================================================
function applyRemoteState(state) {
    if (!player || !state || isLeader) return;

    const localTime = player.getCurrentTime();
    const timeDiff = Math.abs(localTime - state.time);
    const localIsPlaying = player.getState() === 'playing';
    const now = Date.now();

    isSyncing = true;

    try {
        // 1. Жесткая синхронизация Play/Pause
        if (state.isPlaying && !localIsPlaying) {
            player.play();
        } else if (!state.isPlaying && localIsPlaying) {
            player.pause();
        }

        // 2. Синхронизация времени
        if (state.action === 'pause') {
            player.pause();
            player.seek(state.time);
            // Страховка: если плеер ВК решил продолжить игру после seek, насильно ставим на паузу
            setTimeout(() => { if(player && player.getState() === 'playing') player.pause(); }, 250);
            setTimeout(() => { if(player && player.getState() === 'playing') player.pause(); }, 500);
            setSyncStatus(`⏸ Пауза на ${formatTime(state.time)}`);
        } 
        else if (state.action === 'play') {
            let adjustedTime = state.time;
            if (state.serverTime) {
                const networkDelay = (now - state.serverTime) / 1000; 
                if (networkDelay > 0 && networkDelay < 5) adjustedTime += networkDelay;
            }
            player.seek(adjustedTime);
            player.play();
            setSyncStatus(`▶ Воспроизведение`);
        }
        else if (state.action === 'seek') {
            let adjustedTime = state.time;
            if (state.isPlaying && state.serverTime) {
                const networkDelay = (now - state.serverTime) / 1000; 
                if (networkDelay > 0 && networkDelay < 5) adjustedTime += networkDelay;
            }
            player.seek(adjustedTime);
            if (!state.isPlaying) {
                player.pause();
                setTimeout(() => { if(player && player.getState() === 'playing') player.pause(); }, 250);
            }
            setSyncStatus(`⏩ Перемотка`);
        }
        else if (state.action === 'tick') {
            if (state.isPlaying) {
                // Ведущий играет
                if (timeDiff > 3 && now - lastSeekTime > 4000) {
                    let adjustedTime = state.time;
                    if (state.serverTime) {
                        const networkDelay = (now - state.serverTime) / 1000; 
                        if (networkDelay > 0 && networkDelay < 5) adjustedTime += networkDelay;
                    }
                    player.seek(adjustedTime);
                    lastSeekTime = now;
                    setSyncStatus(`⏩ Синхронизация...`);
                }
            } else {
                // Ведущий на паузе
                if (localIsPlaying) player.pause();
                if (timeDiff > 1.5) {
                    player.seek(state.time);
                    setTimeout(() => { if(player && player.getState() === 'playing') player.pause(); }, 250);
                }
                setSyncStatus(`⏸ Пауза`);
            }
        }
    } catch (e) {
        console.warn("Ошибка синхронизации", e);
    } finally {
        setTimeout(() => { isSyncing = false; }, 600);
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

    // Слушаем участников
    roomRef.child('users').on('value', (snapshot) => {
        renderUsersList(snapshot.val() || {});
    });

    // Слушаем ведущего
    roomRef.child('leader').on('value', (snapshot) => {
        const leaderId = snapshot.val();
        if (leaderId === myUserId) {
            setLeaderUI(true);
            userRef.update({ isLeader: true });
        } else {
            setLeaderUI(false);
            userRef.update({ isLeader: false });
            
            if (leaderId) {
                becomeLeaderBtn.style.display = 'none';
                setSyncStatus('Ведущий управляет просмотром.');
            } else {
                becomeLeaderBtn.style.display = 'inline-block';
                setSyncStatus('Ведущий отключился. Вы можете стать ведущим.');
            }
        }
    });

    // Слушаем видео
    roomRef.child('videoUrl').on('value', (snap) => {
        const url = snap.val();
        if (url) {
            videoInput.value = url;
            loadPlayer(url);
        }
    });

    // Слушаем состояние плеера
    roomRef.child('state').on('value', (snap) => {
        const state = snap.val();
        if (state) applyRemoteState(state);
    });

    // Пульс ведущего — отправляется КАЖДУЮ СЕКУНДУ, даже на паузе
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(() => {
        if (isLeader && player) {
            broadcastState('tick');
        }
    }, 1000);
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
//  ДЕЙСТВИЯ И ИНТЕРФЕЙС
// ============================================================
setVideoBtn.addEventListener('click', () => {
    if (!roomRef || !isLeader) return;
    const parsedUrl = parseVkVideo(videoInput.value);
    if (!parsedUrl) return alert('Не удалось распознать ссылку. Вставьте ссылку на видео ВК или iframe.');
    
    roomRef.child('videoUrl').set(parsedUrl).then(() => {
        loadPlayer(parsedUrl);
        roomRef.child('state').remove(); 
    });
});

// Защита от кражи ведущего (Транзакция)
function becomeLeader() {
    if (!roomRef) return;
    
    roomRef.child('leader').transaction(function(currentLeader) {
        if (currentLeader === null) {
            return myUserId;
        }
        return currentLeader; 
    }).then((result) => {
        if (result.committed) {
            if (result.snapshot.val() === myUserId) {
                setSyncStatus('Теперь вы ведущий.');
            } else {
                alert('В комнате уже есть ведущий!');
                becomeLeaderBtn.style.display = 'none';
            }
        }
    });
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
    } else {
        roleBadge.textContent = '👤 Зритель';
        roleBadge.classList.remove('leader');
        videoSetup.style.display = 'none'; 
        
        roomRef.child('leader').once('value').then(snap => {
            if (!snap.val()) becomeLeaderBtn.style.display = 'inline-block';
            else becomeLeaderBtn.style.display = 'none';
        });
    }
}

joinBtn.addEventListener('click', joinRoom);
becomeLeaderBtn.addEventListener('click', becomeLeader);