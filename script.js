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
// Генерируем уникальный ID для текущей сессии (сохраняется в памяти до перезагрузки)
const myUserId = 'user_' + Math.random().toString(36).substring(2, 9);
let myNickname = "";
let player = null;
let roomRef = null;
let userRef = null; // Ссылка на нашего пользователя в Firebase
let isLeader = false;
let isSyncing = false;
let currentVideoUrl = "";

// DOM
const nicknameInput = document.getElementById('nickname');
const roomInput = document.getElementById('roomId');
const joinBtn = document.getElementById('joinBtn');
const statusEl = document.getElementById('status');
const playerContainer = document.getElementById('playerContainer');
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
    playerContainer.innerHTML = '';

    playerContainer.innerHTML = `
        <iframe src="${videoUrl}" width="100%" height="100%"
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture;"
            frameborder="0" allowfullscreen></iframe>
    `;
    const iframeEl = playerContainer.querySelector('iframe');

    iframeEl.addEventListener('load', () => {
        try {
            player = VK.VideoPlayer(iframeEl);
            player.on('play', onLocalPlay);
            player.on('pause', onLocalPause);
            player.on('seek', onLocalSeek);
            setSyncStatus('Видео загружено. Ожидание действий.');
        } catch (e) {
            setSyncStatus('Ошибка VK API.');
        }
    });
}

// ============================================================
//  ОБРАБОТЧИКИ ПЛЕЕРА
// ============================================================
function onLocalPlay() {
    if (!roomRef || !isLeader || isSyncing) return;
    roomRef.child('state').set({ action: 'play', time: player.getCurrentTime(), timestamp: Date.now() });
}
function onLocalPause() {
    if (!roomRef || !isLeader || isSyncing) return;
    roomRef.child('state').set({ action: 'pause', time: player.getCurrentTime(), timestamp: Date.now() });
}
function onLocalSeek() {
    if (!roomRef || !isLeader || isSyncing) return;
    roomRef.child('state').set({ action: 'seek', time: player.getCurrentTime(), timestamp: Date.now() });
}

function applyRemoteState(state) {
    if (!player || !state || isLeader) return;
    isSyncing = true;
    try {
        if (state.action === 'play') { player.seek(state.time); player.play(); }
        else if (state.action === 'pause') { player.pause(); player.seek(state.time); }
        else if (state.action === 'seek') { player.seek(state.time); }
    } catch (e) {}
    finally { setTimeout(() => { isSyncing = false; }, 300); }
}

// ============================================================
//  ВХОД В КОМНАТУ И СИСТЕМА ПРИСУТСТВИЯ
// ============================================================
function joinRoom() {
    myNickname = nicknameInput.value.trim();
    const id = roomInput.value.trim();

    if (!myNickname) return setStatus('Введите ваш ник!', true);
    if (!id) return setStatus('Введите название комнаты!', true);

    if (roomRef) roomRef.off();
    
    roomRef = database.ref(`rooms/${id}`);
    userRef = roomRef.child('users').child(myUserId);
    
    // Регистрируем пользователя в комнате
    userRef.set({
        name: myNickname,
        joinedAt: firebase.database.ServerValue.TIMESTAMP
    });

    // Когда вкладка закрывается — удаляем пользователя из базы
    userRef.onDisconnect().remove();

    // Очищаем права ведущего при выходе, если мы были ведущим
    roomRef.child('leader').onDisconnect().remove();

    setStatus(`Вы вошли как ${myNickname}`);

    // --- Слушаем список участников ---
    roomRef.child('users').on('value', (snapshot) => {
        const users = snapshot.val() || {};
        renderUsersList(users);
    });

    // --- Слушаем ведущего ---
    roomRef.child('leader').on('value', (snapshot) => {
        const leaderId = snapshot.val();
        
        if (leaderId === myUserId) {
            setLeaderUI(true);
            // Обновляем статус в списке
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

    // --- Слушаем видео-ссылку ---
    roomRef.child('videoUrl').on('value', (snap) => {
        const url = snap.val();
        if (url) {
            videoInput.value = url;
            loadPlayer(url);
            videoSetup.style.display = 'none'; // Скрываем ввод, если видео уже есть
        } else {
            videoSetup.style.display = 'block';
        }
    });

    // --- Слушаем состояние плеера ---
    roomRef.child('state').on('value', (snap) => {
        const state = snap.val();
        if (state) applyRemoteState(state);
    });
}

// ============================================================
//  ОТРИСОВКА СПИСКА УЧАСТНИКОВ
// ============================================================
function renderUsersList(users) {
    usersListEl.innerHTML = '';
    
    // Превращаем объект в массив и сортируем (сначала ведущие)
    const usersArray = Object.keys(users).map(key => ({ id: key, ...users[key] }));
    usersArray.sort((a, b) => (b.isLeader ? 1 : 0) - (a.isLeader ? 1 : 0));

    userCountEl.textContent = usersArray.length;

    usersArray.forEach(user => {
        const li = document.createElement('li');
        li.className = 'user-item';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'user-name';
        if (user.id === myUserId) nameSpan.classList.add('is-me');
        
        // Корона для ведущего, иконка для остальных
        const icon = user.isLeader ? '👑 ' : '👤 ';
        nameSpan.textContent = icon + user.name;

        li.appendChild(nameSpan);
        usersListEl.appendChild(li);
    });
}

// ============================================================
//  КНОПКИ И ДЕЙСТВИЯ
// ============================================================
setVideoBtn.addEventListener('click', () => {
    if (!roomRef) return;
    const parsedUrl = parseVkVideo(videoInput.value);
    if (!parsedUrl) {
        alert('Не удалось распознать ссылку.');
        return;
    }
    roomRef.child('videoUrl').set(parsedUrl).then(() => {
        loadPlayer(parsedUrl);
        videoSetup.style.display = 'none';
    });
});

function becomeLeader() {
    if (!roomRef) return;
    roomRef.child('leader').set(myUserId).then(() => {
        setSyncStatus('Теперь вы ведущий.');
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
    } else {
        roleBadge.textContent = '👤 Зритель';
        roleBadge.classList.remove('leader');
        // Кнопка покажется, только если ведущего нет
        roomRef.child('leader').once('value').then(snap => {
            if (!snap.val()) becomeLeaderBtn.style.display = 'inline-block';
        });
    }
}

joinBtn.addEventListener('click', joinRoom);
becomeLeaderBtn.addEventListener('click', becomeLeader);