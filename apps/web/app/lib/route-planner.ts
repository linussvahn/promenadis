import { type ComputeRequest, type ComputeResult, computeRoute } from "./route-compute";

let worker: Worker | null | undefined;
let nextId = 1;

function getWorker() {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL("./routing.worker.ts", import.meta.url), { type: "module" });
  } catch {
    worker = null;
  }
  return worker;
}

/** Plans in a Web Worker; falls back to the main thread when workers fail. */
export function planRoute(request: ComputeRequest): Promise<ComputeResult> {
  const instance = typeof Worker === "undefined" ? null : getWorker();
  if (!instance) return Promise.resolve().then(() => computeRoute(request));
  const id = nextId++;
  return new Promise((resolve) => {
    const onMessage = (
      message: MessageEvent<{ id: number; result?: ComputeResult; error?: true }>,
    ) => {
      if (message.data.id !== id) return;
      instance.removeEventListener("message", onMessage);
      resolve(message.data.result ?? computeRoute(request));
    };
    instance.addEventListener("message", onMessage);
    instance.addEventListener(
      "error",
      () => {
        worker = null;
        resolve(computeRoute(request));
      },
      { once: true },
    );
    instance.postMessage({ id, request });
  });
}
