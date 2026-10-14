import { useState } from "react";
import { EventBoard } from "./EventBoard";
import { RsvpForm } from "./RsvpForm";
import { useEvent } from "./useEvent";

const EVENT_ID = "demo";

export default function App() {
  const { state, error, loading, refresh } = useEvent(EVENT_ID);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <main style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>会場: キャンセル待ち</h1>
      {msg && <p role="status">{msg}</p>}
      {loading && <p>読み込み中…</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
      <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
        <RsvpForm
          eventId={EVENT_ID}
          onDone={(m) => {
            setMsg(m);
            refresh();
          }}
        />
        {state && (
          <EventBoard state={state} eventId={EVENT_ID} onChange={refresh} />
        )}
      </div>
    </main>
  );
}
