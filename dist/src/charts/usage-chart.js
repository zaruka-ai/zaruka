function escapeXml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function bucketize(daily, period) {
    // Yearly: bucket by month
    if (period === 'year') {
        const months = new Map();
        for (const d of daily) {
            const key = d.date.slice(0, 7); // YYYY-MM
            const existing = months.get(key);
            if (existing) {
                existing.inputTokens += d.inputTokens;
                existing.outputTokens += d.outputTokens;
                existing.cacheCreationTokens += d.cacheCreationTokens;
                existing.cacheReadTokens += d.cacheReadTokens;
                existing.cost += d.cost;
            }
            else {
                const monthIdx = parseInt(d.date.slice(5, 7), 10) - 1;
                months.set(key, {
                    label: MONTH_SHORT[monthIdx],
                    inputTokens: d.inputTokens,
                    outputTokens: d.outputTokens,
                    cacheCreationTokens: d.cacheCreationTokens,
                    cacheReadTokens: d.cacheReadTokens,
                    cost: d.cost,
                });
            }
        }
        return [...months.values()];
    }
    if (daily.length <= 31) {
        return daily.map((d) => ({
            label: d.date.slice(5), // MM-DD
            inputTokens: d.inputTokens,
            outputTokens: d.outputTokens,
            cacheCreationTokens: d.cacheCreationTokens,
            cacheReadTokens: d.cacheReadTokens,
            cost: d.cost,
        }));
    }
    // Bucket into weeks for >31 days
    const weeks = new Map();
    for (const d of daily) {
        const dt = new Date(d.date);
        const day = dt.getDay();
        const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
        const weekStart = new Date(dt);
        weekStart.setDate(diff);
        const key = weekStart.toISOString().slice(5, 10);
        const existing = weeks.get(key);
        if (existing) {
            existing.inputTokens += d.inputTokens;
            existing.outputTokens += d.outputTokens;
            existing.cacheCreationTokens += d.cacheCreationTokens;
            existing.cacheReadTokens += d.cacheReadTokens;
            existing.cost += d.cost;
        }
        else {
            weeks.set(key, {
                label: key,
                inputTokens: d.inputTokens,
                outputTokens: d.outputTokens,
                cacheCreationTokens: d.cacheCreationTokens,
                cacheReadTokens: d.cacheReadTokens,
                cost: d.cost,
            });
        }
    }
    return [...weeks.values()];
}
function formatYLabel(value, mode) {
    if (mode === 'cost') {
        if (value >= 1)
            return `$${value.toFixed(0)}`;
        if (value >= 0.01)
            return `$${value.toFixed(2)}`;
        return `$${value.toFixed(3)}`;
    }
    if (value >= 1_000_000)
        return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000)
        return `${(value / 1_000).toFixed(0)}K`;
    return String(Math.round(value));
}
// Colors
const COL_INPUT = '#60a5fa'; // blue
const COL_OUTPUT = '#fb923c'; // orange
const COL_CACHE_W = '#a78bfa'; // purple — cache write (creation)
const COL_CACHE_R = '#34d399'; // green — cache read
const COL_COST = '#4ade80'; // green
function buildSvg(buckets, options) {
    const W = options.width ?? 800;
    const H = options.height ?? 400;
    const mode = options.mode ?? 'tokens';
    const title = options.title ?? 'Usage';
    const padLeft = 70;
    const padRight = 20;
    const padTop = 50;
    const padBottom = 60;
    const chartW = W - padLeft - padRight;
    const chartH = H - padTop - padBottom;
    // Calculate max value
    let maxVal = 0;
    for (const b of buckets) {
        const val = mode === 'cost'
            ? b.cost
            : b.inputTokens + b.outputTokens + b.cacheCreationTokens + b.cacheReadTokens;
        if (val > maxVal)
            maxVal = val;
    }
    if (maxVal === 0)
        maxVal = 1;
    // Round up to nice number
    const magnitude = Math.pow(10, Math.floor(Math.log10(maxVal)));
    maxVal = Math.ceil(maxVal / magnitude) * magnitude;
    const barGap = 4;
    const barWidth = Math.max(4, Math.floor((chartW - barGap * buckets.length) / buckets.length));
    const totalBarSpace = (barWidth + barGap) * buckets.length;
    const offsetX = padLeft + Math.floor((chartW - totalBarSpace) / 2);
    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
    // Background
    parts.push(`<rect width="${W}" height="${H}" fill="#1a1a2e" rx="8"/>`);
    // Title
    parts.push(`<text x="${W / 2}" y="30" text-anchor="middle" fill="#e0e0e0" font-family="sans-serif" font-size="16" font-weight="bold">${escapeXml(title)}</text>`);
    // Grid lines and Y-axis labels
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
        const y = padTop + chartH - (i / gridLines) * chartH;
        const value = (i / gridLines) * maxVal;
        parts.push(`<line x1="${padLeft}" y1="${y}" x2="${W - padRight}" y2="${y}" stroke="#2a2a4a" stroke-width="1"/>`);
        parts.push(`<text x="${padLeft - 8}" y="${y + 4}" text-anchor="end" fill="#888" font-family="sans-serif" font-size="11">${escapeXml(formatYLabel(value, mode))}</text>`);
    }
    // Bars
    for (let i = 0; i < buckets.length; i++) {
        const b = buckets[i];
        const x = offsetX + i * (barWidth + barGap);
        if (mode === 'cost') {
            const h = (b.cost / maxVal) * chartH;
            const y = padTop + chartH - h;
            parts.push(`<rect x="${x}" y="${y}" width="${barWidth}" height="${h}" fill="${COL_COST}" rx="2"/>`);
        }
        else {
            // Stacked from bottom: cache_read, cache_write, input, output
            const total = b.cacheReadTokens + b.cacheCreationTokens + b.inputTokens + b.outputTokens;
            const totalH = (total / maxVal) * chartH;
            const yBase = padTop + chartH;
            const segments = [
                { value: b.cacheReadTokens, color: COL_CACHE_R },
                { value: b.cacheCreationTokens, color: COL_CACHE_W },
                { value: b.inputTokens, color: COL_INPUT },
                { value: b.outputTokens, color: COL_OUTPUT },
            ];
            let cumH = 0;
            for (const seg of segments) {
                if (seg.value <= 0)
                    continue;
                const segH = (seg.value / total) * totalH;
                parts.push(`<rect x="${x}" y="${yBase - cumH - segH}" width="${barWidth}" height="${segH}" fill="${seg.color}" rx="1"/>`);
                cumH += segH;
            }
        }
        // X-axis labels
        const labelEvery = Math.max(1, Math.ceil(buckets.length / 12));
        if (i % labelEvery === 0 || i === buckets.length - 1) {
            parts.push(`<text x="${x + barWidth / 2}" y="${padTop + chartH + 20}" text-anchor="middle" fill="#888" font-family="sans-serif" font-size="10" transform="rotate(-45, ${x + barWidth / 2}, ${padTop + chartH + 20})">${escapeXml(b.label)}</text>`);
        }
    }
    // Legend
    const ly = H - 12;
    if (mode === 'tokens') {
        let lx = padLeft;
        for (const [color, label] of [
            [COL_CACHE_R, 'Cache read'],
            [COL_CACHE_W, 'Cache write'],
            [COL_INPUT, 'Input'],
            [COL_OUTPUT, 'Output'],
        ]) {
            parts.push(`<rect x="${lx}" y="${ly - 8}" width="10" height="10" fill="${color}" rx="2"/>`);
            parts.push(`<text x="${lx + 14}" y="${ly}" fill="#aaa" font-family="sans-serif" font-size="11">${label}</text>`);
            lx += label.length * 7 + 28;
        }
    }
    else {
        parts.push(`<rect x="${padLeft}" y="${ly - 8}" width="10" height="10" fill="${COL_COST}" rx="2"/>`);
        parts.push(`<text x="${padLeft + 14}" y="${ly}" fill="#aaa" font-family="sans-serif" font-size="11">Cost (USD)</text>`);
    }
    parts.push('</svg>');
    return parts.join('\n');
}
function buildNoDataSvg(options) {
    const W = options.width ?? 800;
    const H = options.height ?? 400;
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
        `<rect width="${W}" height="${H}" fill="#1a1a2e" rx="8"/>`,
        `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="#888" font-family="sans-serif" font-size="18">No usage data for this period</text>`,
        '</svg>',
    ].join('\n');
}
export async function generateUsageChart(daily, options = {}) {
    const svg = daily.length === 0
        ? buildNoDataSvg(options)
        : buildSvg(bucketize(daily, options.period), options);
    const sharp = (await import('sharp')).default;
    return sharp(Buffer.from(svg)).png().toBuffer();
}
//# sourceMappingURL=usage-chart.js.map