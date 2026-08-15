import type { Metadata } from "next";
import { Big_Shoulders_Display, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const display = Big_Shoulders_Display({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display",
});
const body = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Watchtower",
  description: "Surprise pop quizzes for AI agents, judged by independent validators.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning is required here: this app reads
    // localStorage-backed wallet state on mount, which necessarily
    // differs between the server-rendered shell and the client's
    // first real render. Without this, React logs a scary but
    // harmless warning on every load.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body suppressHydrationWarning className="font-body bg-abyss text-paper min-h-screen">
        {children}
      </body>
    </html>
  );
}