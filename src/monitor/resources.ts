import { cpus, totalmem, freemem } from 'node:os';
import { execSync } from 'node:child_process';
import type { ResourceSnapshot } from '../core/types.js';

/**
 * Get CPU usage by sampling over a short interval.
 */
export async function getCpuUsage(): Promise<{ usagePercent: number; cores: number; model: string }> {
  const cpuList = cpus();
  const model = cpuList[0]?.model ?? 'Unknown';
  const cores = cpuList.length;

  // Sample CPU times at two points 500ms apart
  const start = cpus().map((c) => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) }));

  await new Promise((r) => setTimeout(r, 500));

  const end = cpus().map((c) => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) }));

  let totalIdle = 0;
  let totalTick = 0;
  for (let i = 0; i < cores; i++) {
    totalIdle += end[i].idle - start[i].idle;
    totalTick += end[i].total - start[i].total;
  }

  const usagePercent = totalTick === 0 ? 0 : Math.round(((totalTick - totalIdle) / totalTick) * 100);
  return { usagePercent, cores, model };
}

/**
 * Get swap usage on macOS/Linux.
 */
export function getSwapUsage(): { totalGB: number; usedGB: number; freeGB: number } | null {
  try {
    // Try macOS first
    const output = execSync('sysctl vm.swapusage 2>/dev/null', { encoding: 'utf-8', timeout: 2000 });
    // Example: vm.swapusage: total = 2048.00M  used = 512.00M  free = 1536.00M  (encrypted)
    const match = output.match(/total\s*=\s*([\d.]+)([MG])\s+used\s*=\s*([\d.]+)([MG])\s+free\s*=\s*([\d.]+)([MG])/);
    if (match) {
      const toGB = (val: string, unit: string) => unit === 'G' ? parseFloat(val) : parseFloat(val) / 1024;
      return {
        totalGB: Math.round(toGB(match[1], match[2]) * 10) / 10,
        usedGB: Math.round(toGB(match[3], match[4]) * 10) / 10,
        freeGB: Math.round(toGB(match[5], match[6]) * 10) / 10,
      };
    }
  } catch {
    // Try Linux
    try {
      const output = execSync('free -b 2>/dev/null', { encoding: 'utf-8', timeout: 2000 });
      const lines = output.trim().split('\n');
      const swapLine = lines.find((l) => l.startsWith('Swap:'));
      if (swapLine) {
        const parts = swapLine.split(/\s+/);
        const totalBytes = parseInt(parts[1], 10);
        const usedBytes = parseInt(parts[2], 10);
        const freeBytes = parseInt(parts[3], 10);
        return {
          totalGB: Math.round((totalBytes / 1073741824) * 10) / 10,
          usedGB: Math.round((usedBytes / 1073741824) * 10) / 10,
          freeGB: Math.round((freeBytes / 1073741824) * 10) / 10,
        };
      }
    } catch {
      // Ignore
    }
  }
  return null;
}

/**
 * Get RAM usage from os module, including swap information.
 */
export function getRamUsage(): { totalGB: number; usedGB: number; freeGB: number; usagePercent: number; swap: { totalGB: number; usedGB: number; freeGB: number } | null; effectiveUsagePercent: number } {
  const totalBytes = totalmem();
  const freeBytes = freemem();
  const usedBytes = totalBytes - freeBytes;

  const totalGB = Math.round((totalBytes / 1073741824) * 10) / 10;
  const usedGB = Math.round((usedBytes / 1073741824) * 10) / 10;
  const freeGB = Math.round((freeBytes / 1073741824) * 10) / 10;
  const usagePercent = Math.round((usedBytes / totalBytes) * 100);

  // Get swap info
  const swap = getSwapUsage();

  // Calculate effective usage: if swap is available, consider it as additional memory
  let effectiveUsagePercent = usagePercent;
  if (swap && swap.totalGB > 0) {
    // Total available memory = RAM + Swap
    const totalAvailable = totalBytes + (swap.totalGB * 1073741824);
    const totalUsed = usedBytes + (swap.usedGB * 1073741824);
    effectiveUsagePercent = Math.round((totalUsed / totalAvailable) * 100);
  }

  return { totalGB, usedGB, freeGB, usagePercent, swap, effectiveUsagePercent };
}

/**
 * Get disk usage by parsing `df` output.
 */
export function getDiskUsage(mount = '/'): { totalGB: number; usedGB: number; freeGB: number; usagePercent: number; mount: string } {
  try {
    const output = execSync(`df -k "${mount}"`, { encoding: 'utf-8', timeout: 5000 });
    const lines = output.trim().split('\n');
    if (lines.length < 2) throw new Error('Unexpected df output');

    // df -k outputs: Filesystem 1K-blocks Used Available Use% Mounted
    const parts = lines[1].split(/\s+/);
    const totalKB = parseInt(parts[1], 10);
    const usedKB = parseInt(parts[2], 10);
    const availKB = parseInt(parts[3], 10);

    const totalGB = Math.round((totalKB / 1048576) * 10) / 10;
    const usedGB = Math.round((usedKB / 1048576) * 10) / 10;
    const freeGB = Math.round((availKB / 1048576) * 10) / 10;
    const usagePercent = totalKB === 0 ? 0 : Math.round((usedKB / totalKB) * 100);

    return { totalGB, usedGB, freeGB, usagePercent, mount };
  } catch {
    return { totalGB: 0, usedGB: 0, freeGB: 0, usagePercent: 0, mount };
  }
}

/**
 * Get a full resource snapshot.
 */
export async function getResourceSnapshot(): Promise<ResourceSnapshot> {
  const cpu = await getCpuUsage();
  const ram = getRamUsage();
  const disk = getDiskUsage();

  return { cpu, ram, disk, timestamp: new Date().toISOString() };
}

/**
 * Check if there are enough resources for an installation.
 */
export function checkInstallationFeasibility(
  requiredDiskGB: number,
  requiredRamGB: number,
): { feasible: boolean; warnings: string[] } {
  const disk = getDiskUsage();
  const ram = getRamUsage();
  const warnings: string[] = [];

  if (disk.freeGB < requiredDiskGB) {
    warnings.push(`Not enough disk space: ${disk.freeGB} GB free, need ${requiredDiskGB} GB`);
  }
  if (ram.freeGB < requiredRamGB) {
    warnings.push(`Not enough RAM: ${ram.freeGB} GB free, need ${requiredRamGB} GB`);
  }

  return { feasible: warnings.length === 0, warnings };
}

/**
 * Format a resource snapshot as a human-readable report.
 */
export function formatResourceReport(snapshot: ResourceSnapshot): string {
  const { cpu, ram, disk } = snapshot;

  const cpuBar = makeBar(cpu.usagePercent);
  const ramBar = makeBar(ram.usagePercent);
  const diskBar = makeBar(disk.usagePercent);

  const lines = [
    '📊 System Resources',
    '',
    `CPU: ${cpuBar} ${cpu.usagePercent}%`,
    `  ${cpu.cores} cores — ${cpu.model}`,
    '',
    `RAM: ${ramBar} ${ram.usagePercent}%`,
    `  ${ram.usedGB} / ${ram.totalGB} GB (${ram.freeGB} GB free)`,
  ];

  // Add swap info if available
  if (ram.swap && ram.swap.totalGB > 0) {
    const swapBar = makeBar(Math.round((ram.swap.usedGB / ram.swap.totalGB) * 100));
    lines.push(`Swap: ${swapBar} ${Math.round((ram.swap.usedGB / ram.swap.totalGB) * 100)}%`);
    lines.push(`  ${ram.swap.usedGB} / ${ram.swap.totalGB} GB (${ram.swap.freeGB} GB free)`);
    lines.push(`  Effective memory usage: ${ram.effectiveUsagePercent}%`);
  }

  lines.push('');
  lines.push(`Disk: ${diskBar} ${disk.usagePercent}%`);
  lines.push(`  ${disk.usedGB} / ${disk.totalGB} GB (${disk.freeGB} GB free)`);

  return lines.join('\n');
}

function makeBar(percent: number, width = 10): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}
