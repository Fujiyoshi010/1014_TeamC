import { useCallback, useEffect, useState } from "react";
import { api, formatDateTime, type EventSummary } from "./api";
import { EventForm } from "./EventForm";
import { EventDetailView } from "./EventDetail";

export default function App() {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setEvents(await api.listEvents());
    } catch (err) {
      setError(err instanceof Error ? err.message : "取得に失敗しました");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (selectedId) {
    return (
      <main style={{ maxWidth: 640, margin: "0 auto", padding: 16 }}>
        <EventDetailView
          eventId={selectedId}
          onBack={() => setSelectedId(null)}
          onChanged={load}
        />
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: 16 }}>
      <h1>イベント出欠</h1>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <EventForm onCreated={load} />
      <h2>イベント一覧</h2>
      {events.length === 0 ? (
        <p>イベントはまだありません。</p>
      ) : (
        <ul>
          {events.map((e) => (
            <li key={e.id} style={{ marginBottom: 8 }}>
              <button
                onClick={() => setSelectedId(e.id)}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  color: "blue",
                  textDecoration: "underline",
                  cursor: "pointer",
                  fontSize: "1rem",
                }}
              >
                {e.title}
              </button>{" "}
              ({formatDateTime(e.datetime)} / 定員 {e.capacity} 名 / 参加{" "}
              {e.counts.attend} 名 / 締切 {formatDateTime(e.deadline)})
              {e.isClosed ? " [締切済]" : ""}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
