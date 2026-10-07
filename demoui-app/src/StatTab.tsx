import React, { useEffect, useState } from 'react';

// Hardware/system readout. The browser can't see hardware, so this polls the
// local stats server (server/stats-server.js, proxied at /api/stats).

type Reading = { usagePercent: number | null; tempC: number | null };

type Stats = {
  os: { name: string; release: string; kernel: string; hostname: string };
  arch: string;
  cpu: { name: string; cores: number; physicalCores: number; speedGHz: number | null };
  gpus: { name: string; vendor: string; vramMB: number | null }[];
  motherboard: string | null;
  ramModules: number;
  live: {
    cpu: Reading;
    gpu: Reading;
    ram: { totalBytes: number; usedBytes: number; usagePercent: number | null };
    network: { online: boolean; latencyMs: number | null; downBytesPerSec: number; upBytesPerSec: number };
  };
};

const POLL_MS = 2000;

const pct = (v: number | null) => (v === null ? 'N/A' : `${v.toFixed(0)}%`);
const temp = (v: number | null) => (v === null ? 'N/A' : `${v.toFixed(0)}°C`);
const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

function formatRate(bytesPerSec: number): string {
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let value = bytesPerSec;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// Normalise Node's arch names to the x86 / ARM wording the user asked for.
function archLabel(arch: string): string {
  if (arch === 'x64' || arch === 'x86_64' || arch === 'amd64') return `x86 (64-bit, ${arch})`;
  if (arch === 'ia32' || arch === 'x86') return `x86 (32-bit, ${arch})`;
  if (arch.startsWith('arm')) return `ARM (${arch})`;
  return arch;
}

function Bar({ value }: { value: number | null }) {
  return (
    <div className="stat-bar" aria-hidden="true">
      <div className="stat-bar__fill" style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="stat-row">
      <span className="stat-row__label">{label}</span>
      <span className="stat-row__value">{value}</span>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="stat-panel">
      <h3 className="stat-panel__title">{title}</h3>
      {children}
    </section>
  );
}

function StatTab() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch('/api/stats');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Stats;
        if (!cancelled) {
          setStats(data);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    };
    poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (!stats) {
    return (
      <div className="pipboy-placeholder">
        <div className="pipboy-placeholder__label">STAT</div>
        <div className="pipboy-placeholder__status">
          {error ? 'STATS SERVER OFFLINE — RUN: yarn stats-server' : 'READING SYSTEM...'}
        </div>
      </div>
    );
  }

  const { live } = stats;
  const gpuNames = stats.gpus.length ? stats.gpus.map((g) => g.name).join(' / ') : 'N/A';

  return (
    <div className="stat-tab">
      {error && <div className="stat-tab__warn">CONNECTION TO STATS SERVER LOST — SHOWING LAST READING</div>}
      <div className="stat-grid">
        <Panel title="CPU">
          <Row label="MODEL" value={stats.cpu.name} />
          <Row label="CORES" value={`${stats.cpu.physicalCores} physical / ${stats.cpu.cores} logical`} />
          <Row label="USAGE" value={pct(live.cpu.usagePercent)} />
          <Bar value={live.cpu.usagePercent} />
          <Row label="TEMP" value={temp(live.cpu.tempC)} />
        </Panel>

        <Panel title="GPU">
          <Row label="MODEL" value={gpuNames} />
          <Row label="USAGE" value={pct(live.gpu.usagePercent)} />
          <Bar value={live.gpu.usagePercent} />
          <Row label="TEMP" value={temp(live.gpu.tempC)} />
        </Panel>

        <Panel title="RAM">
          <Row label="MODULES" value={stats.ramModules || 'N/A'} />
          <Row label="USED" value={`${gb(live.ram.usedBytes)} / ${gb(live.ram.totalBytes)}`} />
          <Row label="USAGE" value={pct(live.ram.usagePercent)} />
          <Bar value={live.ram.usagePercent} />
        </Panel>

        <Panel title="MOTHERBOARD">
          <Row label="MODEL" value={stats.motherboard ?? 'N/A'} />
        </Panel>

        <Panel title="SYSTEM">
          <Row label="OS" value={`${stats.os.name} ${stats.os.release}`} />
          <Row label="KERNEL" value={stats.os.kernel} />
          <Row label="ARCHITECTURE" value={archLabel(stats.arch)} />
          <Row label="HOST" value={stats.os.hostname} />
        </Panel>

        <Panel title="NETWORK">
          <Row
            label="INTERNET"
            value={
              live.network.online
                ? `ONLINE${live.network.latencyMs !== null ? ` (${live.network.latencyMs} ms)` : ''}`
                : 'OFFLINE'
            }
          />
          <Row label="DOWNLOAD" value={formatRate(live.network.downBytesPerSec)} />
          <Row label="UPLOAD" value={formatRate(live.network.upBytesPerSec)} />
        </Panel>
      </div>
    </div>
  );
}

export { StatTab };
