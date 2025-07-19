import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { Provider } from 'react-redux'
import { store, initializeVaultState } from './redux/store'
import { routeTree } from './routeTree.gen'
import "./styles.css";

const router = createRouter({ routeTree })
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Initialize vault state from settings store
initializeVaultState()

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Provider store={store}>
      <RouterProvider router={router}/>
    </Provider>
  </React.StrictMode>,
);
