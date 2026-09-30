import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useI18n } from '../i18n';
import { CHART_COLORS, useTheme } from '../theme';
import { StoryDetail } from '../types';

const HOUR = 3_600_000;

export default function CoverageChart({ timeline }: { timeline: StoryDetail['timeline'] }) {
  const { lang, t } = useI18n();
  const { resolved } = useTheme();
  const c = CHART_COLORS[resolved];
  const hourFmt = new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', { hour: 'numeric', day: 'numeric', month: 'short' });
  // Fill hours with no articles so the x-axis is continuous time (capped at one week).
  const byHour = new Map(timeline.map((p) => [Date.parse(p.hour), p]));
  const start = Date.parse(timeline[0].hour);
  const end = Math.min(Date.parse(timeline[timeline.length - 1].hour), start + 7 * 24 * HOUR);
  const data = [];
  for (let at = start; at <= end; at += HOUR) {
    const p = byHour.get(at);
    data.push({ en: p?.en ?? 0, hi: p?.hi ?? 0, label: hourFmt.format(new Date(at)) });
  }
  const names = { en: lang === 'hi' ? 'अंग्रेज़ी' : 'English', hi: lang === 'hi' ? 'हिंदी' : 'Hindi' };

  return (
    <figure className="chart">
      <div className="chart__plot">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis dataKey="label" tick={{ fill: c.text, fontSize: 12 }} tickLine={false} axisLine={{ stroke: c.grid }} minTickGap={24} />
            <YAxis allowDecimals={false} tick={{ fill: c.text, fontSize: 12 }} tickLine={false} axisLine={false} />
            <Tooltip
              cursor={{ fill: c.grid, opacity: 0.4 }}
              contentStyle={{ borderRadius: 8, border: `1px solid ${c.grid}`, fontFamily: 'inherit' }}
            />
            <Bar dataKey="en" name={names.en} stackId="lang" fill={c.en} maxBarSize={28} />
            <Bar dataKey="hi" name={names.hi} stackId="lang" fill={c.hi} radius={[3, 3, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="chart__caption">
        <span className="key key--en">{names.en}</span>
        <span className="key key--hi">{names.hi}</span>
        <span>{t.timelineNote}</span>
      </figcaption>
    </figure>
  );
}
