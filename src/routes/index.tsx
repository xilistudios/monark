import { createFileRoute } from "@tanstack/react-router";
import { VaultModalProvider } from "../components/Vault/VaultContext";
import HomeScreen from "../screens/Home";

const Component = () => {
	return (
		<VaultModalProvider>
			<HomeScreen />
		</VaultModalProvider>
	);
};
export const Route = createFileRoute("/")({
	component: Component,
});
