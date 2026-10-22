import "server-only";
import { EventEmitter } from "node:events";

export interface BusMessage {
  type: "change";
  jobId: number | null;
}

// One emitter per server process; open browser tabs listen via /api/stream.
const g = globalThis as unknown as { __jobsBus?: EventEmitter };
export const bus: EventEmitter = (g.__jobsBus ??= new EventEmitter().setMaxListeners(100));

export function notify(jobId: number | null) {
  const msg: BusMessage = { type: "change", jobId };
  bus.emit("change", msg);
}
