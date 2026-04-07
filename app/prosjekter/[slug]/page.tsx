import { redirect } from "next/navigation";

type ProjectPageProps = {
  params: Promise<{
    slug: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProjectPage({ params, searchParams }: ProjectPageProps) {
  const { slug } = await params;
  const resolvedSearchParams = await searchParams;
  const nextParams = new URLSearchParams();

  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (typeof value === "string") {
      nextParams.set(key, value);
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        nextParams.append(key, entry);
      }
    }
  }

  const target = nextParams.size > 0
    ? `/min-side/materiallister/${slug}?${nextParams.toString()}`
    : `/min-side/materiallister/${slug}`;

  redirect(target);
}
