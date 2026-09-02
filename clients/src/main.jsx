import React from "react";
import ReactDOM from "react-dom/client";

import "./styles/tokens.css";
import "./index.css";
import App from "./App";
import { ToastProvider } from "./context/ToastContext";
import Toast from "./components/Toast";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
      <Toast />
    </ToastProvider>
  </React.StrictMode>
);