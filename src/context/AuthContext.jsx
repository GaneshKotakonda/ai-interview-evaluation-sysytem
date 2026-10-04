import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  updateProfile,
} from 'firebase/auth';
import { auth } from '../firebase';
import { setAuthTokenProvider } from '../services/api';

// Attach the signed-in user's ID token to every backend request.
setAuthTokenProvider(() => (auth.currentUser ? auth.currentUser.getIdToken() : null));

// -------------------------------------------------------------
// Firebase authentication state shared through React context.
// `loading` stays true until Firebase reports the initial session, so
// ProtectedRoute never redirects a signed-in user to /login on refresh.
// -------------------------------------------------------------

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  // Create the account, then store the display name and refresh the user
  // object so the new name is visible immediately.
  const signup = async (fullName, email, password) => {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(credential.user, { displayName: fullName });
    await credential.user.reload();
    setUser(auth.currentUser);
    return credential.user;
  };
  
  const login = (email, password) => signInWithEmailAndPassword(auth, email, password);
  const resetPassword = (email) => sendPasswordResetEmail(auth, email);
  const logout = () => signOut(auth);

  // Firebase mutates the same User object in place, so bump a counter to
  // give consumers a new context value after a profile change.
  const [profileVersion, setProfileVersion] = useState(0);

  const updateDisplayName = async (fullName) => {
    await updateProfile(auth.currentUser, { displayName: fullName });
    await auth.currentUser.reload();
    setUser(auth.currentUser);
    setProfileVersion((version) => version + 1);
  };

  // Firebase requires a recent sign-in before a password change, so confirm
  // the current password first.
  const changePassword = async (currentPassword, newPassword) => {
    const current = auth.currentUser;
    const credential = EmailAuthProvider.credential(current.email, currentPassword);
    await reauthenticateWithCredential(current, credential);
    await updatePassword(current, newPassword);
  };

  const value = useMemo(
    () => ({
      user, loading, profileVersion, signup, login, resetPassword, logout, updateDisplayName, changePassword,
    }),
    [user, loading, profileVersion],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Hook for components; throws if used outside <AuthProvider>.
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
