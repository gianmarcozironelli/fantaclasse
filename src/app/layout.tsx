import type { Metadata, Viewport } from "next";
import { Inter, Oswald } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const oswald = Oswald({ subsets: ["latin"], variable: "--font-oswald" });

export const metadata: Metadata = {
  title: "Fantaclasse — Asta Fantacalcio Live",
  description:
    "Gestisci l'asta del fantacalcio in tempo reale: tabellone, rilanci dal telefono, crediti e rose sempre aggiornati.",
};

export const viewport: Viewport = {
  themeColor: "#07090c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className="dark">
      <body className={`${inter.variable} ${oswald.variable} min-h-dvh`}>{children}</body>
    </html>
  );
}
