import { createFileRoute } from "@tanstack/react-router";
import SettingsScreen from "../screens/Settings";
import { VaultModalProvider } from '../components/Vault/VaultContext';

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
