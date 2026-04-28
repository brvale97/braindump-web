import { storageKeys, state } from "./state.js";

export function initPwa({ banner, installButton, dismissButton }) {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    if (!localStorage.getItem(storageKeys.installDismissed)) {
      banner.classList.remove("hidden");
    }
  });

  installButton.addEventListener("click", async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    banner.classList.add("hidden");
  });

  dismissButton.addEventListener("click", () => {
    banner.classList.add("hidden");
    localStorage.setItem(storageKeys.installDismissed, "1");
  });

  window.addEventListener("appinstalled", () => {
    banner.classList.add("hidden");
    state.deferredInstallPrompt = null;
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js");
  }
}
