import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import App from './App';
import './index.css';

// -------------------------------------------------------------
// Application bootstrap: router → auth provider → routes.
// AuthProvider sits inside the router so auth-aware pages can navigate.
// -------------------------------------------------------------

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <AuthProvider>
      <App />
    </AuthProvider>
  </BrowserRouter>,
);
