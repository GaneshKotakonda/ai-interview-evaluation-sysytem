// -------------------------------------------------------------
// Firebase initialisation (authentication only)
// -------------------------------------------------------------
// Values come from VITE_FIREBASE_* variables in the root .env so each
// environment can point at its own Firebase project. The fallbacks are the
// project's existing public web config. Firebase web API keys identify the
// project and are safe to ship to browsers; access is protected by Firebase
// Auth settings (authorised domains), not by keeping this key secret.
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const env = import.meta.env;

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyBpp0FqGNpnts0ZcPlfgS9SHLRZrKVPEpA',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'ai-evaluation-40c8a.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'ai-evaluation-40c8a',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'ai-evaluation-40c8a.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '1095480319512',
  appId: env.VITE_FIREBASE_APP_ID || '1:1095480319512:web:6c10cac48a2fd925b52d6d',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
