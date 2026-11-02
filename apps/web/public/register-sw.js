// Registers the service worker after the first render. Updates are offered
// with a dismissible notice and applied only when the visitor chooses.
if ("serviceWorker" in navigator) {
  const english = document.documentElement.lang === "en";
  const text = english
    ? {
        later: "Later",
        message: "A new version of Promenadis is ready. Any walk you have started is kept.",
        update: "Update now",
      }
    : {
        later: "Senare",
        message: "En ny version av Promenadis finns. En påbörjad promenad behålls.",
        update: "Uppdatera nu",
      };
  let accepted = false;
  const offer = (registration) => {
    if (!registration.waiting || document.getElementById("sw-update")) return;
    const notice = document.createElement("div");
    notice.id = "sw-update";
    notice.className = "update-notice";
    notice.setAttribute("role", "status");
    const message = document.createElement("p");
    message.textContent = text.message;
    const update = document.createElement("button");
    update.type = "button";
    update.className = "primary-button";
    update.textContent = text.update;
    update.addEventListener("click", () => {
      accepted = true;
      registration.waiting?.postMessage("promenadis:activate-update");
    });
    const later = document.createElement("button");
    later.type = "button";
    later.className = "quiet-button";
    later.textContent = text.later;
    later.addEventListener("click", () => notice.remove());
    notice.append(message, update, later);
    document.body.append(notice);
  };
  // Assets and the page itself loaded before the worker took control; ask it
  // to keep copies so a walk started on the first visit survives a reload.
  const reportLoaded = () =>
    navigator.serviceWorker.controller?.postMessage({
      assets: performance.getEntriesByType("resource").map((entry) => entry.name),
      page: window.location.pathname,
      type: "promenadis:cache-loaded",
    });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (accepted) window.location.reload();
    else reportLoaded();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        reportLoaded();
        offer(registration);
        registration.addEventListener("updatefound", () => {
          registration.installing?.addEventListener("statechange", () => {
            if (navigator.serviceWorker.controller) offer(registration);
          });
        });
      })
      .catch(() => {
        // Offline support is progressive enhancement; never block the page.
      });
  });
}
