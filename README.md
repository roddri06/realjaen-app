# ⚽ Real Jaén CF — App + Backend API

Sistema completo: backend Node.js con datos reales + app web/PWA.

---

## 🚀 PUESTA EN MARCHA (5 minutos)

### 1. Instalar dependencias

```bash
cd realjaen-backend
npm install
```

### 2. Configurar API-Football (OPCIONAL pero recomendado)

Regístrate GRATIS en: https://rapidapi.com/api-sports/api/api-football  
Plan gratuito: **100 peticiones/día** — suficiente para uso normal.

```bash
# Linux / Mac
export API_FOOTBALL_KEY="tu_clave_aqui"

# Windows (CMD)
set API_FOOTBALL_KEY=tu_clave_aqui

# Windows (PowerShell)
$env:API_FOOTBALL_KEY="tu_clave_aqui"
```

**IDs del Real Jaén en API-Football:**
- `team_id = 12486`
- `league_id = 546` (2ª RFEF)
- `season = 2024`

### 3. Iniciar el backend

```bash
npm start
# O en modo desarrollo (auto-recarga):
npm run dev
```

El servidor arranca en: **http://localhost:3000**

### 4. Abrir la app

Abre `real_jaen_app.html` en tu navegador.  
La app detecta automáticamente el backend en `localhost:3000`.

---

## 📡 ENDPOINTS DE LA API

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/status` | Estado del servidor |
| GET | `/api/matches/upcoming` | Próximos partidos |
| GET | `/api/matches/results` | Resultados recientes |
| GET | `/api/matches/live` | Partidos en directo |
| GET | `/api/matches/:id` | Detalle completo |
| GET | `/api/standings` | Clasificación |
| GET | `/api/team` | Datos del equipo |
| POST | `/api/cache/clear` | Limpiar caché |

### Ejemplos de respuesta

```bash
# Próximo partido
curl http://localhost:3000/api/matches/upcoming

# Partido en vivo
curl http://localhost:3000/api/matches/live

# Clasificación
curl http://localhost:3000/api/standings
```

---

## 🔄 SISTEMA DE DATOS

```
┌─────────────────────────────────────────────┐
│              FLUJO DE DATOS                  │
│                                              │
│  API-Football ──▶ Normalizar ──▶ Caché       │
│      ↓ (si falla)                            │
│  Scraping Flashscore ──▶ Parsear ──▶ Caché  │
│      ↓ (si falla)                            │
│  Datos estáticos actualizados                │
│                                              │
│  Auto-refresh:                               │
│  • Live:       cada 60 segundos              │
│  • Upcoming:   cada 5 minutos                │
│  • Results:    cada 10 minutos               │
│  • Standings:  cada 30 minutos               │
└─────────────────────────────────────────────┘
```

---

## 🔧 CONFIGURACIÓN AVANZADA

Edita `server.js`, sección `CONFIG`:

```javascript
const CONFIG = {
  API_FOOTBALL_KEY:    process.env.API_FOOTBALL_KEY || 'TU_KEY',
  REAL_JAEN_TEAM_ID:   12486,
  REAL_JAEN_LEAGUE_ID: 546,
  SEASON:              2024,
  FLASHSCORE_TEAM_ID:  'tNTe4hA4',  // ID interno de Flashscore
  CACHE_TTL: {
    live:     60,    // segundos
    upcoming: 300,
    results:  600,
    standings:1800,
  },
  REFRESH_INTERVAL: 60_000,  // ms
};
```

---

## 🌐 DESPLIEGUE EN PRODUCCIÓN

### Opción A: Railway.app (GRATIS)

```bash
# Instalar Railway CLI
npm install -g @railway/cli

# Login y deploy
railway login
railway init
railway up
```

### Opción B: Render.com (GRATIS)

1. Crea cuenta en https://render.com
2. Nuevo servicio → Web Service
3. Conecta tu repo de GitHub
4. Build: `npm install`
5. Start: `node server.js`
6. Añade variable de entorno: `API_FOOTBALL_KEY`

### Opción C: VPS propio

```bash
# Con PM2 para mantenerlo vivo
npm install -g pm2
pm2 start server.js --name "realjaen-api"
pm2 startup
pm2 save
```

### Actualizar la URL en la app

Una vez desplegado, edita `real_jaen_app.html`:

```javascript
var API_BASE = 'https://tu-dominio.railway.app/api';
```

---

## ⚽ DATOS ACTUALES (sin API)

El sistema incluye datos estáticos actualizados (Temporada 2024/25):

**Últimos resultados:**
- ✅ Real Jaén 1-0 Yeclano CF (J28 · 15 Mar)
- 🟡 Porcuna CF 1-1 Real Jaén (J27 · 8 Mar)
- ✅ Real Jaén 3-1 Recreativo Granada (J26 · 1 Mar)

**Próximos partidos:**
- 📅 Recreativo de Huelva vs Real Jaén (21 Mar · 20:00)
- 📅 Real Jaén vs Linares Deportivo (29 Mar · 17:00)

**Clasificación:**
- 🥇 Marbella FC — 59 pts
- 🥈 **Real Jaén CF — 58 pts** ← ¡A un punto del liderato!
- 🥉 Almería B — 54 pts

---

## 🛠️ TECNOLOGÍAS

- **Backend:** Node.js 18+ · Express 4 · HTTP/HTTPS nativos
- **Datos:** API-Football v3 · Scraping Flashscore (fallback)
- **Caché:** Memoria (RAM) + disco (.cache/)
- **Frontend:** HTML5 · CSS3 · JavaScript vanilla
- **Auto-refresh:** setInterval + pre-fetch en background

---

## 📁 ESTRUCTURA

```
realjaen-backend/
├── server.js          ← Backend principal
├── package.json       ← Dependencias
├── README.md          ← Esta guía
└── .cache/            ← Caché en disco (auto-generado)

real_jaen_app.html     ← App web (abre en navegador)
```

---

## ⚠️ NOTAS LEGALES

- El scraping de Flashscore es para uso personal/educativo
- API-Football requiere atribución en uso público
- Los logos de equipos son propiedad de sus respectivos clubes

---

*Real Jaén CF App · v1.0 · Temporada 2024/25*
