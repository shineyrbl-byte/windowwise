// Small inline SVG line chart: outdoor temp, room with plan, room kept shut.
// Open hours are shaded so you can see why the lines move.
import { hourOf } from './engine.js';

export function renderChart(plan, ariaLabel = `Room temperature over the next ${plan.length} hours.`) {
  const W = 720;
  const H = 240;
  const pad = { l: 36, r: 12, t: 12, b: 26 };
  const vals = plan.flatMap((h) => [h.temp, h.indoorPlan, h.indoorShut]);
  const lo = Math.floor(Math.min(...vals)) - 1;
  const hi = Math.ceil(Math.max(...vals)) + 1;
  const n = plan.length;
  const x = (i) => pad.l + (i / Math.max(1, n - 1)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const line = (key) => plan.map((h, i) => `${x(i).toFixed(1)},${y(h[key]).toFixed(1)}`).join(' ');
  const colW = (W - pad.l - pad.r) / Math.max(1, n - 1);

  const ticks = [];
  const stepT = Math.max(1, Math.round((hi - lo) / 4));
  for (let v = lo; v <= hi; v += stepT) ticks.push(v);

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${ariaLabel.replace(/"/g, '&quot;')}">
    ${plan
      .map((h, i) =>
        h.open
          ? `<rect class="openband" x="${(x(i) - colW / 2).toFixed(1)}" y="${pad.t}" width="${colW.toFixed(1)}" height="${H - pad.t - pad.b}"/>`
          : '',
      )
      .join('')}
    ${ticks
      .map(
        (v) => `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>
        <text class="tick" x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}°</text>`,
      )
      .join('')}
    ${plan
      .map((h, i) =>
        i % 3 === 0
          ? `<text class="tick" x="${x(i)}" y="${H - 8}" text-anchor="middle">${String(hourOf(h.time)).padStart(2, '0')}</text>`
          : '',
      )
      .join('')}
    <polyline class="l out" points="${line('temp')}"/>
    <polyline class="l shut" points="${line('indoorShut')}"/>
    <polyline class="l plan" points="${line('indoorPlan')}"/>
  </svg>`;
}

// Small chart of the user's thermometer readings against outdoor temperature.
// Filled dots: window mostly closed; hollow dots: mostly open.
export function renderLog(readings, series, ariaLabel) {
  if (!readings.length) return '';
  const W = 720;
  const H = 180;
  const pad = { l: 36, r: 12, t: 10, b: 22 };
  const from = readings[0].at - 3600e3;
  const to = Math.max(readings[readings.length - 1].at + 3600e3, from + 6 * 3600e3);
  const outside = series.filter((s) => s.at >= from && s.at <= to);
  const vals = [...readings.map((r) => r.temp), ...outside.map((s) => s.temp)];
  const lo = Math.floor(Math.min(...vals)) - 1;
  const hi = Math.ceil(Math.max(...vals)) + 1;
  const x = (at) => pad.l + ((at - from) / (to - from)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const fmt = (at) => new Date(at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return `<svg class="chart log" viewBox="0 0 ${W} ${H}" role="img" aria-label="${ariaLabel.replace(/"/g, '&quot;')}">
    ${[lo, Math.round((lo + hi) / 2), hi]
      .map((v) => `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}°</text>`)
      .join('')}
    <text class="tick" x="${pad.l}" y="${H - 6}">${fmt(from)}</text>
    <text class="tick" x="${W - pad.r}" y="${H - 6}" text-anchor="end">${fmt(to)}</text>
    ${outside.length > 1 ? `<polyline class="l out" points="${outside.map((s) => `${x(s.at).toFixed(1)},${y(s.temp).toFixed(1)}`).join(' ')}"/>` : ''}
    <polyline class="l plan" points="${readings.map((r) => `${x(r.at).toFixed(1)},${y(r.temp).toFixed(1)}`).join(' ')}"/>
    ${readings
      .map((r) => `<circle class="dot ${r.open ? 'hollow' : ''}" cx="${x(r.at).toFixed(1)}" cy="${y(r.temp).toFixed(1)}" r="6"><title>${fmt(r.at)}: ${r.temp}°C</title></circle>`)
      .join('')}
  </svg>`;
}
