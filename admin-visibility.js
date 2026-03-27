import { initializeApp, getApp, getApps } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBPqTTmRHkNffvsrP6iVteokpxJ5xzQkqw',
  authDomain: 'vestique-d6b6f.firebaseapp.com',
  projectId: 'vestique-d6b6f',
  storageBucket: 'vestique-d6b6f.firebasestorage.app',
  messagingSenderId: '517893374274',
  appId: '1:517893374274:web:fe371519fba987cee4c8db'
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

function setAdminUiVisible(isVisible) {
  const adminLink = document.getElementById('admin-link');
  const adminGear = document.getElementById('admin-gear');

  if (adminLink) adminLink.style.display = isVisible ? 'inline' : 'none';
  if (adminGear) adminGear.style.display = isVisible ? 'flex' : 'none';
}

async function isAdmin(user) {
  if (!user || !user.email) return false;

  try {
    const adminSnap = await getDoc(doc(db, 'admins', user.email));
    return adminSnap.exists();
  } catch (error) {
    console.error('Failed to verify admin access:', error);
    return false;
  }
}

setAdminUiVisible(false);

onAuthStateChanged(auth, async (user) => {
  const admin = await isAdmin(user);
  setAdminUiVisible(admin);
});
