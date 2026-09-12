import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB4fv0cTZDtoBcELnucSIrvzYGcpV3Ikgg",
  authDomain: "noted-lead-499910-e4.firebaseapp.com",
  projectId: "noted-lead-499910-e4",
  storageBucket: "noted-lead-499910-e4.firebasestorage.app",
  messagingSenderId: "1078037640859",
  appId: "1:1078037640859:web:9f1e5c51c5dc867094783e",
  measurementId: ""
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, "ai-studio-recoup-df4ad748-bea6-4a97-bf98-8446bf4888f4");

export const googleProvider = new GoogleAuthProvider();

export {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
};
