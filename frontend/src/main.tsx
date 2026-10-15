import { registerSW } from "virtual:pwa-register";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { queryClient } from "./app/queryClient";
import { router } from "./app/router";
import "./i18n";
import "./styles.css";

const root = document.getElementById("root");

if (root === null) {
  throw new Error("The React root element is missing.");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

// Chrome refuses a service worker without a certificate it trusts, and logs
// the refusal as a console error even once caught. On localhost the
// certificate is the stack's own self-signed one, so it is not even tried
// there; elsewhere a refusal leaves the app working without offline support.
if (window.location.hostname !== "localhost") {
  registerSW({ onRegisterError: () => {} });
}
