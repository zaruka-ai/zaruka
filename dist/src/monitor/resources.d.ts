import type { ResourceSnapshot } from '../core/types.js';
/**
 * Get CPU usage by sampling over a short interval.
 */
export declare function getCpuUsage(): Promise<{
    usagePercent: number;
    cores: number;
    model: string;
}>;
/**
 * Get swap usage on macOS/Linux.
 */
export declare function getSwapUsage(): {
    totalGB: number;
    usedGB: number;
    freeGB: number;
} | null;
/**
 * Get RAM usage from os module, including swap information.
 */
export declare function getRamUsage(): {
    totalGB: number;
    usedGB: number;
    freeGB: number;
    usagePercent: number;
    swap: {
        totalGB: number;
        usedGB: number;
        freeGB: number;
    } | null;
    effectiveUsagePercent: number;
};
/**
 * Get disk usage by parsing `df` output.
 */
export declare function getDiskUsage(mount?: string): {
    totalGB: number;
    usedGB: number;
    freeGB: number;
    usagePercent: number;
    mount: string;
};
/**
 * Get a full resource snapshot.
 */
export declare function getResourceSnapshot(): Promise<ResourceSnapshot>;
/**
 * Check if there are enough resources for an installation.
 */
export declare function checkInstallationFeasibility(requiredDiskGB: number, requiredRamGB: number): {
    feasible: boolean;
    warnings: string[];
};
/**
 * Format a resource snapshot as a human-readable report.
 */
export declare function formatResourceReport(snapshot: ResourceSnapshot): string;
//# sourceMappingURL=resources.d.ts.map