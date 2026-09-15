import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyBpp0FqGNpnts0ZcPlfgS9SHLRZrKVPEpA",
  authDomain: "ai-evaluation-40c8a.firebaseapp.com",
  projectId: "ai-evaluation-40c8a",
  storageBucket: "ai-evaluation-40c8a.firebasestorage.app",
  messagingSenderId: "1095480319512",
  appId: "1:1095480319512:web:6c10cac48a2fd925b52d6d"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
