import { UnlockForm } from "./UnlockForm";

export const dynamic = "force-dynamic";

export default async function UnlockPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="flex min-h-[80vh] items-center justify-center px-5">
      <div className="glass flex w-full max-w-sm flex-col gap-5 rounded-2xl p-7">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG */}
        <img src="/brand/pursuit-lockup-dark.svg" alt="Pursuit" width={145} height={40} className="h-10 w-auto self-start" />
        <p className="text-sm text-muted">Enter your passcode. This device will stay unlocked for 90 days.</p>
        <UnlockForm next={next ?? "/"} />
      </div>
    </div>
  );
}
