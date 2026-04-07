import type { Metadata } from "next";
import { Suspense } from "react";
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
    default: "proanbud",
    template: "%s | proanbud",
  },
  description:
    "proanbud gir privatkunder materiallister og prisduell mellom byggevareleverandører, slik at flere leverandører konkurrerer om samme prosjekt.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="nb"
      data-scroll-behavior="smooth"
      className={`${spaceGrotesk.variable} ${sora.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning={true} className="min-h-full flex flex-col">
        <Suspense fallback={null}>
          <GlobalNav />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
