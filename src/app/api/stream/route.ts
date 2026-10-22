import { bus, type BusMessage } from "@/lib/bus";

export const dynamic = "force-dynamic";

/** Server-sent events: one message per data change, for LiveRefresh. */
export async function GET(req: Request) {
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const onChange = (msg: BusMessage) => write(`data: ${JSON.stringify(msg)}\n\n`);
      const ping = setInterval(() => write(": ping\n\n"), 25_000);
      bus.on("change", onChange);
      cleanup = () => {
        clearInterval(ping);
        bus.off("change", onChange);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
      write(": connected\n\n");
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
