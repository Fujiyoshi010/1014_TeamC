import { useState } from "react";
import { api, localToISO } from "./api";

export function EventForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [datetime, setDatetime] = useState("");
  const [capacity, setCapacity] = useState("20");
  const [deadline, setDeadline] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api.createEvent({
        title: title.trim(),
        datetime: localToISO(datetime),
        capacity: Number(capacity),
        deadline: localToISO(deadline),
      });
      setTitle("");
      setDatetime("");
      setCapacity("20");
      setDeadline("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "作成に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      style={{ border: "1px solid #ccc", padding: 16, marginBottom: 24 }}
    >
      <h2>01 イベントを作る</h2>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <div>
        <label>
          タイトル:{" "}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>
      </div>
      <div>
        <label>
          開催日時:{" "}
          <input
            type="datetime-local"
            value={datetime}
            onChange={(e) => setDatetime(e.target.value)}
            required
          />
        </label>
      </div>
      <div>
        <label>
          定員:{" "}
          <input
            type="number"
            min={1}
            step={1}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            required
          />
        </label>
      </div>
      <div>
        <label>
          回答締め切り (主催者が自由に設定):{" "}
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            required
          />
        </label>
      </div>
      <button type="submit" disabled={saving}>
        {saving ? "作成中..." : "イベントを作成"}
      </button>
    </form>
  );
}
