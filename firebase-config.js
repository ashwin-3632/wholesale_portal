// firebase/firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyChXBKEjO4tny8tD7542WPN8-urhd0Wq6M",
  authDomain: "portal-wholesale.firebaseapp.com",
  projectId: "portal-wholesale",
  storageBucket: "portal-wholesale.firebasestorage.app",
  messagingSenderId: "764492212664",
  appId: "1:764492212664:web:de60cf03cf04867b78874d",
  measurementId: "G-40HG5269J8"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

enableIndexedDbPersistence(db).catch((err) => {
  console.warn("Offline persistence error:", err.code);
});

export { db };
