import { createFileRoute } from "@tanstack/react-router";
import { VaultModalProvider } from "../components/Vault/VaultContext";
import SettingsScreen from "../screens/Settings";

const Component = () => {
	return (
		<VaultModalProvider>
			<SettingsScreen />
		</VaultModalProvider>
	);
};

export const Route = createFileRoute("/settings")({
	component: Component,
});
