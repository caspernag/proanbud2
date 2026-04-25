import { redirect } from "next/navigation";
import { Suspense } from "react";

type ProjectsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function RedirectContent({ searchParams }: ProjectsPageProps) {
  const resolvedSearchParams = await searchParams;
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (typeof value === "string") {
      params.set(key, value);
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        params.append(key, entry);
      }
    }
  }

  const target = params.size > 0
    ? `/min-side/materiallister?${params.toString()}`
    : "/min-side/materiallister";

  redirect(target);
  return null;
}

export default function ProjectsPage(props: ProjectsPageProps) {
  return (
    <Suspense fallback={null}>
      <RedirectContent {...props} />
    </Suspense>
  );
}
