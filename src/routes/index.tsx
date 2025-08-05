import { createFileRoute } from '@tanstack/react-router';
import HomeScreen from '../screens/Home';
import { VaultModalProvider } from '../components/Vault/VaultContext';

const Component = () => {
  return (
    <VaultModalProvider>
      <HomeScreen />
    </VaultModalProvider>
  );
};
export const Route = createFileRoute('/')({
  component: Component,
});
