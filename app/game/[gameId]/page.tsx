"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";

export default function GamePlayerPage() {
  const params = useParams();
  const gameId = params.gameId as string;

  const [uid, setUid] = useState<string>("");
  const [gameStatus, setGameStatus] = useState<string>("loading");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        await signInAnonymously(auth);
        return;
      }
      setUid(user.uid);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!gameId) return;
    const ref = doc(db, "games", gameId);
    return onSnapshot(ref, (snap) => {
      const data = snap.data() as any;
      setGameStatus(data?.status ?? "missing");
    });
  }, [gameId]);

  return (
    <main style={{ padding: 24 }}>
      <h1>Bamboozle</h1>
      <p>
        Game: <b>{gameId}</b>
      </p>
      <p>
        Player: <b>{uid || "..."}</b>
      </p>

      <hr style={{ margin: "16px 0" }} />

      {gameStatus !== "live" ? (
        <div style={{ padding: 12, border: "1px solid #444", borderRadius: 8 }}>
          ⏳ Waiting for the host to start the game...
          <div style={{ opacity: 0.7, marginTop: 8 }}>
            (Game status: {gameStatus})
          </div>
        </div>
      ) : (
        <div style={{ padding: 12, border: "1px solid #444", borderRadius: 8 }}>
          ✅ Game is live! (Volgende stap: hier komt je echte player UI)
        </div>
      )}
    </main>
  );
}