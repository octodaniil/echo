# Echo

Голосовой чат с трансляциями для своей компании: голосовые каналы, демонстрация экрана или игры в высоком качестве со звуком. Без лишнего.

## Структура

```
server/
  api/      Echo API: инвайты, пользователи, каналы, пропуски в голосовые комнаты (Node.js + SQLite)
  deploy/   Docker Compose: Caddy (HTTPS), LiveKit (голос/видео), API, обновление DuckDNS
client/     Windows-клиент (будет)
```

## Как это работает

```
 Echo (Windows) ──HTTPS/WSS :8443──▶ Caddy ──/api──▶ Echo API ──▶ SQLite
        │                              └────/rtc──▶ LiveKit
        └──────────UDP 50000-50100 / TCP 7881──────▶ LiveKit (медиа)
```

- **LiveKit** — медиасервер (SFU). Ничего не перекодирует, только пересылает пакеты, поэтому почти не грузит процессор и добавляет минимальную задержку.
- **Echo API** выдаёт клиенту пропуск (JWT) в комнату канала и рассылает всем через Server-Sent Events, кто в каком канале сидит.
- **Caddy** сам получает и продлевает HTTPS-сертификат Let's Encrypt. Порт 443 на сервере занят, поэтому всё работает на **8443**.

## Установка сервера (Ubuntu)

Порты, которые нужно пробросить на роутере на сервер:

| Порт | Протокол | Зачем |
|---|---|---|
| 80 | TCP | получение сертификата |
| 8443 | TCP | вход в Echo |
| 7881 | TCP | медиа, если UDP недоступен |
| 50000–50100 | UDP | голос и видео |

```bash
git clone https://github.com/octodaniil/echo.git
cd echo/server/deploy
sudo ./install.sh            # поставит Docker и создаст .env
nano .env                    # вписать DUCKDNS_TOKEN
sudo ./install.sh            # запустит всё
```

Проверка:

```bash
curl https://echo-voice.duckdns.org:8443/api/health
```

Первый инвайт для себя (станешь админом):

```bash
sudo ./admin.sh invite --admin
```

### Администрирование

```bash
sudo ./admin.sh invite                 # многоразовый инвайт для друзей
sudo ./admin.sh invite --uses 1 --hours 24
sudo ./admin.sh invites
sudo ./admin.sh users
sudo ./admin.sh kick <ник>
```

### Обновление

```bash
cd echo && git pull && cd server/deploy && sudo ./install.sh
```

### Логи

```bash
cd echo/server/deploy
sudo docker compose logs -f api
sudo docker compose logs -f livekit
sudo docker compose logs caddy duckdns
```

## API

Все запросы, кроме `join` и `health`, требуют `Authorization: Bearer <token>`.

| Метод | Путь | |
|---|---|---|
| GET | `/api/health` | |
| POST | `/api/auth/join` | `{invite, nickname}` → `{token, user}` |
| GET | `/api/me` | |
| GET | `/api/channels` | каналы и кто в них сидит |
| GET | `/api/events` | SSE: `channels` (снимок при любом изменении), `kicked` |
| POST | `/api/channels/:id/connect` | → `{url, room, token}` для LiveKit |
| POST/PATCH/DELETE | `/api/channels[/:id]` | админ |
| GET/POST/DELETE | `/api/invites[/:code]` | админ |
| GET/DELETE | `/api/users[/:id]` | админ |

## Локальная разработка API

```bash
cd server/api
npm install
# .env: LIVEKIT_API_KEY=echo, LIVEKIT_API_SECRET=..., LIVEKIT_PUBLIC_URL=wss://localhost:8443
npm run dev
npm run typecheck
```

Нужен Node.js 24+ (TypeScript запускается напрямую, без сборки).
