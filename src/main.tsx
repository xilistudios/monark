import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { Provider } from 'react-redux'
import { store, initializeVaultState } from './redux/store'
import { routeTree } from './routeTree.gen'
import "./styles.css";
import { ThemeProvider } from "./hooks/withTheme";
import  "./i18n";
const router = createRouter({ routeTree })
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Initialize vault state from settings store
initializeVaultState().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <Provider store={store}>
        <ThemeProvider>
          <RouterProvider router={router} />
        </ThemeProvider>
      </Provider>
    </React.StrictMode>,
  );

})

