import { trafficWindowLabel, TRAFFIC_CHART_DAYS, type AdminWebTraffic } from "@/lib/web-traffic";

import { Card, num } from "../../../_components/ui";
import { AnalyticsNotice } from "./analytics-notice";
import { TrafficLineChart } from "./traffic-line-chart";

/**
 * Trafikkortet: hvor mange som er innom butikken, og hvordan det har utviklet
 * seg den siste måneden. Tallene kommer fra Vercel Web Analytics og dekker hele
 * prisbygg.no — også /sjefen selv, siden `<Analytics />` ligger i rot-layouten.
 */
export function WebTrafficCard({ traffic }: { traffic: AdminWebTraffic }) {
  const days = traffic.daily;
  const peak = Math.max(...days.map((day) => day.visitors), 0);
  const hasTraffic = peak > 0;

  return (
    <Card title="Web-trafikk" description={`Hele nettstedet · siste ${TRAFFIC_CHART_DAYS} dager`}>
      <AnalyticsNotice traffic={traffic} />

      <div className="grid grid-cols-3 gap-3">
        {traffic.summaries.map((summary) => (
          <div key={summary.days} className="border border-stone-200 px-3 py-2.5">
            <p className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
              {trafficWindowLabel(summary.days)}
            </p>
            <p className="mt-1.5 text-xl font-semibold tabular-nums text-stone-900">
              {summary.totals ? num(summary.totals.visitors) : "—"}
            </p>
            <p className="mt-0.5 text-xs text-stone-500">
              {summary.totals ? `${num(summary.totals.pageviews)} visninger` : "ikke tilgjengelig"}
            </p>
          </div>
        ))}
      </div>

      {hasTraffic ? (
        <>
          <div className="mt-5 flex items-baseline justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">Besøkende per døgn</p>
            <p className="text-[11px] tabular-nums text-stone-500">Topp {num(peak)}</p>
          </div>
          <div className="mt-2">
            <TrafficLineChart days={days} peak={peak} />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-stone-500">
            <span>{dayLabel(days[0].date)}</span>
            <span>{dayLabel(days[days.length - 1].date)}</span>
          </div>
        </>
      ) : (
        <p className="mt-5 border border-dashed border-stone-200 px-4 py-10 text-center text-sm text-stone-400">
          Ingen registrert trafikk i perioden.
        </p>
      )}
    </Card>
  );
}

function dayLabel(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("nb-NO", { day: "numeric", month: "short", timeZone: "UTC" });
}
