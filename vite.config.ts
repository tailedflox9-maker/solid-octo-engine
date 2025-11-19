import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        // Supabase environment variables
        'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL),
        'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY),
        
        // AI Model environment variables (for AI assistant)
        'process.env.GOOGLE_API_KEY': JSON.stringify(env.VITE_GOOGLE_API_KEY || env.GEMINI_API_KEY || env.GOOGLE_API_KEY),
        'process.env.AI_MODEL': JSON.stringify(env.VITE_AI_MODEL || env.AI_MODEL || 'gemini-1.5-flash'),
        'process.env.MISTRAL_API_KEY': JSON.stringify(env.VITE_MISTRAL_API_KEY || env.MISTRAL_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
