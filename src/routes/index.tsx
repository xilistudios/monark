import { createFileRoute } from '@tanstack/react-router';
import HomeScreen from '../screens/Home';
import { VaultModalProvider } from '../components/Vault/VaultContext';

// Define search params type
type IndexSearch = {
  path?: string;
};

const Component = () => {
  return (
    <VaultModalProvider>
      <HomeScreen />
    </VaultModalProvider>
  );
};

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): IndexSearch => {
    return {
      path: typeof search.path === 'string' ? search.path : undefined,
    };
  },
  component: Component,
});
