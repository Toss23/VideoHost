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

// ============================================================
//  СОСТОЯНИЕ
// ============================================================
let player = null;               // VK.VideoPlayer
let iframeEl = null;            // <iframe> элемент
let roomRef = null;             // ссылка на комнату в Firebase
let roomId = null;              // текущая комната
let isLeader = false;           // является ли текущий пользователь ведущим
let isSyncing = false;          // защита от эхо-синхронизации
let lastRemoteState = null;     // последнее удалённое состояние

// DOM-элементы
const roomInput = document.getElementById('roomId');
const joinBtn = document.getElementById('joinBtn');
const statusEl = document.getElementById('status');
const playerContainer = document.getElementById('playerContainer');
const roleBadge = document.getElementById('roleBadge');
const becomeLeaderBtn = document.getElementById('becomeLeaderBtn');
const syncStatusEl = document.getElementById('syncStatus');

// ============================================================
//  ИНИЦИАЛИЗАЦИЯ FIREBASE
// ============================================================
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// ============================================================
//  ВСТАВКА ПЛЕЕРА VK
// ============================================================
// ВАЖНО: скопируйте iframe-код видео из VK
// (Поделиться → Экспортировать → Код для вставки)
// и добавьте в src параметр &js_api=1
// Пример:
// <iframe src="https://vk.com/video_ext.php?oid=-22822305&id=456241864&hd=2&js_api=1" ...></iframe>
const VK_IFRAME_HTML = `
    <iframe 
        src="https://vk.com/video_ext.php?oid=XXXXXXXX&id=XXXXXXXX&hd=2&js_api=1"
        width="100%" 
        height="100%" 
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture;"
        frameborder="0" 
        allowfullscreen>
    </iframe>
`;

// ============================================================
//  ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================
function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.style.color = isError ? '#f87171' : '#9ca3af';
}

function setSyncStatus(text) {
    syncStatusEl.textContent = text;
}

function setLeaderUI(leader) {
    isLeader = leader;
    if (leader) {
        roleBadge.textContent = '👑 Ведущий';
        roleBadge.classList.add('leader');
        becomeLeaderBtn.style.display = 'none';
    } else {
        roleBadge.textContent = '👤 Зритель';
        roleBadge.classList.remove('leader');
        becomeLeaderBtn.style.display = 'inline-block';
    }
}

// ============================================================
//  ЗАГРУЗКА ПЛЕЕРА
// ============================================================
function createPlayer() {
    playerContainer.innerHTML = VK_IFRAME_HTML;
    iframeEl = playerContainer.querySelector('iframe');

    if (!iframeEl) {
        setStatus('Не удалось загрузить iframe. Проверьте HTML-код.', true);
        return;
    }

    // Ждём загрузки iframe, чтобы VK.VideoPlayer успел инициализироваться
    iframeEl.addEventListener('load', () => {
        try {
            // VK Video Player API требует &js_api=1 в src
            player = VK.VideoPlayer(iframeEl);

            // Подписываемся на события плеера
            player.on('play', onLocalPlay);
            player.on('pause', onLocalPause);
            player.on('seek', onLocalSeek);
            // Некоторые версии API используют 'timeupdate' для перемотки
            player.on('timeupdate', onLocalTimeUpdate);

            setStatus('Плеер VK загружен. Войдите в комнату для синхронизации.');
        } catch (e) {
            console.error('Ошибка инициализации VK.VideoPlayer:', e);
            setStatus('Ошибка VK API. Убедитесь, что в src iframe добавлен &js_api=1', true);
        }
    });
}

// ============================================================
//  ОБРАБОТЧИКИ ЛОКАЛЬНЫХ СОБЫТИЙ ПЛЕЕРА
// ============================================================
function onLocalPlay() {
    if (!roomRef || !isLeader || isSyncing) return;
    roomRef.child('state').set({
        action: 'play',
        time: player.getCurrentTime(),
        timestamp: Date.now()
    });
}

function onLocalPause() {
    if (!roomRef || !isLeader || isSyncing) return;
    roomRef.child('state').set({
        action: 'pause',
        time: player.getCurrentTime(),
        timestamp: Date.now()
    });
}

function onLocalSeek() {
    if (!roomRef || !isLeader || isSyncing) return;
    roomRef.child('state').set({
        action: 'seek',
        time: player.getCurrentTime(),
        timestamp: Date.now()
    });
}

function onLocalTimeUpdate() {
    // Не синхронизируем каждое обновление времени — только явные действия
    // (play/pause/seek). Это предотвращает зацикливание.
}

// ============================================================
//  ПРИМЕНЕНИЕ УДАЛЁННОГО СОСТОЯНИЯ
// ============================================================
function applyRemoteState(state) {
    if (!player || !state || isLeader) return;

    isSyncing = true;

    try {
        switch (state.action) {
            case 'play':
                player.seek(state.time);
                player.play();
                setSyncStatus(`▶ Воспроизведение с ${formatTime(state.time)}`);
                break;
            case 'pause':
                player.pause();
                player.seek(state.time);
                setSyncStatus(`⏸ Пауза на ${formatTime(state.time)}`);
                break;
            case 'seek':
                player.seek(state.time);
                setSyncStatus(`⏩ Перемотка на ${formatTime(state.time)}`);
                break;
            default:
                break;
        }
    } catch (e) {
        console.warn('Ошибка применения удалённого состояния:', e);
    } finally {
        // Снимаем блокировку чуть позже, чтобы избежать эхо-событий
        setTimeout(() => { isSyncing = false; }, 300);
    }
}

function formatTime(seconds) {
    if (typeof seconds !== 'number' || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// ============================================================
//  ПОДКЛЮЧЕНИЕ К КОМНАТЕ
// ============================================================
function joinRoom() {
    const id = roomInput.value.trim();
    if (!id) {
        setStatus('Введите название комнаты', true);
        return;
    }

    // Отключаемся от предыдущей комнаты
    if (roomRef) {
        roomRef.off();
    }

    roomId = id;
    roomRef = database.ref(`rooms/${roomId}`);

    setStatus(`Подключение к комнате «${roomId}»...`);

    // Определяем, есть ли уже ведущий
    roomRef.child('leader').once('value').then((snapshot) => {
        const leader = snapshot.val();
        if (leader) {
            setLeaderUI(false);
            setSyncStatus('В комнате уже есть ведущий. Вы — зритель.');
        } else {
            // Становимся ведущим, если никто не занял
            roomRef.child('leader').set(firebase.database.ServerValue.TIMESTAMP);
            setLeaderUI(true);
            setSyncStatus('Вы стали ведущим этой комнаты.');
        }

        // Слушаем изменения состояния
        roomRef.child('state').on('value', (snap) => {
            const state = snap.val();
            if (!state) return;
            lastRemoteState = state;

            // Применяем только если мы не ведущий
            if (!isLeader) {
                applyRemoteState(state);
            }
        });

        // Слушаем смену ведущего (например, если ведущий отключился)
        roomRef.child('leader').on('value', (snap) => {
            const leaderVal = snap.val();
            if (!leaderVal && !isLeader) {
                // Ведущий ушёл — можно предложить стать ведущим
                becomeLeaderBtn.style.display = 'inline-block';
                setSyncStatus('Ведущий отключился. Вы можете стать ведущим.');
            }
        });

        setStatus(`Вы в комнате «${roomId}»`);
    }).catch((err) => {
        console.error('Ошибка Firebase:', err);
        setStatus('Ошибка подключения к Firebase. Проверьте конфигурацию.', true);
    });
}

// ============================================================
//  СТАТЬ ВЕДУЩИМ
// ============================================================
function becomeLeader() {
    if (!roomRef) {
        setStatus('Сначала войдите в комнату', true);
        return;
    }

    roomRef.child('leader').set(firebase.database.ServerValue.TIMESTAMP)
        .then(() => {
            setLeaderUI(true);
            setSyncStatus('Теперь вы ведущий. Ваши действия синхронизируются.');
        })
        .catch((err) => {
            console.error('Не удалось стать ведущим:', err);
            setStatus('Ошибка при получении прав ведущего', true);
        });
}

// ============================================================
//  ОБРАБОТЧИКИ КНОПОК
// ============================================================
joinBtn.addEventListener('click', joinRoom);

becomeLeaderBtn.addEventListener('click', becomeLeader);

roomInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinRoom();
});

// ============================================================
//  СТАРТ
// ============================================================
createPlayer();