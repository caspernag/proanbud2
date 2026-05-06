import { GlobalNavClient } from "@/app/_components/global-nav-client";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GlobalNav() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = supabase ? await getUserSafely(supabase) : { data: { user: null } };

  return <GlobalNavClient isLoggedIn={Boolean(user)} userEmail={user?.email ?? null} />;
}

async function getUserSafely(supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>) {
  try {
    return await supabase.auth.getUser();
  } catch (error) {
    if (isAbortLikeError(error)) {
      return { data: { user: null }, error: null };
    }

    throw error;
  }
}

function isAbortLikeError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as { name?: string; message?: string; status?: number; __isAuthError?: boolean };
  return (
    maybeError.name === "AbortError" ||
    maybeError.message?.toLowerCase().includes("aborted") === true ||
    (maybeError.__isAuthError === true && maybeError.status === 0)
  );
}
