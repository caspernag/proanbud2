import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LoginForm } from "@/app/_components/login-form";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { hasSupabaseEnv } from "@/lib/env";
import { sanitizeNextPath } from "@/lib/safe-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type LoginPageProps = {
  searchParams: Promise<{
    next?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = await searchParams;
  const nextPath = sanitizeNextPath(resolvedSearchParams.next);
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = supabase ? await supabase.auth.getUser() : { data: { user: null } };

  if (user) {
    redirect(nextPath);
  }

  return (
    <main className="relative isolate flex min-h-screen w-full items-center justify-center overflow-hidden px-3 py-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(24,32,26,0.05),_transparent_52%)]"
      />

      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Link href="/" className="inline-flex items-center" aria-label="proanbud">
            <Image src="/logo/light/logo-primary.svg" alt="proanbud" width={180} height={80} className="h-10 w-auto" priority />
          </Link>
        </div>

        <Card className="bg-white/95 backdrop-blur">
          <CardHeader className="pb-3">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-stone-500">Innlogging</p>
            <CardTitle className="display-font text-2xl">Logg inn</CardTitle>
            <CardDescription>Logg inn uten passord.</CardDescription>
          </CardHeader>

          <CardContent className="pt-0">
            <LoginForm nextPath={nextPath} supabaseEnabled={hasSupabaseEnv()} />
          </CardContent>

          <CardFooter className="border-t border-stone-200 pt-3 text-xs text-stone-600">
            <Link href="/" className="font-medium text-stone-900 underline-offset-4 hover:underline">
              Tilbake
            </Link>
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}
