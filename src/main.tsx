import React from "react";
import ReactDOM from "react-dom/client";
import { AccountGate } from "./Account";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "./styles.css";
import "./studio.css";
import "./website.css";
import "./workspace-navigation.css";
const App = React.lazy(() => import("./App"));
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AccountGate>
      <React.Suspense
        fallback={
          <div className="boot">
            <h1>AutoPPT</h1>
            <p>正在打开工作区…</p>
          </div>
        }
      >
        <App />
      </React.Suspense>
    </AccountGate>
  </React.StrictMode>,
);
