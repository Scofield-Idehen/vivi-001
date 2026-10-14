import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ApiError } from './lib/api.ts';
import { applyAppBrand } from './lib/brand.ts';
import { SessionProvider } from './lib/session.tsx';
import './styles.css';

applyAppBrand();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Retry only what might succeed on retry: network trouble and server errors.
      retry: (failures, error) =>
        failures < 2 && (!(error instanceof ApiError) || error.status === 0 || error.status >= 500),
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </SessionProvider>
  </StrictMode>,
);
