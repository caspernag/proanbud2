import type { Metadata } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
import { Sora, Space_Grotesk } from "next/font/google";
import { GlobalNav } from "@/app/_components/global-nav";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "Proanbud",
    template: "%s | Proanbud",
  },
  description:
    "Proanbud gir privatkunder materiallister og prisduell mellom byggevareleverandører, slik at flere leverandører konkurrerer om samme prosjekt.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersList = await headers();
  const hostname = headersList.get("host") || "";
  const isAppHostname = hostname.startsWith("app.");
  const renderGlobalNav = isAppHostname;

  return (
    <html
      lang="nb"
      data-scroll-behavior="smooth"
      className={`${spaceGrotesk.variable} ${sora.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning={true} className="min-h-full flex flex-col">
        {renderGlobalNav && (
          <Suspense fallback={null}>
            <GlobalNav />
          </Suspense>
        )}
        {children}
      </body>
    </html>
  );
}
