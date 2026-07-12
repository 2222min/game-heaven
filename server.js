'use strict';
/* ============================================================
   꼬물이.io — 실시간 멀티플레이 권위 서버 (의존성 0)
   - HTTP: public/ 정적 파일 서빙
   - WebSocket: RFC6455 직접 구현 (외부 패키지 불필요)
   - 30Hz 권위 시뮬레이션 · 15Hz AOI 스냅샷 · 3Hz 리더보드
   실행:  node server.js  [port]
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.argv[2] || process.env.PORT || '8808', 10);
const PUBLIC = __dirname; // 레포 루트가 곧 정적 루트 (GitHub Pages 와 동일 구조)

// ---------- 공유 상수 (클라이언트와 반드시 동일) ----------
const TAU = Math.PI * 2;
const WORLD_R = 3600;
const PT_SPACE = 5;
const BASE_SPEED = 165;
const BOOST_SPEED = 315;
const FOOD_TARGET = 2000;
const BOT_TARGET = 22;
const CELL = 160;
const TICK_HZ = 30;
const SNAP_EVERY = 1;   // 30Hz 스냅샷 (터널 지터 흡수용으로 상향)
const LB_EVERY = 15;    // 2Hz 리더보드

const SKINS = [
  { name: '바이올렛', cols: ['#8B5CF6', '#5B21B6', '#A78BFA'] },
  { name: '블레이즈', cols: ['#FF6B35', '#FFD23F', '#E82E2E'] },
  { name: '오션',     cols: ['#38BDF8', '#1D4ED8', '#7DD3FC'] },
  { name: '바이퍼',   cols: ['#4ADE80', '#166534', '#A3E635'] },
  { name: '캔디',     cols: ['#FB7185', '#FFE4F1', '#EC4899'] },
  { name: '레인보우', cols: ['#FF5C5C'], rainbow: true },
  { name: '골드',     cols: ['#FBBF24', '#92400E', '#FDE68A'] },
  { name: '팬텀',     cols: ['#E5E7EB', '#4B5563', '#9CA3AF'] },
];
const FOOD_COLS = ['#FF4F9A','#FFD93D','#6BFF8E','#4FC3FF','#C58BFF','#FF8A3D','#66FFF2','#FF5C5C','#B7FF4F'];

// 공유 팔레트: FOOD_COLS + 스킨 색 (인덱스로 전송)
const PALETTE = [];
const palIdx = new Map();
function paletteIndex(hex){
  if (palIdx.has(hex)) return palIdx.get(hex);
  const i = PALETTE.length; PALETTE.push(hex); palIdx.set(hex, i); return i;
}
FOOD_COLS.forEach(paletteIndex);
const SKIN_PAL = SKINS.map(s => s.cols.map(paletteIndex));
const FOOD_PAL = FOOD_COLS.map(paletteIndex);

const BOT_NAMES = ['꿈틀대마왕','국수도둑','뱀파이어','용가리','스네이쿠','미끄덩','파스타왕','츄러스','전봇대','지렁S',
  '람보르뱀','꼬불이','싱싱면발','우동사리','아나콘다','살모사','Slitherin','NoodleKing','ZigZag','Kobra',
  'wormhole','뱀뱀이','호롤롤로','기다란놈','미스터롱','슬금슬금','스르륵','철사줄','댕댕뱀','비암','꽈배기'];

// ---------- 유틸 ----------
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rand = (a, b) => a + Math.random() * (b - a);
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
function angNorm(a){ a %= TAU; if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU; return a; }
const angLerp = (a, b, f) => a + angNorm(b - a) * f;

// ---------- 먹이 ----------
let foodSeq = 1;
let foods = [];
const foodById = new Map();
const foodGrid = new Map();
const ci = v => ((v + WORLD_R + CELL * 2) / CELL) | 0;
function gridAdd(f){
  const k = ci(f.x) * 4096 + ci(f.y);
  let arr = foodGrid.get(k); if (!arr){ arr = []; foodGrid.set(k, arr); }
  arr.push(f); f.cell = k;
}
function gridRemove(f){
  const arr = foodGrid.get(f.cell);
  if (arr){ const i = arr.indexOf(f); if (i >= 0){ arr[i] = arr[arr.length - 1]; arr.pop(); } }
}
function forFoodNear(x, y, range, cb){
  const x0 = ci(x - range), x1 = ci(x + range), y0 = ci(y - range), y1 = ci(y + range);
  for (let cx = x0; cx <= x1; cx++)
    for (let cy = y0; cy <= y1; cy++){
      const arr = foodGrid.get(cx * 4096 + cy);
      if (arr) for (let i = arr.length - 1; i >= 0; i--) cb(arr[i]);
    }
}
function spawnFood(x, y, val, colIdx, r, bonus){
  if (foods.length > 4200) return null;
  const d = Math.hypot(x, y);
  if (d > WORLD_R - 25){ const s = (WORLD_R - 25) / d; x *= s; y *= s; }
  const f = { id: foodSeq++, x, y, val, r, colIdx, bonus: bonus ? 1 : 0, cell: 0, eaten: false };
  foods.push(f); foodById.set(f.id, f); gridAdd(f);
  return f;
}
function removeFood(f){
  f.eaten = true; gridRemove(f); foodById.delete(f.id);
  const i = foods.indexOf(f);
  if (i >= 0){ foods[i] = foods[foods.length - 1]; foods.pop(); }
}
function randomFood(){
  const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * (WORLD_R - 60);
  const big = Math.random() < 0.12;
  spawnFood(Math.cos(a) * d, Math.sin(a) * d, big ? 2 : 1,
            FOOD_PAL[(Math.random() * FOOD_PAL.length) | 0], big ? rand(5, 6.5) : rand(3.4, 5), 0);
}

// ---------- 뱀 ----------
let snakeSeq = 1;
let snakes = [];
class Snake {
  constructor(x, y, angle, mass, skinIdx, name, conn){
    this.id = snakeSeq++;
    this.x = x; this.y = y; this.angle = angle; this.targetAngle = angle;
    this.mass = mass; this.skinIdx = skinIdx; this.name = name;
    this.conn = conn || null; this.isBot = !conn;
    this.alive = true; this.kills = 0; this.boost = false; this.wantBoost = false;
    this.acc = 0; this.dropAcc = 0;
    this.thinkT = Math.random() * 0.15; this.wanderA = angle;
    this.aggressive = Math.random() < 0.35;
    this.pts = [];
    const mp = this.maxPts();
    for (let i = 0; i < mp; i++)
      this.pts.push({ x: x - Math.cos(angle) * i * PT_SPACE, y: y - Math.sin(angle) * i * PT_SPACE });
    this.aabb = { minx: 0, miny: 0, maxx: 0, maxy: 0 };
    this.updateAABB();
  }
  get r(){ return Math.min(6.5 + Math.sqrt(this.mass) * 0.65, 46); }
  bodyLen(){ return 36 + this.mass * 2.2; }
  maxPts(){ return Math.ceil(this.bodyLen() / PT_SPACE) + 2; }
  speed(){ return this.boost ? BOOST_SPEED : BASE_SPEED; }
  turnRate(){ return 5.4 * Math.pow(8.5 / this.r, 0.5); }
  gain(v){
    const f = this.mass < 400 ? 1 : this.mass < 1200 ? 0.72 : 0.5;
    this.mass += v * f;
  }
  update(dt){
    if (!this.alive) return;
    const maxTurn = this.turnRate() * dt;
    this.angle = angNorm(this.angle + clamp(angNorm(this.targetAngle - this.angle), -maxTurn, maxTurn));
    this.boost = this.wantBoost && this.mass > 12;
    if (this.boost){
      this.mass = Math.max(10, this.mass - 14 * dt);
      this.dropAcc += dt;
      if (this.dropAcc > 0.14){
        this.dropAcc = 0;
        const tail = this.pts[this.pts.length - 1];
        if (tail) spawnFood(tail.x + rand(-6, 6), tail.y + rand(-6, 6), 1, SKIN_PAL[this.skinIdx][0], 3.4, 0);
      }
    }
    const step = this.speed() * dt;
    this.x += Math.cos(this.angle) * step;
    this.y += Math.sin(this.angle) * step;
    if (Math.hypot(this.x, this.y) > WORLD_R){ this.die(null, 'wall'); return; }
    this.acc += step;
    while (this.acc >= PT_SPACE){
      this.acc -= PT_SPACE;
      this.pts.unshift({ x: this.x - Math.cos(this.angle) * this.acc, y: this.y - Math.sin(this.angle) * this.acc });
    }
    const mp = this.maxPts();
    while (this.pts.length > mp) this.pts.pop();
    this.updateAABB();
  }
  updateAABB(){
    const a = this.aabb, p = this.pts;
    a.minx = a.maxx = this.x; a.miny = a.maxy = this.y;
    for (let i = 0; i < p.length; i += 6){
      const q = p[i];
      if (q.x < a.minx) a.minx = q.x; else if (q.x > a.maxx) a.maxx = q.x;
      if (q.y < a.miny) a.miny = q.y; else if (q.y > a.maxy) a.maxy = q.y;
    }
    const q = p[p.length - 1];
    if (q){
      if (q.x < a.minx) a.minx = q.x; else if (q.x > a.maxx) a.maxx = q.x;
      if (q.y < a.miny) a.miny = q.y; else if (q.y > a.maxy) a.maxy = q.y;
    }
    const pad = this.r + 26;
    a.minx -= pad; a.maxx += pad; a.miny -= pad; a.maxy += pad;
  }
  die(killer, cause){
    if (!this.alive) return;
    this.alive = false;
    const spacing = Math.max(this.r * 1.15, 12);
    const stepIdx = Math.max(1, Math.round(spacing / PT_SPACE));
    const pal = SKIN_PAL[this.skinIdx];
    for (let i = 0; i < this.pts.length; i += stepIdx){
      const p = this.pts[i];
      const col = SKINS[this.skinIdx].rainbow
        ? FOOD_PAL[(Math.random() * FOOD_PAL.length) | 0]
        : pal[(Math.random() * pal.length) | 0];
      spawnFood(p.x + rand(-8, 8), p.y + rand(-8, 8), 7, col, rand(7, 10), 1);
      if (this.r > 20 && Math.random() < 0.5)
        spawnFood(p.x + rand(-16, 16), p.y + rand(-16, 16), 4, col, rand(5, 7), 1);
    }
    if (killer && killer.alive) killer.kills++;
    if (this.conn){
      const c = this.conn;
      send(c, { t: 'dead', mass: Math.floor(this.mass), kills: this.kills,
                by: killer ? killer.name : '', cause: cause || 'snake',
                surv: Math.max(0, Date.now() - c.joinT) });
      c.player = null;
    }
  }
  think(){
    const dc = Math.hypot(this.x, this.y);
    if (dc > WORLD_R - 380){
      this.targetAngle = Math.atan2(-this.y, -this.x) + rand(-0.4, 0.4);
      this.wantBoost = dc > WORLD_R - 150; return;
    }
    const r = this.r, lookD = Math.max(150, r * 7);
    const blocked = (dA, d) => { const a = this.angle + dA; return probeBlocked(this.x + Math.cos(a) * d, this.y + Math.sin(a) * d, this, r); };
    const bC = blocked(0, lookD) || blocked(0, lookD * 0.5);
    const bL = blocked(-0.7, lookD * 0.8);
    const bR = blocked(0.7, lookD * 0.8);
    if (bC || bL || bR){
      if (bC){
        if (!bL) this.targetAngle = this.angle - 1.25;
        else if (!bR) this.targetAngle = this.angle + 1.25;
        else this.targetAngle = this.angle + (Math.random() < 0.5 ? 2.8 : -2.8);
        this.wantBoost = this.mass > 30 && Math.random() < 0.45;
      } else if (bL){ this.targetAngle = this.angle + 0.55; this.wantBoost = false; }
      else { this.targetAngle = this.angle - 0.55; this.wantBoost = false; }
      return;
    }
    this.wantBoost = false;
    if (this.aggressive && this.mass > 60){
      const v = nearestSmaller(this, 560);
      if (v){
        const lead = v.r * 10 + 60;
        const tx = v.x + Math.cos(v.angle) * lead, ty = v.y + Math.sin(v.angle) * lead;
        this.targetAngle = Math.atan2(ty - this.y, tx - this.x);
        this.wantBoost = this.mass > 90 && dist2(this.x, this.y, tx, ty) > 200 * 200;
        return;
      }
    }
    const f = bestFoodNear(this, 500);
    if (f){ this.targetAngle = Math.atan2(f.y - this.y, f.x - this.x); return; }
    this.wanderA = angNorm(this.wanderA + rand(-0.8, 0.8));
    this.targetAngle = this.wanderA;
    if (dc > WORLD_R * 0.72) this.targetAngle = angLerp(this.targetAngle, Math.atan2(-this.y, -this.x), 0.5);
  }
}

function probeBlocked(px, py, self, rad){
  if (px * px + py * py > (WORLD_R - 60) * (WORLD_R - 60)) return true;
  for (const s of snakes){
    if (s === self || !s.alive) continue;
    const bb = s.aabb;
    if (px < bb.minx - rad || px > bb.maxx + rad || py < bb.miny - rad || py > bb.maxy + rad) continue;
    const thr = s.r + rad + 16, t2 = thr * thr;
    const st = Math.max(2, Math.round(s.r / PT_SPACE)), pts = s.pts;
    for (let i = 0; i < pts.length; i += st){
      const dx = pts[i].x - px, dy = pts[i].y - py;
      if (dx * dx + dy * dy < t2) return true;
    }
  }
  return false;
}
function nearestSmaller(self, range){
  let best = null, bd = range * range;
  for (const s of snakes){
    if (s === self || !s.alive || s.mass * 1.25 > self.mass) continue;
    const d = dist2(self.x, self.y, s.x, s.y);
    if (d < bd){ bd = d; best = s; }
  }
  return best;
}
function bestFoodNear(s, range){
  let best = null, bs = 0;
  forFoodNear(s.x, s.y, range, f => {
    const d = dist2(s.x, s.y, f.x, f.y);
    if (d > range * range) return;
    const score = (f.bonus ? 2.5 : 1) * f.val / (70 + Math.sqrt(d));
    if (score > bs){ bs = score; best = f; }
  });
  return best;
}

// ---------- 충돌 & 먹기 ----------
function collisions(){
  const deaths = [];
  for (const a of snakes){
    if (!a.alive) continue;
    for (const b of snakes){
      if (a === b || !b.alive) continue;
      const bb = b.aabb, thr = a.r * 0.9 + b.r * 0.9;
      if (a.x < bb.minx - thr || a.x > bb.maxx + thr || a.y < bb.miny - thr || a.y > bb.maxy + thr) continue;
      const t2 = thr * thr, st = Math.max(1, Math.round(b.r * 0.8 / PT_SPACE)), pts = b.pts;
      let hit = -1;
      for (let i = 0; i < pts.length; i += st){
        const dx = pts[i].x - a.x, dy = pts[i].y - a.y;
        if (dx * dx + dy * dy < t2){ hit = i; break; }
      }
      if (hit >= 0){
        if (hit * PT_SPACE < b.r * 1.4){
          if (a.mass <= b.mass * 1.12) deaths.push([a, b]);
          if (b.mass <= a.mass * 1.12) deaths.push([b, a]);
        } else deaths.push([a, b]);
        break;
      }
    }
  }
  for (const [dead, killer] of deaths) if (dead.alive) dead.die(killer, 'snake');
}
function eatUpdate(dt){
  for (const s of snakes){
    if (!s.alive) continue;
    const su = s.r + 30, su2 = su * su;
    forFoodNear(s.x, s.y, su, f => {
      if (f.eaten) return;
      if (dist2(s.x, s.y, f.x, f.y) < su2){ s.gain(f.val); removeFood(f); }
    });
  }
}

// ---------- 스폰 ----------
let usedNames = 0;
const namePool = BOT_NAMES.slice();
for (let i = namePool.length - 1; i > 0; i--){ const j = (Math.random() * (i + 1)) | 0; [namePool[i], namePool[j]] = [namePool[j], namePool[i]]; }
function nextBotName(){
  const base = namePool[usedNames % namePool.length];
  const suffix = usedNames >= namePool.length ? ((Math.random() * 90 + 10) | 0) : '';
  usedNames++; return base + suffix;
}
function findSpot(minDist){
  for (let tries = 0; tries < 40; tries++){
    const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * (WORLD_R - 600);
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    let ok = true;
    for (const s of snakes){ if (s.alive && dist2(x, y, s.x, s.y) < minDist * minDist){ ok = false; break; } }
    if (ok && probeBlocked(x, y, null, 70)) ok = false;
    if (ok) return { x, y };
  }
  const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * (WORLD_R - 800);
  return { x: Math.cos(a) * d, y: Math.sin(a) * d };
}
function spawnBot(big){
  const p = findSpot(420);
  const mass = big ? rand(300, 700) : 10 + Math.pow(Math.random(), 1.7) * 260;
  snakes.push(new Snake(p.x, p.y, rand(0, TAU), mass, (Math.random() * SKINS.length) | 0, nextBotName(), null));
}
function spawnPlayer(conn){
  const p = findSpot(700);
  const angle = Math.atan2(-p.y, -p.x);
  const s = new Snake(p.x, p.y, angle, 10, conn.skin, conn.name, conn);
  conn.player = s; conn.joinT = Date.now(); conn.cx = p.x; conn.cy = p.y;
  snakes.push(s);
  send(conn, { t: 'spawn', id: s.id, x: p.x, y: p.y, angle });
  return s;
}

// ---------- WebSocket (RFC6455, 의존성 0) ----------
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const conns = new Set();
let connSeq = 1;

function send(conn, obj){ sendFrame(conn, JSON.stringify(obj), 0x1); }
function sendFrame(conn, data, opcode){
  if (!conn.open) return;
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126){ header = Buffer.allocUnsafe(2); header[1] = len; }
  else if (len < 65536){ header = Buffer.allocUnsafe(4); header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.allocUnsafe(10); header[1] = 127; header.writeUInt32BE(Math.floor(len / 4294967296), 2); header.writeUInt32BE(len >>> 0, 6); }
  header[0] = 0x80 | opcode;
  try { conn.socket.write(Buffer.concat([header, payload])); }
  catch (e){ closeConn(conn); }
}
function closeConn(conn){
  if (!conn.open) return;
  conn.open = false;
  conns.delete(conn);
  if (conn.player){ conn.player.conn = null; conn.player = null; }
  try { conn.socket.destroy(); } catch (e){}
}
function parseFrames(conn){
  let buf = conn.buf;
  for (;;){
    if (buf.length < 2) break;
    const b1 = buf[1];
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f, off = 2;
    if (len === 126){ if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
    else if (len === 127){ if (buf.length < 10) break; len = buf.readUInt32BE(2) * 4294967296 + buf.readUInt32BE(6); off = 10; }
    let mask;
    if (masked){ if (buf.length < off + 4) break; mask = buf.slice(off, off + 4); off += 4; }
    if (buf.length < off + len) break;
    const opcode = buf[0] & 0x0f;
    let payload = buf.slice(off, off + len);
    if (masked){ const out = Buffer.allocUnsafe(len); for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3]; payload = out; }
    buf = buf.slice(off + len);
    if (opcode === 0x8){ closeConn(conn); conn.buf = buf; return; }
    else if (opcode === 0x9){ sendFrame(conn, payload, 0xA); }
    else if (opcode === 0x1){ try { onMessage(conn, JSON.parse(payload.toString('utf8'))); } catch (e){} }
  }
  conn.buf = buf;
}
function onMessage(conn, m){
  if (!m || typeof m !== 'object') return;
  if (m.t === 'join'){
    conn.name = String(m.name || '').trim().slice(0, 12) || '이름없는 꼬물이';
    conn.skin = clamp(parseInt(m.skin, 10) || 0, 0, SKINS.length - 1);
    if (typeof m.vr === 'number') conn.viewR = clamp(m.vr, 400, 4200);
    if (!conn.player) spawnPlayer(conn);
  } else if (m.t === 'input'){
    if (typeof m.a === 'number' && conn.player && conn.player.alive){
      conn.player.targetAngle = m.a;
      conn.player.wantBoost = !!m.b;
      conn.cx = conn.player.x; conn.cy = conn.player.y;
    }
    if (typeof m.vr === 'number') conn.viewR = clamp(m.vr, 400, 4200);
  } else if (m.t === 'respawn'){
    if (!conn.player) spawnPlayer(conn);
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
// ---- 던전 서바이버즈 리더보드 (파일 영속, 전체 + 날짜별 데일리) ----
const DS_SCORE_FILE = path.join(__dirname, 'ds-scores.json');
let dsScores = [], dsDaily = {};
try { const raw = JSON.parse(fs.readFileSync(DS_SCORE_FILE, 'utf8'));
  if (Array.isArray(raw)) dsScores = raw;                       // 구버전 포맷 호환
  else if (raw && typeof raw === 'object'){ dsScores = Array.isArray(raw.all) ? raw.all : []; dsDaily = raw.daily && typeof raw.daily === 'object' ? raw.daily : {}; }
} catch (e) {}

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/stats'){ // 게임천국 허브: 실시간 접속자 수
    const players = snakes.reduce((n, s) => n + (s.isBot ? 0 : 1), 0);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ players, bots: snakes.length - players }));
    return;
  }
  if (rel === '/ds/scores'){ // 던전 서바이버즈 순위 (전체 + 날짜별 데일리 보드)
    const HDR = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' };
    if (req.method === 'POST'){
      let body = '';
      req.on('data', c => { body += c; if (body.length > 2048) req.destroy(); });
      req.on('end', () => { try {
        const s = JSON.parse(body);
        const entry = { nick: String(s.nick || '용사').slice(0, 12), time: Math.min(7200, Math.max(0, Math.round(+s.time || 0))),
          kills: Math.min(99999, Math.max(0, (+s.kills | 0))), level: Math.min(999, Math.max(0, (+s.level | 0))),
          char: String(s.char || '').slice(0, 10), win: !!s.win, at: Date.now(),
          curse: Math.min(10, Math.max(0, (+s.curse | 0))), abyss: !!s.abyss,
          daily: !!s.daily, date: /^\d{4}-\d{2}-\d{2}$/.test(String(s.date)) ? String(s.date) : '' };
        if (entry.daily && entry.date){ // 데일리: 날짜별 보드, 최근 3일만 유지
          if (!dsDaily[entry.date]) dsDaily[entry.date] = [];
          dsDaily[entry.date].push(entry);
          dsDaily[entry.date].sort((a, b) => (b.win - a.win) || (b.time - a.time) || (b.kills - a.kills));
          dsDaily[entry.date] = dsDaily[entry.date].slice(0, 20);
          for (const d of Object.keys(dsDaily).sort().reverse().slice(3)) delete dsDaily[d];
        } else {
          dsScores.push(entry);
          dsScores.sort((a, b) => (b.win - a.win) || ((b.curse || 0) - (a.curse || 0)) || (b.time - a.time) || (b.kills - a.kills));
          dsScores = dsScores.slice(0, 50);
        }
        try { fs.writeFileSync(DS_SCORE_FILE, JSON.stringify({ all: dsScores, daily: dsDaily })); } catch (e) {}
        res.writeHead(200, HDR); res.end('{"ok":true}');
      } catch (e) { res.writeHead(400, HDR); res.end('{"ok":false}'); } });
      return;
    }
    const qs = req.url.split('?')[1] || '';
    const dm = /(?:^|&)daily=(\d{4}-\d{2}-\d{2})/.exec(qs);
    if (dm){ res.writeHead(200, HDR); res.end(JSON.stringify((dsDaily[dm[1]] || []).slice(0, 20))); return; }
    res.writeHead(200, HDR); res.end(JSON.stringify(dsScores.slice(0, 20)));
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const fp = path.join(PUBLIC, path.normalize(rel));
  if (!fp.startsWith(PUBLIC)){ res.writeHead(403); res.end('forbidden'); return; }
  if (rel.startsWith('/.git')){ res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(fp, (err, data) => {
    if (err){
      if (err.code === 'EISDIR'){ res.writeHead(302, { Location: rel + '/' }); res.end(); return; } // /pirate → /pirate/
      res.writeHead(404); res.end('not found'); return;
    }
    const type = MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});
server.on('upgrade', (req, socket) => {
  if (String(req.headers['upgrade'] || '').toLowerCase() !== 'websocket'){ socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key){ socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  const conn = { id: connSeq++, socket, buf: Buffer.alloc(0), open: true,
                 name: '꼬물이', skin: 0, viewR: 1200, player: null,
                 knownSnakes: new Set(), knownFood: new Set(), cx: 0, cy: 0, joinT: Date.now() };
  conns.add(conn);
  socket.on('data', d => { conn.buf = Buffer.concat([conn.buf, d]); parseFrames(conn); });
  socket.on('close', () => closeConn(conn));
  socket.on('error', () => closeConn(conn));
  send(conn, { t: 'welcome', world: WORLD_R, pal: PALETTE });
});

// ---------- 스냅샷 브로드캐스트 ----------
let rankMap = new Map(), aliveCount = 0, lbRows = [], snapSeq = 0;
function computeRanks(){
  const alive = snakes.filter(s => s.alive).sort((a, b) => b.mass - a.mass);
  aliveCount = alive.length;
  rankMap = new Map();
  for (let i = 0; i < alive.length; i++) rankMap.set(alive[i], i + 1);
  lbRows = alive.slice(0, 10).map(s => [s.name, Math.floor(s.mass)]);
}
function sendSnapshots(){
  computeRanks();
  snapSeq++;
  for (const conn of conns){
    if (!conn.open) continue;
    const cx = conn.player ? conn.player.x : conn.cx;
    const cy = conn.player ? conn.player.y : conn.cy;
    const aoi = conn.viewR + 300, aoi2 = aoi * aoi;
    const self = conn.player;
    // 뱀
    const sn = [], nAdd = [], seen = new Set();
    for (const s of snakes){
      if (!s.alive || s === self) continue;
      if (dist2(cx, cy, s.x, s.y) > aoi2) continue;
      seen.add(s.id);
      sn.push([s.id, Math.round(s.x), Math.round(s.y), Math.round(s.angle * 100), Math.floor(s.mass), s.skinIdx, s.boost ? 1 : 0]);
      if (!conn.knownSnakes.has(s.id)){ conn.knownSnakes.add(s.id); nAdd.push([s.id, s.name, s.skinIdx]); }
    }
    const sDel = [];
    for (const id of conn.knownSnakes) if (!seen.has(id)){ sDel.push(id); conn.knownSnakes.delete(id); }
    // 먹이
    const fAdd = [], fSeen = conn.knownFood;
    const nowFood = new Set();
    forFoodNear(cx, cy, aoi, f => {
      if (f.eaten) return;
      if (dist2(cx, cy, f.x, f.y) > aoi2) return;
      nowFood.add(f.id);
      if (!fSeen.has(f.id)){ fSeen.add(f.id); fAdd.push([f.id, Math.round(f.x), Math.round(f.y), f.colIdx, Math.round(f.r), f.bonus]); }
    });
    const fDel = [];
    for (const id of fSeen) if (!nowFood.has(id)){ fDel.push(id); fSeen.delete(id); }
    const me = self
      ? { x: Math.round(self.x), y: Math.round(self.y), m: Math.floor(self.mass), a: Math.round(self.angle * 100),
          b: self.boost ? 1 : 0, k: self.kills, rank: rankMap.get(self) || 0, alive: 1 }
      : { alive: 0, count: aliveCount };
    send(conn, { t: 's', seq: snapSeq, me, count: aliveCount, sn, nAdd, sDel, fAdd, fDel });
  }
}
function sendLeaderboard(){
  const msg = { t: 'lb', rows: lbRows, count: aliveCount };
  for (const conn of conns) if (conn.open) send(conn, msg);
}

// ---------- 메인 루프 ----------
let tickN = 0, last = Date.now();
let botRespawnT = 0;
function tick(){
  const now = Date.now();
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.05) dt = 0.05;
  // 봇 AI
  for (const s of snakes){
    if (!s.isBot || !s.alive) continue;
    s.thinkT -= dt;
    if (s.thinkT <= 0){ s.thinkT = rand(0.09, 0.18); s.think(); }
  }
  for (const s of snakes) s.update(dt);
  collisions();
  eatUpdate(dt);
  // 죽은 뱀 제거
  for (let i = snakes.length - 1; i >= 0; i--) if (!snakes[i].alive) snakes.splice(i, 1);
  // 봇 보충
  const botCount = snakes.reduce((n, s) => n + (s.isBot ? 1 : 0), 0);
  if (botCount < BOT_TARGET){ botRespawnT -= dt; if (botRespawnT <= 0){ botRespawnT = 0.8; spawnBot(false); } }
  // 먹이 보충
  let budget = 6;
  while (foods.length < FOOD_TARGET && budget-- > 0) randomFood();

  tickN++;
  if (tickN % SNAP_EVERY === 0) sendSnapshots();
  if (tickN % LB_EVERY === 0) sendLeaderboard();
}

// ---------- 부트 ----------
function init(){
  for (let i = 0; i < FOOD_TARGET; i++) randomFood();
  for (let i = 0; i < BOT_TARGET; i++) spawnBot(i < 4);
  computeRanks();
  setInterval(tick, 1000 / TICK_HZ);
  server.listen(PORT, () => {
    console.log('🐍 꼬물이.io 멀티플레이 서버 실행 중');
    console.log('   로컬:  http://localhost:' + PORT);
    console.log('   같은 와이파이의 친구는  http://<이 컴퓨터 IP>:' + PORT);
    console.log('   봇 ' + BOT_TARGET + '마리 · 먹이 ' + FOOD_TARGET + '개 로딩 완료');
  });
}
init();
