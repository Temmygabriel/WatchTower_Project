import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning className="font-body bg-base text-ink min-h-screen">
        {children}
      </body>
    </html>
  );
}
