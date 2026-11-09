// Small inline SVG line chart: outdoor temp, room with plan, room kept shut.
// Open hours are shaded so you can see why the lines move.
import { hourOf } from './engine.js';

export function renderChart(plan) {
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

  const label = plan
    .map((h) => `${hourOf(h.time)}:00 outside ${h.temp.toFixed(0)}, plan ${h.indoorPlan.toFixed(0)}, shut ${h.indoorShut.toFixed(0)}`)
    .filter((_, i) => i % 6 === 0)
    .join('; ');

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Temperature over the next ${n} hours. ${label}.">
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
