import { createRouter, RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { initializeVaultState, store } from "./redux/store";
import { routeTree } from "./routeTree.gen";
import "./styles.css";
import { ThemeProvider } from "./hooks/withTheme";
import "./i18n";
import { deepLinkService } from "./services/deepLinkService";

const router = createRouter({ routeTree });
declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

// Initialize vault state from settings store
initializeVaultState().then(() => {
	// Initialize global deep link service
	console.log("[Main] Initializing global deep link service");
	deepLinkService.initialize({
		dispatch: store.dispatch,
		getState: store.getState,
	});
	console.log("[Main] Global deep link service initialized");

	ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
		<React.StrictMode>
			<Provider store={store}>
				<ThemeProvider>
					<RouterProvider router={router} />
				</ThemeProvider>
			</Provider>
		</React.StrictMode>,
	);
});
