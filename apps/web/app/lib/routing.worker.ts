/// <reference lib="webworker" />
import { type ComputeRequest, computeRoute } from "./route-compute";

// Route computation stays in the browser; nothing here is sent anywhere.
self.onmessage = (message: MessageEvent<{ id: number; request: ComputeRequest }>) => {
  try {
    const result = computeRoute(message.data.request);
    self.postMessage({ id: message.data.id, result });
  } catch {
    self.postMessage({ error: true, id: message.data.id });
  }
};
