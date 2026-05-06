import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Inter } from "next/font/google";
import { GlobalNav } from "@/app/_components/global-nav";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Proanbud",
    template: "%s | Proanbud",
  },
  description:
    "Proanbud gir privatkunder AI-materiallister, partnerpris på byggevarer og bestilling gjennom én innkjøpskanal.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="nb"
      data-scroll-behavior="smooth"
      className={`${inter.variable} h-full antialiased`}
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
