import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/noto-sans-arabic';
// The other typefaces of the settings page (Q50): declared here, downloaded only when chosen.
import '@fontsource-variable/vazirmatn';
import '@fontsource-variable/noto-kufi-arabic';
import '@fontsource-variable/noto-naskh-arabic';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
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
