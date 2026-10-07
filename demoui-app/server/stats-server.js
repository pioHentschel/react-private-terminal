// Local-only hardware stats endpoint for the STAT tab. A browser can't read
// CPU/GPU/board details itself, so this tiny server does it via systeminformation.
// Run with `yarn stats-server`; CRA proxies /api/* to it (see "proxy" in package.json).

const http = require('http');
const si = require('systeminformation');

const PORT = Number(process.env.STATS_PORT) || 3001;
const HOST = '127.0.0.1';
const ONLINE_CHECK_TTL_MS = 5000;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

let staticInfo = null;
async function getStaticInfo() {
  if (staticInfo) return staticInfo;
  const [cpu, osInfo, baseboard, system, graphics, memLayout] = await Promise.all([
    si.cpu(), si.osInfo(), si.baseboard(), si.system(), si.graphics(), si.memLayout(),
  ]);
  const boardName = [baseboard.manufacturer, baseboard.model].filter((s) => s && s !== '-').join(' ');
  const systemName = [system.manufacturer, system.model].filter((s) => s && s !== '-').join(' ');
  staticInfo = {
    os: { name: osInfo.distro, release: osInfo.release, platform: osInfo.platform, kernel: osInfo.kernel, hostname: osInfo.hostname },
    arch: osInfo.arch,
    cpu: {
      name: `${cpu.manufacturer} ${cpu.brand}`.trim(),
      cores: cpu.cores,
      physicalCores: cpu.physicalCores,
      speedGHz: num(cpu.speed),
    },
    gpus: graphics.controllers.map((g) => ({
      name: g.model,
      vendor: g.vendor,
      vramMB: num(g.vram),
    })),
    motherboard: boardName || systemName || null,
    ramModules: memLayout.length,
  };
  return staticInfo;
}

let onlineCache = { at: 0, online: false, latencyMs: null };
async function getOnline() {
  if (Date.now() - onlineCache.at < ONLINE_CHECK_TTL_MS) return onlineCache;
  const latency = await si.inetLatency('1.1.1.1').catch(() => -1);
  onlineCache = { at: Date.now(), online: latency > 0, latencyMs: latency > 0 ? Math.round(latency) : null };
  return onlineCache;
}

async function getLiveStats() {
  const [load, temp, mem, graphics, net, online] = await Promise.all([
    si.currentLoad(), si.cpuTemperature(), si.mem(), si.graphics(), si.networkStats('*'), getOnline(),
  ]);
  const gpu = graphics.controllers[0] || {};
  // Sum real interfaces only; loopback would double-count local traffic.
  const ifaces = net.filter((n) => n.iface && !n.iface.startsWith('lo'));
  const sum = (key) => ifaces.reduce((acc, n) => acc + (num(n[key]) || 0), 0);
  // "used" counts cache/buffers on Linux; "active" is what apps actually hold.
  const usedBytes = mem.active || mem.used;
  return {
    cpu: { usagePercent: num(load.currentLoad), tempC: num(temp.main) },
    gpu: { usagePercent: num(gpu.utilizationGpu), tempC: num(gpu.temperatureGpu) },
    ram: { totalBytes: mem.total, usedBytes, usagePercent: mem.total ? (usedBytes / mem.total) * 100 : null },
    network: { online: online.online, latencyMs: online.latencyMs, downBytesPerSec: sum('rx_sec'), upBytesPerSec: sum('tx_sec') },
  };
}

const server = http.createServer(async (req, res) => {
  if (req.url !== '/api/stats') {
    res.writeHead(404).end();
    return;
  }
  try {
    const [info, live] = await Promise.all([getStaticInfo(), getLiveStats()]);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ...info, live }));
  } catch (err) {
    console.error('[stats-server]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
  }
});

server.listen(PORT, HOST, () => console.log(`[stats-server] http://${HOST}:${PORT}/api/stats`));
