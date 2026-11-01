import { createContext, useContext } from "react";
export const AccountSessionContext = createContext<string | null>(null);
export const useExpectedAccountId = () => useContext(AccountSessionContext);
const eventName = "promenadis-session-changed";
export function notifySessionChanged() {
  window.dispatchEvent(new Event(eventName));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(eventName);
    channel.postMessage("changed");
    channel.close();
  }
}
export function subscribeSessionChanges(refresh: () => void) {
  const visible = () => {
    if (document.visibilityState === "visible") refresh();
  };
  window.addEventListener(eventName, refresh);
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", visible);
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(eventName);
  if (channel) channel.onmessage = refresh;
  return () => {
    window.removeEventListener(eventName, refresh);
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", visible);
    channel?.close();
  };
}
