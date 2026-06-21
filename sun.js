const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3001;
const MAX_HISTORY = 20;
const RECONNECT_DELAY = 3000;
const PING_INTERVAL = 10000;

const WEBSOCKET_URL = "wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.hgrRbSV6vnBwJMg9ZFtbx3rRu9mX_hZMZ_m5gMNhkw0";
const WS_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Origin": "https://play.sun.win"
};

let ws = null;
let pingInterval = null;
let reconnectTimeout = null;
let isConnecting = false;

let currentSessionId = null;
let lastSid = null;
let lastLoggedSession = null;

const patternHistory = [];

// =========================
// LƯU LỊCH SỬ KHÔNG TRÙNG
// =========================
function addToHistory(sessionId, d1, d2, d3, total, result) {
    if (!sessionId) return false;

    const exists = patternHistory.some(x => x.Phien === sessionId);
    if (exists) return false;

    patternHistory.unshift({
        "Phien": sessionId,
        "Xuc_xac_1": d1,
        "Xuc_xac_2": d2,
        "Xuc_xac_3": d3,
        "Tong": total,
        "Ket_qua": result
    });

    if (patternHistory.length > MAX_HISTORY) {
        patternHistory.splice(MAX_HISTORY);
    }

    return true;
}

// =========================
// FORMAT MỖI HÀNG 1 PHIÊN
// =========================
function formatHistoryText(history) {
    if (!history.length) return 'Chưa có dữ liệu';
    return history.map(item => JSON.stringify(item)).join('\n');
}

// =========================
// GÓI KHỞI TẠO
// =========================
const initialMessages = [
    [
        1,
        "MiniGame",
        "GM_apivopnha",
        "WangLin",
        {
            "info": "{\"ipAddress\":\"14.249.227.107\",\"wsToken\":\"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiI5ODE5YW5zc3MiLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50IjpmYWxzZSwicGxheUV2ZW50TG9iYnkiOmZhbHNlLCJjdXN0b21lcklkIjozMjMyODExNTEsImFmZklkIjoic3VuLndpbiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoiZ2VtIiwidGltZXN0YW1wIjoxNzYzMDMyOTI4NzcwLCJsb2NrR2FtZXMiOltdLCJhbW91bnQiOjAsImxvY2tDaGF0IjpmYWxzZSwicGhvbmVWZXJpZmllZCI6ZmFsc2UsImlwQWRkcmVzcyI6IjE0LjI0OS4yMjcuMTA3IiwibXV0ZSI6ZmFsc2UsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8wNS5wbmciLCJwbGF0Zm9ybUlkIjo0LCJ1c2VySWQiOiI4ODM4NTMzZS1kZTQzLTRiOGQtOTUwMy02MjFmNDA1MDUzNGUiLCJyZWdUaW1lIjoxNzYxNjMyMzAwNTc2LCJwaG9uZSI6IiIsImRlcG9zaXQiOmZhbHNlLCJ1c2VybmFtZSI6IkdNX2FwaXZvcG5oYSJ9.guH6ztJSPXUL1cU8QdMz8O1Sdy_SbxjSM-CDzWPTr-0\",\"locale\":\"vi\",\"userId\":\"8838533e-de43-4b8d-9503-621f4050534e\",\"username\":\"GM_apivopnha\",\"timestamp\":1763032928770,\"refreshToken\":\"e576b43a64e84f789548bfc7c4c8d1e5.7d4244a361e345908af95ee2e8ab2895\"}",
            "signature": "45EF4B318C883862C36E1B189A1DF5465EBB60CB602BA05FAD8FCBFCD6E0DA8CB3CE65333EDD79A2BB4ABFCE326ED5525C7D971D9DEDB5A17A72764287FFE6F62CBC2DF8A04CD8EFF8D0D5AE27046947ADE45E62E644111EFDE96A74FEC635A97861A425FF2B5732D74F41176703CA10CFEED67D0745FF15EAC1065E1C8BCBFA"
        }
    ],
    [6, "MiniGame", "taixiuPlugin", { cmd: 1005 }],
    [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }]
];

// =========================
// CONNECT WS
// =========================
function startPing() {
    clearInterval(pingInterval);
    pingInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                ws.ping();
            } catch (e) {}
        }
    }, PING_INTERVAL);
}

function stopPing() {
    clearInterval(pingInterval);
    pingInterval = null;
}

function scheduleReconnect() {
    if (reconnectTimeout || isConnecting) return;

    reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        connectWebSocket();
    }, RECONNECT_DELAY);
}

function connectWebSocket() {
    if (isConnecting) return;
    isConnecting = true;

    if (ws) {
        try {
            ws.removeAllListeners();
            ws.terminate();
        } catch (e) {}
        ws = null;
    }

    ws = new WebSocket(WEBSOCKET_URL, {
        headers: WS_HEADERS,
        perMessageDeflate: false
    });

    ws.on('open', () => {
        isConnecting = false;

        initialMessages.forEach((msg, i) => {
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(msg));
                }
            }, i * 500);
        });

        startPing();
    });

    ws.on('pong', () => {});

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (!Array.isArray(data) || typeof data[1] !== 'object') return;

            const payload = data[1];
            const { cmd, sid, d1, d2, d3, gBB } = payload;

            // sid hiện tại
            if (cmd === 1008 && sid) {
                currentSessionId = sid;
                lastSid = sid;
                return;
            }

            // kết quả phiên
            if (cmd === 1003 && gBB) {
                if (
                    typeof d1 !== 'number' ||
                    typeof d2 !== 'number' ||
                    typeof d3 !== 'number'
                ) return;

                const total = d1 + d2 + d3;
                const result = total > 10 ? 'TAI' : 'XIU';

                let resultSession = null;
                if (currentSessionId) {
                    resultSession = currentSessionId - 1;
                } else if (lastSid) {
                    resultSession = lastSid - 1;
                }

                if (!resultSession) return;
                if (resultSession === lastLoggedSession) return;

                const added = addToHistory(resultSession, d1, d2, d3, total, result);
                if (added) {
                    lastLoggedSession = resultSession;
                    console.log(`Phiên ${resultSession}: [${d1}, ${d2}, ${d3}] = ${total} (${result})`);
                }
            }
        } catch (err) {
            console.log('Lỗi xử lý:', err.message);
        }
    });

    ws.on('close', (code) => {
        isConnecting = false;
        stopPing();

        // 1006 là rớt mạng / server đóng bất ngờ -> reconnect im lặng không in ra console
        if (code !== 1006 && code !== undefined) {
            console.log(`WebSocket closed. Code: ${code}`);
        }

        scheduleReconnect();
    });

    ws.on('error', () => {
        // không spam log, cứ để close tự reconnect
    });
}

// =========================
// API
// =========================

app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(formatHistoryText(patternHistory));
});

app.get('/api/ditmemaysun', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(formatHistoryText(patternHistory));
});

app.get('/history', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(formatHistoryText(patternHistory));
});

// UptimeRobot
app.get('/ping', (req, res) => {
    res.status(200).send('OK');
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'online',
        uptime: process.uptime(),
        timestamp: Date.now()
    });
});

// ==========================================
// CHỈ CHẠY 1 LẦN DUY NHẤT KHI KHỞI ĐỘNG FILE
// ==========================================

app.listen(process.env.PORT || PORT, () => {
    console.log(`Server đang chạy tại cổng ${process.env.PORT || PORT}`);
    connectWebSocket();
});

// Không để Node bị thoát khi lỗi
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});