import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";
import { AuthProvider } from "./context/AuthContext";
import { CompanyProvider } from "./context/CompanyContext";
import { NetworkProvider } from "./context/NetworkContext";
import { SyncProvider } from "./context/SyncContext";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <NetworkProvider>
        <AuthProvider>
          <SyncProvider>
            <CompanyProvider>
              <App />
            </CompanyProvider>
          </SyncProvider>
        </AuthProvider>
      </NetworkProvider>
    </BrowserRouter>
  </StrictMode>
);
