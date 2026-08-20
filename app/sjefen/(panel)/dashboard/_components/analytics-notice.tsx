import type { AdminWebTraffic } from "@/lib/web-traffic";

/**
 * Skiller «ikke satt opp ennå» fra «kallet feilet».
 *
 * Begge gir tomme grafer, men bare den ene er noe å rette på nå — og ingen av
 * dem skal se ut som at butikken faktisk hadde null besøkende.
 */
export function AnalyticsNotice({ traffic }: { traffic: AdminWebTraffic }) {
  if (!traffic.configured) {
    return (
      <div className="mb-4 border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-xs font-semibold text-amber-900">
          {traffic.missingEnv.length === 1
            ? `Miljøvariabelen ${traffic.missingEnv[0]} mangler`
            : `${traffic.missingEnv.length} miljøvariabler mangler`}
        </p>
        <ul className="mt-1.5 space-y-1">
          {traffic.missingEnv.map((name) => (
            <li key={name} className="font-mono text-[11px] text-amber-900">
              {name}
            </li>
          ))}
        </ul>
        {/* Den vanligste feilen: alt er satt i Vercel, men ikke lokalt. */}
        {traffic.missingEnv.includes("VERCEL_PROJECT_ID") ? (
          <p className="mt-2 text-xs leading-5 text-amber-800">
            <code className="font-mono">VERCEL_PROJECT_ID</code> settes automatisk i deploy, men ikke lokalt — den må
            stå i <code className="font-mono">.env.local</code> for at dashboardet skal vise trafikk i utvikling.
          </p>
        ) : null}
      </div>
    );
  }

  if (traffic.errors.length === 0) {
    return null;
  }

  return (
    <div className="mb-4 border border-red-200 bg-red-50 px-4 py-3">
      <p className="text-xs font-semibold text-red-900">Kunne ikke hente trafikktall</p>
      <ul className="mt-1 space-y-1">
        {traffic.errors.map((error) => (
          <li key={error} className="text-xs leading-5 text-red-800">
            {error}
          </li>
        ))}
      </ul>
    </div>
  );
}
