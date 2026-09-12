import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

import fs from 'fs';

export default defineConfig(() => {
  let localFirebaseConfig: Record<string, string> = {};
  try {
    const cfgPath = path.resolve(__dirname, '../firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      localFirebaseConfig = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    }
  } catch {}

  const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || localFirebaseConfig.apiKey || '';
  const firebaseAuthDomain = process.env.FIREBASE_AUTH_DOMAIN || process.env.VITE_FIREBASE_AUTH_DOMAIN || localFirebaseConfig.authDomain || '';
  const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || localFirebaseConfig.projectId || '';
  const firebaseStorageBucket = process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET || localFirebaseConfig.storageBucket || '';
  const firebaseMessagingSenderId = process.env.FIREBASE_MESSAGING_SENDER_ID || process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || localFirebaseConfig.messagingSenderId || '';
  const firebaseAppId = process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID || localFirebaseConfig.appId || '';
  const firestoreDatabaseId = process.env.FIRESTORE_DATABASE_ID || localFirebaseConfig.firestoreDatabaseId || 'ai-studio-recoup-df4ad748-bea6-4a97-bf98-8446bf4888f4';

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_FIREBASE_API_KEY': JSON.stringify(firebaseApiKey),
      'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': JSON.stringify(firebaseAuthDomain),
      'import.meta.env.VITE_FIREBASE_PROJECT_ID': JSON.stringify(firebaseProjectId),
      'import.meta.env.VITE_FIREBASE_STORAGE_BUCKET': JSON.stringify(firebaseStorageBucket),
      'import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(firebaseMessagingSenderId),
      'import.meta.env.VITE_FIREBASE_APP_ID': JSON.stringify(firebaseAppId),
      'import.meta.env.VITE_FIRESTORE_DATABASE_ID': JSON.stringify(firestoreDatabaseId),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
