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
    default: "Prisbygg",
    template: "%s | Prisbygg",
  },
  description:
    "Prisbygg selger byggevarer til konkurransedyktige priser, med fokus på trelast, plater, isolasjon, kledning, tak, maling, festemidler og verktøy. Vi tilbyr et nøye utvalgt sortiment av kvalitetsprodukter for både profesjonelle og private kunder. Med enkel nettbutikk og rask levering gjør vi det enkelt å få tak i det du trenger for ditt byggeprosjekt. Vi er billigere enn byggevarehusene, og tilbyr et bredt utvalg av byggevarer til konkurransedyktige priser. Enten du er en profesjonell entreprenør eller en gjør-det-selv entusiast, har vi det du trenger for å få jobben gjort. Vi tilbyr alt fra trelast og plater til isolasjon, kledning, tak, maling, festemidler og verktøy. Med vår brukervennlige nettbutikk og raske leveringstjeneste, gjør vi det enkelt for deg å få tak i de beste byggevarene til de beste prisene.",
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
