import * as React from "react";
import * as ReactDOM from "react-dom/client";
import App from "./App";
import "./i18n/config";

import "./index.css";
import { AuthProvider } from "./components/AuthProvider";
import { FacilityProfileProvider } from "./components/FacilityProfileProvider";
import { ApplicationErrorBoundary } from "./components/ApplicationErrorBoundary";
import {
  claimReleaseReload,
  clearReleaseReloadMarker,
  RELEASE_RELOAD_WINDOW_MS,
} from "./lib/release-recovery";

window.addEventListener("vite:preloadError", (event) => {
  if (!claimReleaseReload(window.sessionStorage, window.location.pathname)) {
    return;
  }

  event.preventDefault();
  window.location.reload();
});

window.setTimeout(() => {
  clearReleaseReloadMarker(window.sessionStorage);
}, RELEASE_RELOAD_WINDOW_MS);

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function updateDarkClass(event?: MediaQueryListEvent) {
  const isDark = event?.matches ?? darkQuery.matches;
  document.documentElement.classList.toggle("dark", isDark);
}

updateDarkClass();
darkQuery.addEventListener("change", updateDarkClass);

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ApplicationErrorBoundary>
      <AuthProvider>
        <FacilityProfileProvider>
          <App />
        </FacilityProfileProvider>
      </AuthProvider>
    </ApplicationErrorBoundary>
  </React.StrictMode>,
);
