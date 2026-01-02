"use client";

import { useState } from "react";
import { db } from "@/lib/firebase";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

export default function TestPage() {
  const [status, setStatus] = useState<string>("");

  async function writeTest() {
    setStatus("Writing...");

    // Forceer timeout zodat hij niet blijft hangen
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout after 8s")), 8000)
    );

    try {
      const writePromise = addDoc(collection(db, "smokeTests"), {
        message: "Hello from Bamboozle!",
        createdAt: serverTimestamp(),
      });

      const docRef = (await Promise.race([
        writePromise,
        timeout,
      ])) as any;

      setStatus(`✅ Wrote doc: ${docRef.id}`);
    } catch (err: any) {
      console.error("Firestore write error:", err);
      setStatus(`❌ Error: ${err?.message ?? String(err)}`);
    }
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Firestore Smoke Test</h1>

      <button
        onClick={writeTest}
        style={{
          padding: "10px 16px",
          border: "1px solid black",
          borderRadius: 8,
          cursor: "pointer",
        }}
      >
        Write test doc
      </button>

      <p style={{ marginTop: 16 }}>{status}</p>
    </main>
  );
}
