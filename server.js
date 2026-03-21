/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   REAL JAÉN CF — BACKEND v2                                  ║
 * ║   Fuente principal : SofaScore (api.sofascore.com) — GRATIS  ║
 * ║   Fallback         : datos estáticos actualizados            ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║                                                              ║
 * ║  ESTRUCTURA VERIFICADA de SportAPI7 (wrapper SofaScore):     ║
 * ║                                                              ║
 * ║  GET /api/v1/search/teams?query=Real+Jaen                    ║
 * ║      → { teams: [{ id, name, country, ... }] }               ║
 * ║                                                              ║
 * ║  GET /api/v1/team/{teamId}/events/next/{page}                ║
 * ║      → { events: [{ id, homeTeam, awayTeam,                  ║
 * ║            homeScore, awayScore, status,                     ║
 * ║            startTimestamp, tournament, ... }] }              ║
 * ║                                                              ║
 * ║  GET /api/v1/team/{teamId}/events/last/{page}                ║
 * ║      → { events: [...] }  (más reciente primero)             ║
 * ║                                                              ║
 * ║  GET /api/v1/team/{teamId}/events/live                       ║
 * ║      → { events: [...] }                                     ║
 * ║                                                              ║
 * ║  GET /api/v1/event/{eventId}/lineups                         ║
 * ║      → { home: { players, formation, coach },                ║
 * ║           away: { players, formation, coach } }              ║
 * ║                                                              ║
 * ║  GET /api/v1/event/{eventId}/statistics                      ║
 * ║      → { statistics: [{ period, groups: [                    ║
 * ║            { statisticsItems: [{ name,                       ║
 * ║              homeValue, awayValue }] }] }] }                 ║
 * ║                                                              ║
 * ║  GET /api/v1/unique-tournament/{tId}/season/{sId}            ║
 * ║         /standings/total                                     ║
 * ║      → { standings: [{ rows: [{ team, position,              ║
 * ║            matches, wins, draws, losses,                     ║
 * ║            scoresFor, scoresAgainst, points }] }] }          ║
 * ║                                                              ║
 * ║  IDs del Real Jaén en SofaScore:                             ║
 * ║    team_id      = 14160                                      ║
 * ║    tournament   = 1034  (2ª RFEF)                            ║
 * ║    season       = 63914 (2024/25)                            ║
 * ║                                                              ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  ENDPOINTS PROPIOS:                                          ║
 * ║    GET  /api/status                                          ║
 * ║    GET  /api/matches/upcoming                                ║
 * ║    GET  /api/matches/results                                 ║
 * ║    GET  /api/matches/live                                    ║
 * ║    GET  /api/matches/:id                                     ║
 * ║    GET  /api/standings                                       ║
 * ║    GET  /api/team                                            ║
 * ║    GET  /api/debug/:endpoint(*)   ← respuesta raw            ║
 * ║    POST /api/cache/clear                                     ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

'use strict';

const express = require('express');
const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const { URL } = require('url');

const app  = express();
const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓN — edita aquí si cambian los IDs
// ═══════════════════════════════════════════════════════════════
const CONFIG = {
  // SofaScore API — directo, sin clave, sin límites
  SOFASCORE_HOST: 'api.sofascore.com',

  // Real Jaén CF en SofaScore/SportAPI7
  // ID verificado: https://www.sofascore.com/team/football/real-jaen/2841
  TEAM_ID:       2841,
  TEAM_NAME:     'Real Jaén CF',

  // Segunda Federación — Grupo IV en SofaScore/SportAPI7
  // IDs verificados desde respuesta real de la API (temporada 25/26):
  //   uniqueTournament.id = 544   (Segunda Federación)
  //   tournament.id       = 93717 (Segunda Federacion, Group IV)
  //   season.id           = 77733 (Segunda Federacion 25/26)
  TOURNAMENT_ID: 544,
  GROUP_TOUR_ID: 93717,
  SEASON_ID:     77733,

  // TTL de caché en segundos
  CACHE_TTL: {
    live:      45,
    upcoming:  300,
    results:   600,
    standings: 1800,
    detail:    90,
  },

  // Intervalo de auto-refresh en ms
  REFRESH_MS: 60_000,
};

const TEAM_LOGOS = {
  217210: '/imagenes/aguilas.png',
  2838:   '/imagenes/xerezcd.png',
  189948: '/imagenes/deportiva_minera.png',
  852868: '/imagenes/extremadura.png',
  55785:  '/imagenes/union_atletico.png',
  202076: '/imagenes/recreativo_huelva.png',
  5068:   '/imagenes/lorca.png',
  55121:  '/imagenes/union_atletico.png',
  292589: '/imagenes/antoniano.png',
  2880:   '/imagenes/linares.png',
  43759:  '/imagenes/yeclano.png',
  263797: '/imagenes/puente_genil.png',
  229782: '/imagenes/xerezfc.png',
  324661: '/imagenes/estepona.png',
  24350:  '/imagenes/melilla.png',
  44321:  '/imagenes/almeria.png',
  4490:   '/imagenes/malagueño.png',
  2841:   '/imagenes/real_jaen.png'
};

// ═══════════════════════════════════════════════════════════════
// CACHÉ: RAM (rápida) + DISCO (persiste entre reinicios)
// ═══════════════════════════════════════════════════════════════
const ram = new Map();

function ramGet(k) {
  const e = ram.get(k);
  if (!e) return null;
  if (Date.now() - e.ts > e.ttl * 1000) { ram.delete(k); return null; }
  return e.data;
}
function ramSet(k, data, ttl) { ram.set(k, { data, ttl, ts: Date.now() }); }

const DISK = path.join(__dirname, '.cache');
if (!fs.existsSync(DISK)) fs.mkdirSync(DISK, { recursive: true });

function diskKey(k) { return path.join(DISK, k.replace(/[^a-z0-9_-]/gi, '_') + '.json'); }
function diskGet(k) {
  try {
    const f = diskKey(k);
    if (!fs.existsSync(f)) return null;
    const { data, exp } = JSON.parse(fs.readFileSync(f, 'utf8'));
    return Date.now() < exp ? data : null;
  } catch { return null; }
}
function diskSet(k, data, ttl) {
  try { fs.writeFileSync(diskKey(k), JSON.stringify({ data, exp: Date.now() + ttl * 1000 })); }
  catch {}
}

// Lee RAM primero, luego disco
function getCache(k)        { return ramGet(k) || diskGet(k); }
function setCache(k, d, ttl) { ramSet(k, d, ttl); diskSet(k, d, ttl); }

// ═══════════════════════════════════════════════════════════════
// CLIENTE HTTP — llama a SportAPI7
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// CLIENTE HTTP — llama directamente a SofaScore (gratis, sin API key)
// ═══════════════════════════════════════════════════════════════
function call(endpoint) {
  return new Promise((resolve) => {
    const parsed = new URL('https://' + CONFIG.SOFASCORE_HOST + endpoint);
    const req = https.request({
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers: {
        'Accept':          'application/json',
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'es-ES,es;q=0.9',
        'Origin':          'https://www.sofascore.com',
        'Referer':         'https://www.sofascore.com/',
        'Cache-Control':   'no-cache',
      },
      timeout: 10_000,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const ok   = res.statusCode === 200;
          if (!ok) console.warn('[API] ' + endpoint + ' → HTTP ' + res.statusCode, body.slice(0, 120));
          resolve({ ok, data, status: res.statusCode });
        } catch {
          console.error('[API] ' + endpoint + ' → parse error', body.slice(0, 80));
          resolve({ ok: false, data: null, status: res.statusCode });
        }
      });
    });
    req.on('error',   e  => { console.error('[API] ' + endpoint + ' →', e.message); resolve({ ok: false, data: null, status: 0 }); });
    req.on('timeout', () => { req.destroy(); console.error('[API] ' + endpoint + ' → timeout'); resolve({ ok: false, data: null, status: 0 }); });
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════════
// NORMALIZADORES — SofaScore → formato interno de la app
// ═══════════════════════════════════════════════════════════════

/*
 * Estado SofaScore:
 *   status.type  = "notstarted" | "inprogress" | "finished" | "postponed" | "canceled"
 *   status.code  = 0 (not started), 6/7 (1st/2nd half), 31 (half time),
 *                  100 (finished), 60 (postponed), 70 (cancelled)
 */
const STATUS = {
  notstarted:  'scheduled',
  inprogress:  'live',
  finished:    'finished',
  postponed:   'postponed',
  canceled:    'cancelled',
  cancelled:   'cancelled',
  interrupted: 'interrupted',
  halftime:    'halftime',
  pause:       'halftime',
};

const DAYS   = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
function fmtDate(ts) {
  const d = new Date(ts * 1000);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
function fmtTime(ts) {
  return new Date(ts * 1000)
    .toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
}

function normEvent(ev) {
  if (!ev?.id) return null;
  const hId  = ev.homeTeam?.id;
  const aId  = ev.awayTeam?.id;
  const jId  = CONFIG.TEAM_ID;
  const type = ev.status?.type || 'notstarted';
  return {
    id:            String(ev.id),
    source:        'sofascore',
    homeTeam: {
      id:     hId,
      name:   ev.homeTeam?.name      || 'Local',
      short:  ev.homeTeam?.shortName || ev.homeTeam?.nameCode || 'LOC',
      logo: TEAM_LOGOS[hId] || `/imagenes/default.png`,
      isJaen: hId === jId,
    },
    awayTeam: {
      id:     aId,
      name:   ev.awayTeam?.name      || 'Visitante',
      short:  ev.awayTeam?.shortName || ev.awayTeam?.nameCode || 'VIS',
      logo: TEAM_LOGOS[aId] || `/imagenes/default.png`,
      isJaen: aId === jId,
    },
    date:          ev.startTimestamp ? new Date(ev.startTimestamp * 1000).toISOString() : null,
    dateFormatted: ev.startTimestamp ? fmtDate(ev.startTimestamp) : '',
    time:          ev.startTimestamp ? fmtTime(ev.startTimestamp) : '',
    homeGoals:     ev.homeScore?.current ?? null,
    awayGoals:     ev.awayScore?.current ?? null,
    halfTimeHome:  ev.homeScore?.period1 ?? null,
    halfTimeAway:  ev.awayScore?.period1 ?? null,
    status:        STATUS[type] || type,
    statusRaw:     ev.status?.description || '',
    minute:        ev.time?.played        || null,
    competition:   ev.tournament?.name    || '2ª RFEF',
    round:         ev.roundInfo?.round    ? `Jornada ${ev.roundInfo.round}` : (ev.roundInfo?.name || null),
    venue:         ev.venue?.stadium?.name || null,
    city:          ev.venue?.city?.name    || null,
  };
}

function normStanding(row) {
  if (!row) return null;
  const tId = CONFIG.TEAM_ID;
  return {
    position:     row.position,
    team: {
      id:     row.team?.id,
      name:   row.team?.name      || '—',
      short:  row.team?.shortName || row.team?.nameCode || '—',
      logo: TEAM_LOGOS[row.team?.id] || `/imagenes/default.png`,
      isJaen: row.team?.id === tId,
    },
    played:       row.matches          || 0,
    won:          row.wins             || 0,
    draw:         row.draws            || 0,
    lost:         row.losses           || 0,
    goalsFor:     row.scoresFor        || 0,
    goalsAgainst: row.scoresAgainst    || 0,
    goalDiff:     (row.scoresFor || 0) - (row.scoresAgainst || 0),
    points:       row.points           || 0,
    form:         row.promotionDescription || '',
  };
}

// Extrae incidents (goles, tarjetas) del objeto event de SofaScore
function normIncidents(evData) {
  // SofaScore /incidents endpoint returns { incidents: [...] } directly
  const incidents = evData?.incidents || (evData?.event || evData)?.incidents || [];
  return incidents.map(inc => {
    const t = inc.incidentType || '';
    let type = 'other', detail = inc.incidentClass || '';
    if (t === 'goal')         { type = 'Goal'; detail = detail === 'ownGoal' ? 'Own Goal' : detail === 'penalty' ? 'Penalty' : 'Normal Goal'; }
    else if (t === 'card')    { type = 'Card'; detail = detail === 'yellow' ? 'Yellow Card' : detail === 'red' ? 'Red Card' : 'Y/R Card'; }
    else if (t === 'substitution') type = 'subst';
    else if (t === 'varDecision')  type = 'Var';
    if (type === 'other') return null;
    return {
      minute:   inc.time || 0,
      type, detail,
      player:   inc.player?.name  || null,
      assist:   inc.assist?.name  || null,
      isHome:   inc.isHome        ?? true,
    };
  }).filter(Boolean);
}

// Extrae alineaciones del endpoint /lineups
function normLineups(linData) {
  if (!linData) return null;
  const home = linData.home || linData.homeTeam;
  const away = linData.away || linData.awayTeam;
  if (!home && !away) return null;
  const mapP = p => ({
    number:   p.shirtNumber  || p.jerseyNumber || '',
    name:     p.player?.name || p.name || '',
    position: p.position     || '',
    isSub:    p.substitute   || false,
  });
  return [home, away].map((t, i) => ({
    side:        i === 0 ? 'home' : 'away',
    formation:   t?.formation || '',
    coach:       t?.coach?.name || '',
    startXI:     (t?.players || []).filter(p => !p.substitute).map(mapP),
    substitutes: (t?.players || []).filter(p =>  p.substitute).map(mapP),
  }));
}

// Extrae alineaciones del campo home/away del endpoint /incidents
// (fallback cuando /lineups da 404 — ocurre en categorías amateur)
function normLineupsFromIncidents(incData) {
  const home = incData.home;
  const away = incData.away;
  if (!home && !away) return null;

  const mapP = p => ({
    number:   p.shirtNumber || p.jerseyNumber || p.playerStatistic?.shirtNumber || '',
    name:     p.player?.name || p.name || '',
    position: p.position || p.positionName || '',
    isSub:    p.substitute || false,
  });

  const processTeam = (t) => {
    if (!t) return { formation: '', coach: '', startXI: [], substitutes: [] };
    const players = t.players || [];
    return {
      formation:   t.formation || '',
      coach:       t.supportStaff?.find(s => s.type === 'manager')?.name || t.manager?.name || '',
      startXI:     players.filter(p => !p.substitute).map(mapP),
      substitutes: players.filter(p =>  p.substitute).map(mapP),
    };
  };

  return [processTeam(home), processTeam(away)];
}

// Extrae estadísticas del endpoint /statistics
function normStats(statData) {
  if (!statData) return null;
  const period = (statData.statistics || []).find(p => p.period === 'ALL') || statData.statistics?.[0];
  if (!period) return null;
  const home = {}, away = {};
  (period.groups || []).forEach(g =>
    (g.statisticsItems || []).forEach(item => {
      const parse = v => { const s = String(v ?? 0).replace('%','').trim(); return isNaN(s) ? 0 : parseFloat(s); };
      home[item.name] = parse(item.homeValue ?? item.home);
      away[item.name] = parse(item.awayValue ?? item.away);
    })
  );
  // Renombrar a las claves que usa la app frontend
  const rn = o => ({
    'Ball Possession': o['Ball possession']  || o['Possession']       || 50,
    'Total Shots':     o['Total shots']      || o['Shots']            || 0,
    'Shots on Goal':   o['Shots on target']  || o['On target']        || 0,
    'Corner Kicks':    o['Corner kicks']     || o['Corners']          || 0,
    'Fouls':           o['Fouls']            || o['Total fouls']      || 0,
    'Yellow Cards':    o['Yellow cards']     || o['Bookings']         || 0,
    'Red Cards':       o['Red cards']        || 0,
    'Offsides':        o['Offsides']         || 0,
    'Saves':           o['Goalkeeper saves'] || o['Saves']            || 0,
  });
  return { home: rn(home), away: rn(away) };
}


// Normaliza un jugador del endpoint /players
function normPlayer(item) {
  const p = item.player || item;
  if (!p || !p.name) return null;
  const pos = { G:'GK', D:'DEF', M:'MID', F:'FWD' };
  const dob = p.dateOfBirth || p.dateOfBirthTimestamp
    ? (p.dateOfBirth
        ? p.dateOfBirth.slice(0,10)
        : new Date(p.dateOfBirthTimestamp * 1000).toISOString().slice(0,10))
    : null;
  const year = dob ? parseInt(dob.slice(0,4)) : null;
  const age  = year ? (new Date().getFullYear() - year) : null;
  return {
    id:          p.id,
    name:        p.name,
    shortName:   p.shortName || p.name,
    position:    pos[p.position] || p.position || '—',
    positionFull: { G:'Portero', D:'Defensa', M:'Centrocampista', F:'Delantero' }[p.position] || p.position || '—',
    jersey:      p.jerseyNumber || p.shirtNumber || null,
    dob,
    age,
    height:      p.height || null,
    country:     (p.country && p.country.alpha2) || null,
    countryName: (p.country && p.country.name)   || null,
    photo:       'https://realjaen-production.up.railway.app/api/logo/player/' + p.id,
  };
}

// ═══════════════════════════════════════════════════════════════
// FETCHERS — obtienen datos de SportAPI7 con caché
// ═══════════════════════════════════════════════════════════════

// Lee tournament/season de los eventos para standings automático
function autoDetectLeague(events) {
  if (!Array.isArray(events) || events.length === 0) return;
  // Copa del Rey = 329, Club Friendly = 853
  const CUPS = new Set([329, 150, 853, 86]);
  const lg = events.find(ev => {
    const uid = ev.tournament && ev.tournament.uniqueTournament && ev.tournament.uniqueTournament.id;
    return uid && !CUPS.has(uid);
  });
  if (!lg) return;
  const uid = lg.tournament && lg.tournament.uniqueTournament && lg.tournament.uniqueTournament.id;
  const sid = lg.season && lg.season.id;
  if (uid && uid !== CONFIG.TOURNAMENT_ID) {
    console.log('[AutoDetect] TOURNAMENT_ID ' + CONFIG.TOURNAMENT_ID + ' -> ' + uid);
    CONFIG.TOURNAMENT_ID = uid;
    ram.delete('standings');
  }
  if (sid && sid !== CONFIG.SEASON_ID) {
    console.log('[AutoDetect] SEASON_ID ' + CONFIG.SEASON_ID + ' -> ' + sid);
    CONFIG.SEASON_ID = sid;
    ram.delete('standings');
  }
}

async function fetchUpcoming() {
  const KEY = 'upcoming';
  const hit = getCache(KEY);
  if (hit) return hit;

  console.log('[Data] fetchUpcoming → SportAPI7');
  const { ok, data } = await call(`/api/v1/team/${CONFIG.TEAM_ID}/events/next/0`);

  let matches = [];
  if (ok && data) {
    const evs = data.events || (Array.isArray(data) ? data : []);
    autoDetectLeague(evs);
    // Filtrar solo temporada/torneo actual
    var evsFilt = evs.filter(function(ev) {
      var sid  = ev.season && ev.season.id;
      var utid = ev.tournament && ev.tournament.uniqueTournament && ev.tournament.uniqueTournament.id;
      return sid === CONFIG.SEASON_ID || utid === CONFIG.TOURNAMENT_ID;
    });
    matches = evsFilt.map(normEvent).filter(Boolean)
      .filter(m => m.status === 'scheduled' || m.status === 'postponed')
      .slice(0, 10);
    console.log('[Data] upcoming: ' + matches.length + ' partidos · tournamentId=' + CONFIG.TOURNAMENT_ID + ' seasonId=' + CONFIG.SEASON_ID);
  }

  if (!matches.length) {
    matches = staticUpcoming();
    console.warn('[Data] upcoming: usando fallback estático');
  }

  const result = { matches, updatedAt: new Date().toISOString(), source: matches[0]?.source || 'static' };
  setCache(KEY, result, CONFIG.CACHE_TTL.upcoming);
  return result;
}

async function fetchResults() {
  const KEY = 'results';
  const hit = getCache(KEY);
  if (hit) return hit;

  console.log('[Data] fetchResults → SportAPI7 (paginado)');

  // SportAPI7 devuelve /last/N en orden ASC (más antiguo primero).
  // hasNextPage:true significa que hay más páginas con eventos más recientes.
  // Estrategia: cargar hasta 3 páginas, concatenar y tomar los últimos 15.
  let allEvents = [];
  let page = 0;
  let hasNext = true;
  let lastOk = false;

  while (hasNext && page < 3) {
    const { ok, data } = await call(`/api/v1/team/${CONFIG.TEAM_ID}/events/last/${page}`);
    if (!ok || !data) {
      console.warn('[Data] results page ' + page + ' falló: ok=' + ok + ' data=' + (data ? JSON.stringify(data).slice(0,100) : 'null'));
      break;
    }
    lastOk = true;
    const evs = data.events || (Array.isArray(data) ? data : []);
    console.log('[Data] results page ' + page + ': ' + evs.length + ' eventos, hasNextPage=' + data.hasNextPage);
    if (page === 0) autoDetectLeague(evs);
    allEvents = allEvents.concat(evs);
    hasNext = data.hasNextPage === true;
    page++;
  }

  let matches = [];
  if (lastOk && allEvents.length) {
    // Ya vienen ASC → los últimos del array son los más recientes
    // Filtrar: solo temporada actual (77733) y liga (544), excluir Copa, amistosos
    var currentSeasonId = CONFIG.SEASON_ID;
    var currentTournamentId = CONFIG.TOURNAMENT_ID;
    var filtered = allEvents.filter(function(ev) {
      var sid = ev.season && ev.season.id;
      var utid = ev.tournament && ev.tournament.uniqueTournament && ev.tournament.uniqueTournament.id;
      // Aceptar si es de la temporada actual O del torneo correcto
      return sid === currentSeasonId || utid === currentTournamentId;
    });
    console.log('[Data] results: ' + filtered.length + ' de temporada actual de ' + allEvents.length + ' total');
    matches = filtered
      .map(normEvent).filter(Boolean)
      .filter(function(m){ return m.status === 'finished'; })
      .slice(-15)
      .reverse();
    console.log('[Data] results: ' + matches.length + ' finished mostrados');
  }

  if (!matches.length) {
    matches = staticResults();
    console.warn('[Data] results: usando fallback estático');
  }

  const result = { matches, updatedAt: new Date().toISOString(), source: matches[0]?.source || 'static' };
  setCache(KEY, result, CONFIG.CACHE_TTL.results);
  return result;
}

async function fetchSquad() {
  const KEY = 'squad';
  const hit = getCache(KEY);
  if (hit) return hit;

  console.log('[Data] fetchSquad → SportAPI7');
  const { ok, data } = await call('/api/v1/team/' + CONFIG.TEAM_ID + '/players');

  let players = [];
  if (ok && data && data.players) {
    // Filtrar: excluir retirados, sin edad coherente (>45 años) y duplicados por nombre
    var seen = new Set();
    players = data.players
      .filter(function(item) {
        var p = item.player || item;
        if (p.retired) return false;                    // retirado
        var yr = p.dateOfBirthTimestamp
          ? new Date(p.dateOfBirthTimestamp*1000).getFullYear()
          : (p.dateOfBirth ? parseInt(p.dateOfBirth.slice(0,4)) : 0);
        if (yr && (new Date().getFullYear() - yr) > 45) return false; // muy mayor
        return true;
      })
      .map(normPlayer).filter(Boolean)
      .filter(function(p){
        if (p.position === '—') return false;
        // Eliminar duplicados por nombre
        var key = p.name.toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    // Ordenar: GK → DEF → MID → FWD, luego por dorsal
    var order = { GK:1, DEF:2, MID:3, FWD:4 };
    players.sort(function(a,b){
      var diff = (order[a.position]||9) - (order[b.position]||9);
      if (diff !== 0) return diff;
      var ja = a.jersey || 99, jb = b.jersey || 99;
      return ja - jb;
    });
    console.log('[Data] squad: ' + players.length + ' jugadores de SportAPI7');
  }

  if (!players.length) {
    players = staticSquad();
    console.warn('[Data] squad: usando fallback estático');
  }

  const result = { players, updatedAt: new Date().toISOString(), source: players[0]?.id ? 'sportapi7' : 'static' };
  setCache(KEY, result, 3600); // caché 1 hora
  return result;
}

async function fetchLive() {
  const KEY = 'live';
  const hit = ramGet(KEY);   // solo RAM, sin disco (cambia cada 45 s)
  if (hit) return hit;

  const { ok, data } = await call(`/api/v1/team/${CONFIG.TEAM_ID}/events/live`);
  let matches = [];
  if (ok && data) {
    const evs = data.events || (Array.isArray(data) ? data : []);
    matches = evs.map(normEvent).filter(Boolean);
  }

  const result = { matches, isLive: matches.length > 0, updatedAt: new Date().toISOString() };
  ramSet(KEY, result, CONFIG.CACHE_TTL.live);
  return result;
}

async function fetchDetail(eventId) {
  const KEY = `detail_${eventId}`;
  const hit = getCache(KEY);
  if (hit) return hit;

  console.log(`[Data] fetchDetail → event ${eventId}`);

  // Llamar en paralelo a los 4 endpoints de SofaScore
  const [evR, incR, linR, statR] = await Promise.allSettled([
    call(`/api/v1/event/${eventId}`),
    call(`/api/v1/event/${eventId}/incidents`),
    call(`/api/v1/event/${eventId}/lineups`),
    call(`/api/v1/event/${eventId}/statistics`),
  ]);

  // Log raw event keys for debugging
  if (evR.status === 'fulfilled' && evR.value.ok) {
    const evKeys = evR.value.data ? Object.keys(evR.value.data) : [];
    console.log('[Detail] event keys:', evKeys.join(','));
  }

  // 1. Incidents (goles, tarjetas, sustituciones)
  const incData = incR.status === 'fulfilled' && incR.value.ok ? incR.value.data : null;
  const incidents = incData ? normIncidents(incData) : [];
  console.log(`[Detail] incidents: ${incidents.length} eventos`);

  // 2. Lineups — intentar en orden: /lineups → dentro de /event → no disponible
  let lineups = null;
  if (linR.status === 'fulfilled' && linR.value.ok) {
    lineups = normLineups(linR.value.data);
    console.log('[Detail] lineups: desde /lineups ✅');
  } else {
    // Intentar desde /event/:id que a veces incluye lineups
    const evData = evR.status === 'fulfilled' && evR.value.ok ? evR.value.data : null;
    if (evData) {
      const evKeys = Object.keys(evData);
      console.log('[Detail] event data keys:', evKeys.join(','));
      // Buscar lineups en distintos campos posibles
      const linSrc = evData.lineups || evData.lineup || null;
      if (linSrc) {
        lineups = normLineups(linSrc);
        console.log('[Detail] lineups: desde /event ✅');
      } else {
        console.log('[Detail] lineups: no disponible para esta categoría');
      }
    }
  }

  // 3. Stats — si 404, no disponible para esta categoría
  let stats = null;
  if (statR.status === 'fulfilled' && statR.value.ok) {
    stats = normStats(statR.value.data);
    console.log('[Detail] stats: OK ✅');
  } else {
    console.log('[Detail] stats: no disponible para esta categoría');
  }

  const detail = {
    id:        eventId,
    source:    'sofascore',
    events:    incidents,
    lineups,
    stats,
    updatedAt: new Date().toISOString(),
  };

  setCache(KEY, detail, CONFIG.CACHE_TTL.detail);
  return detail;
}

async function fetchStandings() {
  const KEY = 'standings';
  const hit = getCache(KEY);
  if (hit) return hit;

  console.log('[Data] fetchStandings → SportAPI7');

  // Probamos 2 endpoints en orden:
  // 1. GROUP_TOUR_ID=93717 → "Segunda Federacion, Group IV" (isGroup:true) — más específico
  // 2. TOURNAMENT_ID=544   → "Segunda Federación" padre — fallback
  // NOTA: GROUP_TOUR_ID=93717 devuelve 404 cuando se llama directamente.
  // TOURNAMENT_ID=544 devuelve los 5 grupos → filtramos el que tiene al Real Jaén.
  const standingsEndpoints = [
    '/api/v1/unique-tournament/' + CONFIG.TOURNAMENT_ID + '/season/' + CONFIG.SEASON_ID + '/standings/total',
  ];

  let standings = [];
  for (let sei = 0; sei < standingsEndpoints.length; sei++) {
    const { ok: sok, data: sdata } = await call(standingsEndpoints[sei]);
    if (!sok || !sdata) { console.warn('[Data] standings endpoint ' + sei + ' falló'); continue; }

    const standArr = sdata.standings || (Array.isArray(sdata) ? sdata : []);

    // El endpoint 544 devuelve los 5 grupos de la Segunda Federación.
    // Buscamos el grupo que contiene al Real Jaén (id=2841).
    let targetRows = null;
    for (let gi = 0; gi < standArr.length; gi++) {
      const rows = standArr[gi].rows || [];
      const hasJaen = rows.some(function(r) { return r.team && r.team.id === CONFIG.TEAM_ID; });
      if (hasJaen) {
        targetRows = rows;
        const grpName = standArr[gi].tournament && standArr[gi].tournament.name
                      ? standArr[gi].tournament.name
                      : ('Grupo ' + gi);
        console.log('[Data] standings: encontrado ' + grpName + ' con ' + rows.length + ' equipos');
        break;
      }
    }

    // Si no encontramos por equipo, usar el primer grupo como fallback
    if (!targetRows && standArr.length > 0) {
      targetRows = standArr[0].rows || [];
    }

    if (targetRows && targetRows.length > 0) {
      standings = targetRows.map(normStanding).filter(Boolean);
      console.log('[Data] standings: ' + standings.length + ' equipos procesados');
      break;
    }
    console.warn('[Data] standings endpoint ' + sei + ' sin filas válidas');
  }

  if (!standings.length) {
    standings = staticStandings();
    console.warn('[Data] standings: usando fallback estático');
  }

  const result = {
    standings,
    league:       'Segunda Federación',
    group:        'Grupo IV',
    tournamentId: CONFIG.TOURNAMENT_ID,
    seasonId:     CONFIG.SEASON_ID,
    updatedAt:    new Date().toISOString(),
    source:       standings[0]?.team?.id ? 'sportapi7' : 'static',
  };
  setCache(KEY, result, CONFIG.CACHE_TTL.standings);
  return result;
}

// ═══════════════════════════════════════════════════════════════
// DATOS ESTÁTICOS ACTUALIZADOS (fallback cuando SportAPI7 falla
// o la suscripción no está activa)
// ═══════════════════════════════════════════════════════════════
function staticSquad() {
  // Plantilla Real Jaén 25/26 — verificada de /api/v1/team/2841/players
  var sofaBase = 'https://api.sofascore.com/api/v1/player/';
  function p(id,name,pos,jersey,dob,country,h) {
    var posF={GK:'Portero',DEF:'Defensa',MID:'Centrocampista',FWD:'Delantero'};
    var yr=dob?parseInt(dob.slice(0,4)):null;
    return {id,name,shortName:name,position:pos,positionFull:posF[pos]||pos,
      jersey,dob,age:yr?new Date().getFullYear()-yr:null,height:h,country,
      countryName:{ES:'España',EN:'Inglaterra',MA:'Marruecos',ML:'Mali'}[country]||country,
      photo:'https://realjaen-production.up.railway.app/api/logo/player/'+id};
  }
  return [
    p(914252,  'Javier Rabanillo',  'GK',1,   '1995-10-21','ES',186),
    p(2273024, 'Jaime Morillas',    'GK',13,  '2004-08-10','ES',185),
    p(820707,  'Ruane Connor',      'DEF',3,  '1993-11-15','EN',178),
    p(175409,  'Javi Moyano',       'DEF',17, '1986-02-23','ES',179),
    p(1977446, 'Curro Burgos',      'DEF',null,'2004-05-30','ES',null),
    p(900341,  'Mauro Cabello',     'DEF',20, '1993-12-22','ES',176),
    p(602216,  'J.C. Mancilla',     'DEF',null,'1995-03-04','ES',185),
    p(864187,  'Pelayo Suarez',     'DEF',null,'1998-07-09','ES',182),
    p(1428084, 'Fernando Cortijo',  'DEF',null,'1999-10-13','ES',null),
    p(1977460, 'Pedro Fernández',   'DEF',25, '2003-03-17','ES',183),
    p(1429049, 'José Álvarez',      'MID',6,  '2000-08-24','ES',null),
    p(861277,  'Antonio Caballero', 'MID',8,  '1994-01-06','ES',179),
    p(268117,  'Adri',              'MID',10, '1992-07-22','ES',175),
    p(368820,  'Ñito González',     'MID',10, '1992-11-26','ES',169),
    p(1977465, 'Sergio Rivera',     'MID',14, '2001-04-08','ES',178),
    p(1402763, 'Nacho Vizcaíno',    'MID',16, '2005-08-04','ES',181),
    p(916135,  'Óscar Lozano',      'MID',22, '1996-06-14','ES',170),
    p(1545211, 'David Serrano',     'MID',29, '2005-01-28','ES',null),
    p(1011343, 'Alberto Bernardo',  'FWD',7,  '1999-02-27','ES',175),
    p(861277,  'Iván Breñé',        'FWD',9,  '2001-01-13','ES',null),
    p(347538,  'Mario Martos',      'FWD',11, '1991-11-14','ES',175),
    p(942663,  'Marco Siverio',     'FWD',14, '1994-10-04','ES',184),
    p(848589,  'Moha Sanhaji',      'FWD',21, '1999-04-15','MA',179),
    p(860692,  'Agustín Alonso',    'FWD',19, '1994-09-21','ES',183),
    p(2059405, 'Zeidy Traoré',      'FWD',null,'2004-01-22','ML',null),
    p(2235104, 'Adrián Fernández',  'FWD',null,'2006-02-18','ES',null),
  ];
}

function staticUpcoming() {
  // Datos reales verificados desde SportAPI7 (temporada 25/26)
  return [
    { id:'14102062', source:'static',
      homeTeam:{ id:202076, name:'Recreativo de Huelva', short:'HUE', isJaen:false, logo:'/imagenes/recreativo_huelva.png'},
      awayTeam:{ id:2841,   name:'Real Jaén',            short:'JAE', isJaen:true  },
      date: new Date(1774107000*1000).toISOString(),
      dateFormatted:'Sáb 22 Mar', time:'16:30',
      homeGoals:null, awayGoals:null,
      status:'scheduled', competition:'Segunda Federación', round:'Jornada 28',
      venue:'Nuevo Colombino', city:'Huelva' },
    { id:'14102134', source:'static',
      homeTeam:{ id:2841, name:'Real Jaén',  short:'JAE', isJaen:true  },
      awayTeam:{ id:2838, name:'Xerez CD',   short:'XER', isJaen:false, logo:'/imagenes/xerezcd.png'},
      date: new Date(1774715400*1000).toISOString(),
      dateFormatted:'Sáb 29 Mar', time:'17:10',
      homeGoals:null, awayGoals:null,
      status:'scheduled', competition:'Segunda Federación', round:'Jornada 29',
      venue:'Estadio La Victoria', city:'Jaén' },
    { id:'14102186', source:'static',
      homeTeam:{ id:4490, name:'Atlético Malagueño', short:'ATL', isJaen:false, logo:'/imagenes/malageno.png'},
      awayTeam:{ id:2841, name:'Real Jaén',           short:'JAE', isJaen:true  },
      date: new Date(1775401200*1000).toISOString(),
      dateFormatted:'Dom 6 Abr', time:'17:00',
      homeGoals:null, awayGoals:null,
      status:'scheduled', competition:'Segunda Federación', round:'Jornada 30' },
  ];
}

function staticResults() {
  // Datos reales verificados desde SportAPI7 (temporada 25/26)
  // /api/v1/team/2841/events/last/0  →  devueltos en orden cronológico, reverse() en fetchResults
  return [
    { id:'14102003', source:'static',
      homeTeam:{ id:2841,  name:'Real Jaén',        short:'JAE', isJaen:true  },
      awayTeam:{ id:43759, name:'Yeclano Deportivo', short:'YEC', isJaen:false, logo:'/imagenes/yeclano.png'},
      dateFormatted:'Dom 15 Mar', time:'17:30', homeGoals:1, awayGoals:0,
      status:'finished', competition:'Segunda Federación', round:'Jornada 27',
      venue:'Estadio La Victoria', city:'Jaén' },
    { id:'14101949', source:'static',
      homeTeam:{ id:2880, name:'Linares Deportivo', short:'LIN', isJaen:false, logo:'/imagenes/linares.png'},
      awayTeam:{ id:2841, name:'Real Jaén',          short:'JAE', isJaen:true  },
      dateFormatted:'Dom 8 Mar', time:'17:30', homeGoals:1, awayGoals:1,
      status:'finished', competition:'Segunda Federación', round:'Jornada 26' },
    { id:'14101852', source:'static',
      homeTeam:{ id:2841,   name:'Real Jaén',   short:'JAE', isJaen:true  },
      awayTeam:{ id:217210, name:'CDA Águilas', short:'AGU', isJaen:false, logo:'/imagenes/aguilas.png'},
      dateFormatted:'Dom 1 Mar', time:'18:00', homeGoals:3, awayGoals:1,
      status:'finished', competition:'Segunda Federación', round:'Jornada 25',
      venue:'Estadio La Victoria', city:'Jaén' },
    { id:'14101791', source:'static',
      homeTeam:{ id:24350, name:'UD Melilla', short:'MEL', isJaen:false, logo:'/imagenes/melilla.png'},
      awayTeam:{ id:2841,  name:'Real Jaén',  short:'JAE', isJaen:true  },
      dateFormatted:'Dom 22 Feb', time:'17:00', homeGoals:0, awayGoals:1,
      status:'finished', competition:'Segunda Federación', round:'Jornada 24' },
    { id:'14101726', source:'static',
      homeTeam:{ id:2841,   name:'Real Jaén',          short:'JAE', isJaen:true  },
      awayTeam:{ id:189948, name:'Deportiva Minera',   short:'DMI', isJaen:false, logo:'/imagenes/deportiva_minera.png'},
      dateFormatted:'Dom 15 Feb', time:'17:00', homeGoals:2, awayGoals:0,
      status:'finished', competition:'Segunda Federación', round:'Jornada 23',
      venue:'Estadio La Victoria', city:'Jaén' },
    { id:'15527291', source:'static',
      homeTeam:{ id:229782, name:'Xerez Deportivo FC', short:'XER', isJaen:false, logo:'/imagenes/xerezfc.png'},
      awayTeam:{ id:2841,   name:'Real Jaén',           short:'JAE', isJaen:true  },
      dateFormatted:'Dom 8 Feb', time:'17:30', homeGoals:1, awayGoals:2,
      status:'finished', competition:'Segunda Federación', round:'Jornada 22' },
  ];
}

function staticStandings() {
  // Datos REALES del Grupo IV — standings[3] de /unique-tournament/544/season/77733/standings/total
  // Jornada 27, actualizado 2026-03-15
  return [
    { position:1,  team:{ id:217210, name:'CDA Águilas FC',       short:'AGU', isJaen:false, logo:'/imagenes/aguilas.png'}, played:27, won:14, draw:7,  lost:6,  goalsFor:35, goalsAgainst:20, goalDiff:15,  points:49 },
    { position:2,  team:{ id:2838,   name:'Xerez CD',              short:'XER', isJaen:false, logo:'/imagenes/xerezcd.png'}, played:27, won:14, draw:6,  lost:7,  goalsFor:28, goalsAgainst:20, goalDiff:8,   points:48 },
    { position:3,  team:{ id:189948, name:'Deportiva Minera',      short:'DMI', isJaen:false, logo:'/imagenes/deportiva_minera.png'}, played:27, won:14, draw:5,  lost:8,  goalsFor:39, goalsAgainst:27, goalDiff:12,  points:47 },
    { position:4,  team:{ id:852868, name:'CD Extremadura',        short:'CEX', isJaen:false, logo:'/imagenes/extremadura.png'}, played:27, won:12, draw:10, lost:5,  goalsFor:41, goalsAgainst:31, goalDiff:10,  points:46 },
    { position:5,  team:{ id:55785,  name:'UCAM Murcia',           short:'UCA', isJaen:false, logo:'/imagenes/union_atletico.png'}, played:27, won:13, draw:7,  lost:7,  goalsFor:39, goalsAgainst:31, goalDiff:8,   points:46 },
    { position:6,  team:{ id:2841,   name:'Real Jaén',             short:'JAE', isJaen:true  }, played:27, won:12, draw:9,  lost:6,  goalsFor:34, goalsAgainst:27, goalDiff:7,   points:45 },
    { position:7,  team:{ id:202076, name:'Recreativo de Huelva',  short:'HUE', isJaen:false, logo:'/imagenes/recreativo_huelva.png'}, played:27, won:12, draw:9,  lost:6,  goalsFor:34, goalsAgainst:17, goalDiff:17,  points:45 },
    { position:8,  team:{ id:5068,   name:'Lorca Deportiva',       short:'LOR', isJaen:false, logo:'/imagenes/lorca.png'}, played:27, won:12, draw:6,  lost:9,  goalsFor:27, goalsAgainst:26, goalDiff:1,   points:42 },
    { position:9,  team:{ id:55121,  name:'FC La Unión Atlético',  short:'LAU', isJaen:false, logo:'/imagenes/union_atletico.png'}, played:27, won:10, draw:6,  lost:11, goalsFor:33, goalsAgainst:33, goalDiff:0,   points:36 },
    { position:10, team:{ id:292589, name:'CA Antoniano',          short:'ANT', isJaen:false, logo:'/imagenes/antoniano.png'}, played:27, won:10, draw:6,  lost:11, goalsFor:31, goalsAgainst:32, goalDiff:-1,  points:36 },
    { position:11, team:{ id:2880,   name:'Linares Deportivo',     short:'LIN', isJaen:false, logo:'/imagenes/linares.png'}, played:27, won:8,  draw:12, lost:7,  goalsFor:31, goalsAgainst:37, goalDiff:-6,  points:36 },
    { position:12, team:{ id:43759,  name:'Yeclano Deportivo',     short:'YEC', isJaen:false, logo:'/imagenes/yeclano.png'}, played:27, won:10, draw:4,  lost:13, goalsFor:22, goalsAgainst:25, goalDiff:-3,  points:34 },
    { position:13, team:{ id:263797, name:'Salerm Puente Genil',   short:'PUE', isJaen:false, logo:'/imagenes/puente_genil.png'}, played:27, won:8,  draw:9,  lost:10, goalsFor:23, goalsAgainst:30, goalDiff:-7,  points:33 },
    { position:14, team:{ id:229782, name:'Xerez Deportivo FC',    short:'XDE', isJaen:false, logo:'/imagenes/xerezfc.png'}, played:27, won:7,  draw:10, lost:10, goalsFor:30, goalsAgainst:33, goalDiff:-3,  points:31 },
    { position:15, team:{ id:324661, name:'CD Estepona',           short:'EST', isJaen:false, logo:'/imagenes/estepona.png'}, played:27, won:8,  draw:5,  lost:14, goalsFor:28, goalsAgainst:37, goalDiff:-9,  points:29 },
    { position:16, team:{ id:24350,  name:'UD Melilla',            short:'MEL', isJaen:false, logo:'/imagenes/melilla.png'}, played:27, won:5,  draw:11, lost:11, goalsFor:25, goalsAgainst:29, goalDiff:-4,  points:26 },
    { position:17, team:{ id:44321,  name:'Almería B',             short:'ALB', isJaen:false, logo:'/imagenes/almeria.png'}, played:27, won:4,  draw:7,  lost:16, goalsFor:20, goalsAgainst:39, goalDiff:-19, points:19 },
    { position:18, team:{ id:4490,   name:'Atlético Malagueño',    short:'ATL', isJaen:false, logo:'/imagenes/malageno.png'}, played:27, won:3,  draw:5,  lost:19, goalsFor:22, goalsAgainst:48, goalDiff:-26, points:14 },
  ];
}

// ═══════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════

// CORS sin dependencias externas
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Powered-By', 'RealJaenAPI/2.0');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());
app.use('/imagenes', express.static(path.join(__dirname, 'imagenes')));

// Logger
app.use((req, res, next) => {
  const t = Date.now();
  res.on('finish', () =>
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} → ${res.statusCode} (${Date.now()-t}ms)`)
  );
  next();
});

// ═══════════════════════════════════════════════════════════════
// RUTAS
// ═══════════════════════════════════════════════════════════════

// ── Estado y diagnóstico ─────────────────────────────────────
app.get('/api/status', async (req, res) => {
  // Prueba rápida a SportAPI7
  // Prueba rápida a SofaScore
  const probe = await call('/api/v1/team/' + CONFIG.TEAM_ID + '/events/next/0');
  const probeSt = await call('/api/v1/unique-tournament/' + CONFIG.TOURNAMENT_ID + '/season/' + CONFIG.SEASON_ID + '/standings/total');
  const apiStatus = probe.ok
    ? ('✅ SofaScore OK · Standings: ' + (probeSt.ok ? '✅ OK' : '⚠️ ' + probeSt.status))
    : ('⚠️  Error HTTP ' + probe.status + ' — comprueba conexión a internet');

  res.json({
    ok:           true,
    version:      '2.0.0',
    dataSource:   'SofaScore · api.sofascore.com (directo, sin API key)',
    team:         CONFIG.TEAM_NAME,
    teamId:       CONFIG.TEAM_ID,
    tournamentId: CONFIG.TOURNAMENT_ID,
    seasonId:     CONFIG.SEASON_ID,
    sportapi7:       apiStatus,
    cacheEntries:    ram.size,
    uptime:       `${Math.round(process.uptime())}s`,
    timestamp:    new Date().toISOString(),
  });
});

// ── Próximos partidos ────────────────────────────────────────
app.get('/api/matches/upcoming', async (req, res) => {
  try {
    res.json({ ok: true, ...await fetchUpcoming() });
  } catch (err) {
    console.error('[Route] upcoming:', err.message);
    res.status(500).json({ ok: false, error: err.message, matches: staticUpcoming() });
  }
});

// ── Resultados ───────────────────────────────────────────────
app.get('/api/matches/results', async (req, res) => {
  try {
    res.json({ ok: true, ...await fetchResults() });
  } catch (err) {
    console.error('[Route] results:', err.message);
    res.status(500).json({ ok: false, error: err.message, matches: staticResults() });
  }
});

// ── En directo ───────────────────────────────────────────────
app.get('/api/matches/live', async (req, res) => {
  try {
    res.json({ ok: true, ...await fetchLive() });
  } catch (err) {
    console.error('[Route] live:', err.message);
    res.status(500).json({ ok: false, error: err.message, matches: [], isLive: false });
  }
});

// ── Detalle de partido ───────────────────────────────────────
app.get('/api/matches/:id', async (req, res) => {
  try {
    const detail = await fetchDetail(req.params.id);
    res.json({ ok: true, ...detail });
  } catch (err) {
    console.error('[Route] detail:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Clasificación ────────────────────────────────────────────
app.get('/api/squad', async (req, res) => {
  const EXCLUIR = ['Jaime', 'Zeidy Traore', 'Sergio Rivera', 'Fernando Cortijo', 'J.C. Mancilla'];
  try {
    var data = await fetchSquad();
    data.players = data.players.filter(p => !EXCLUIR.includes(p.name) && !p.name.includes('Zeidy') && !p.name.includes('J.C.'));
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error('[Route] squad:', err.message);
    res.status(500).json({ ok: false, error: err.message, players: staticSquad() });
  }
});

app.get('/api/standings', async (req, res) => {
  try {
    res.json({ ok: true, ...await fetchStandings() });
  } catch (err) {
    console.error('[Route] standings:', err.message);
    res.status(500).json({ ok: false, error: err.message, standings: staticStandings() });
  }
});

// ── Datos del equipo ─────────────────────────────────────────
app.get('/api/team', (req, res) => {
  res.json({
    ok: true,
    team: {
      id:           CONFIG.TEAM_ID,
      name:         'Real Jaén Club de Fútbol',
      shortName:    'Real Jaén',
      founded:      1922,
      stadium:      'Estadio La Victoria',
      capacity:     14500,
      city:         'Jaén, Andalucía',
      country:      'España',
      league:       '2ª RFEF — Grupo 4',
      tournamentId: CONFIG.TOURNAMENT_ID,
      seasonId:     CONFIG.SEASON_ID,
      sofascoreUrl: `https://www.sofascore.com/team/football/real-jaen/${CONFIG.TEAM_ID}`,
      colors: { primary: '#5B2D8E', secondary: '#FFFFFF', accent: '#C9900C' },
    },
  });
});

// ── Logo proxy — evita CORS para imágenes de SofaScore ──────
app.get('/api/logo/team/:id', async (req, res) => {
  try {
    const url = 'https://api.sofascore.com/api/v1/team/' + req.params.id + '/image';
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        'Referer': 'https://www.sofascore.com/',
        'Origin': 'https://www.sofascore.com',
        'Accept': 'image/webp,image/png,image/*',
      },
      timeout: 8000
    });
    res.setHeader('Content-Type', response.headers['content-type'] || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(response.data);
  } catch(e) {
    res.status(404).end();
  }
});

app.get('/api/logo/player/:id', async (req, res) => {
  const url = 'https://api.sofascore.com/api/v1/player/' + req.params.id + '/image';
  const https2 = require('https');
  https2.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Referer': 'https://www.sofascore.com/',
      'Origin': 'https://www.sofascore.com',
    }
  }, function(imgRes) {
    res.setHeader('Content-Type', imgRes.headers['content-type'] || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    imgRes.pipe(res);
  }).on('error', function() {
    res.status(404).end();
  });
});

// ── Debug: respuesta raw de SportAPI7 ────────────────────────
// Útil para verificar que la suscripción funciona
// Ejemplo: GET /api/debug/api/v1/team/14160/events/next/0
app.get('/api/debug/:endpoint(*)', async (req, res) => {
  const ep = '/' + req.params.endpoint;
  console.log('[Debug]', ep);
  const result = await call(ep);
  res.json(result);
});

// ── Limpiar caché ────────────────────────────────────────────
app.post('/api/cache/clear', (req, res) => {
  ram.clear();
  res.json({ ok: true, message: 'Caché RAM vaciada' });
});

// ── Página de documentación ──────────────────────────────────
// Servir la app HTML
app.get('/app', (req, res) => {
  const appPath = path.join(__dirname, 'real_jaen_app.html');
  if (fs.existsSync(appPath)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(fs.readFileSync(appPath, 'utf8'));
  } else {
    res.status(404).send('App no encontrada. Copia real_jaen_app.html a esta carpeta.');
  }
});

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<title>Real Jaén API v2</title>
<style>
  body{font-family:system-ui;max-width:700px;margin:40px auto;padding:20px;background:#f4f2f8;color:#1a1a2e}
  h1{color:#5b2d8e}
  code{background:#e8e0f8;padding:2px 7px;border-radius:4px;font-size:13px}
  .ep{background:#fff;border:1px solid #d0c8e8;border-radius:8px;padding:9px 14px;margin:6px 0;display:flex;align-items:center;gap:10px}
  .get{background:#ede9fe;color:#5b2d8e;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;flex-shrink:0}
  .box{background:#fff;border:1px solid #d0c8e8;border-radius:8px;padding:14px 18px;margin:16px 0;font-size:13px;line-height:1.8}
  .ok{color:#16a34a;font-weight:700} .err{color:#dc2626;font-weight:700}
  a{color:#5b2d8e}
</style></head><body>
<h1>⚽ Real Jaén CF — API v2</h1>
<p>Fuente: <strong>SofaScore</strong> · <code>api.sofascore.com</code> (directo, sin API key)</p>

<div class="box">
  <strong>IDs del Real Jaén:</strong><br>
  Team ID: <code>${CONFIG.TEAM_ID}</code> &nbsp;|&nbsp;
  Tournament: <code>${CONFIG.TOURNAMENT_ID}</code> &nbsp;|&nbsp;
  Season: <code>${CONFIG.SEASON_ID}</code>
</div>

<h2>Endpoints</h2>
<div class="ep"><span class="get">GET</span><code>/api/status</code> — Diagnóstico completo</div>
<div class="ep"><span class="get">GET</span><code>/api/matches/upcoming</code> — Próximos partidos</div>
<div class="ep"><span class="get">GET</span><code>/api/matches/results</code> — Resultados recientes</div>
<div class="ep"><span class="get">GET</span><code>/api/matches/live</code> — En directo</div>
<div class="ep"><span class="get">GET</span><code>/api/matches/:id</code> — Detalle (events/lineups/stats)</div>
<div class="ep"><span class="get">GET</span><code>/api/squad</code> — Plantilla actual</div>
<div class="ep"><span class="get">GET</span><code>/api/standings</code> — Clasificación 2ª RFEF</div>
<div class="ep"><span class="get">GET</span><code>/api/team</code> — Ficha del equipo</div>
<div class="ep"><span class="get">GET</span><code>/api/debug/api/v1/...</code> — Respuesta raw SportAPI7</div>

<div class="box">
  <strong>🔧 Verificar suscripción:</strong><br>
  <a href="/api/debug/api/v1/team/${CONFIG.TEAM_ID}/events/next/0" target="_blank">
    /api/debug/api/v1/team/${CONFIG.TEAM_ID}/events/next/0
  </a><br>
  Si ves <span class="err">"You are not subscribed"</span> →
  <a href="https://rapidapi.com/rapidsportapi/api/sportapi7/pricing" target="_blank">
    suscríbete aquí (plan Free)
  </a><br>
  Si ves <span class="ok">{ "events": [...] }</span> → ¡todo funciona!
</div>

<p style="color:#aaa;font-size:11px;margin-top:30px">Real Jaén API v2.0 · ${new Date().toISOString()}</p>
</body></html>`);
});

// ═══════════════════════════════════════════════════════════════
// AUTO-REFRESH EN BACKGROUND
// ═══════════════════════════════════════════════════════════════
function startAutoRefresh() {
  setInterval(async () => {
    ['upcoming','results','standings','live','squad'].forEach(k => ram.delete(k));
    await Promise.allSettled([fetchUpcoming(), fetchResults(), fetchStandings(), fetchLive()]);
    console.log('[AutoRefresh] ✓ ' + new Date().toLocaleTimeString('es-ES'));
  }, CONFIG.REFRESH_MS);
  console.log(`[AutoRefresh] cada ${CONFIG.REFRESH_MS / 1000}s`);
}

// ═══════════════════════════════════════════════════════════════
// ARRANQUE
// ═══════════════════════════════════════════════════════════════
app.listen(PORT, async () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   REAL JAÉN CF — API SERVER v2               ║
║   Puerto  : ${PORT}                             ║
║   Fuente  : SportAPI7 (SofaScore)            ║
║   Team ID : ${CONFIG.TEAM_ID}                       ║
╚══════════════════════════════════════════════╝`);

  console.log(`\n[Server] http://localhost:${PORT}/`);
  console.log('[Server] Precargando datos...\n');

  // Precarga inicial
  await Promise.allSettled([fetchUpcoming(), fetchResults(), fetchStandings(), fetchSquad()]);
  console.log('[Server] ✓ Listo\n');

  startAutoRefresh();
});

module.exports = app;
