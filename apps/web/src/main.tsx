import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/noto-sans-arabic';
import './styles/globals.css';
import './styles/print.css';
import './i18n';
import { App } from './app';
import { installZodI18n } from '@/lib/zod-i18n';

// Validation messages must be i18n keys before any schema is used.
installZodI18n();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
