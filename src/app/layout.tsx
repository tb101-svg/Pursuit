import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { LiveRefresh } from "@/components/LiveRefresh";
import { BottomNav } from "@/components/BottomNav";
import { Sidebar } from "@/components/Sidebar";
import { relTime } from "@/lib/format";
import { countDueTasks, demoTerms, listSources } from "@/lib/repo";
import { getProfile, initials } from "@/lib/profile";
import { DEMO_BOOT_SCRIPT, DemoMode } from "@/components/DemoMode";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Pursuit",
  description: "Job search command centre",
  appleWebApp: { capable: true, title: "Pursuit", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0B0D12",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const profile = getProfile();
  const sources = listSources().map((s) => ({ ...s, lastSync: s.last_sync_at ? relTime(s.last_sync_at) : null }));
  return (
    <html lang="en-AU" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Demo mode must apply before the first paint, so names never flash on screen. */}
        <script dangerouslySetInnerHTML={{ __html: DEMO_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-screen">
        {/* Soft colour behind the glass. Fixed so it stays put while scrolling. */}
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-56 -left-44 size-[420px] rounded-full bg-[#3B5BDB] opacity-50 blur-[90px] md:size-[640px] md:blur-[130px]" />
          <div className="absolute top-40 -right-36 size-[360px] rounded-full bg-[#7C3AED] opacity-30 blur-[90px] md:size-[540px] md:blur-[130px]" />
          <div className="absolute -bottom-72 left-[40%] h-[600px] w-[760px] rounded-full bg-[#0EA5A4] opacity-20 blur-[140px]" />
        </div>
        <div className="relative flex min-h-screen">
          <Sidebar sources={sources} dueSteps={countDueTasks()} user={{ name: profile.name, initials: initials(profile) }} />
          <main className="min-w-0 flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
            <DemoMode terms={demoTerms()} />
            {children}
          </main>
        </div>
        <BottomNav />
        <LiveRefresh />
      </body>
    </html>
  );
}
