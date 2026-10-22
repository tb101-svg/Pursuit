/** Starts background sync once the server is up (Node runtime only). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/sync/scheduler");
    startScheduler();
  }
}
