import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
// auth voorlopig uit
// import { getAuth } from "firebase/auth";
import { firebaseConfig } from "./firebaseConfig";
import { getAuth } from "firebase/auth";


const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db = getFirestore(app);
// export const auth = getAuth(app);

export const auth = getAuth(app);

console.log(
  "Firebase project:",
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
);

