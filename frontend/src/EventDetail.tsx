import { useEffect, useState } from "react";
import {
  api,
  formatDateTime,
  STATUS_LABEL,
  type EventDetail,
  type EventSummary03,
  type HistoryEntry,
  type RsvpStatus,
} from "./api";

export function EventDetailView({
  eventId,
  onBack,
  onChanged,
}: {
  eventId: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<RsvpStatus>("attend");
  const [message, setMessage] = useState("");
  const [newCapacity, setNewCapacity] = useState("");
  // 03 一覧と集計（追加表示用。既存stateは触らない）
  const [summary03, setSummary03] = useState<EventSummary03 | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  async function load() {
    try {
      const data = await api.getEvent(eventId);
      setEvent(data);
      // 03は別APIで取得（失敗しても既存表示は壊さない）
      try {
        setSummary03(await api.getSummary03(eventId));
        setHistory(await api.getHistory(eventId));
      } catch {
        /* 03取得失敗時は非表示のまま */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "取得に失敗しました");
    }
  }

  useEffect(() => {
    load();
  }, [eventId]);

  async function submitRsvp(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    try {
      const updated = await api.answer(eventId, {
        name: name.trim(),
        status,
      });
      setEvent(updated);
      setMessage(`${name.trim()} さんの回答を「${STATUS_LABEL[status]}」で保存しました (締め切りまでは何度でも変更可)`);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "回答に失敗しました");
    }
  }

  async function submitCapacity(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    try {
      const updated = await api.updateCapacity(eventId, Number(newCapacity));
      setEvent(updated);
      setNewCapacity("");
      setMessage(`定員を ${updated.capacity} 名に変更しました`);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "定員の変更に失敗しました");
    }
  }

  if (!event) return <p>読み込み中... {error && <span style={{color:"red"}}>{error}</span>}</p>;

  return (
    <div>
      <button onClick={onBack}>← 一覧に戻る</button>
      <h2>{event.title}</h2>
      <p>開催日時: {formatDateTime(event.datetime)}</p>
      <p>
        定員: {event.capacity} 名 (参加 {event.counts.attend} / 不参加{" "}
        {event.counts.decline} / 未定 {event.counts.maybe})
      </p>
      <p>
        回答締め切り: {formatDateTime(event.deadline)}{" "}
        {event.isClosed ? "(締め切り済み)" : "(受付中)"}
      </p>
      {error && <p style={{ color: "red" }}>{error}</p>}
      {message && <p style={{ color: "green" }}>{message}</p>}

      <section style={{ border: "1px solid #ccc", padding: 12, margin: "16px 0" }}>
        <h3>定員を増やす (主催者用)</h3>
        <form onSubmit={submitCapacity}>
          <input
            type="number"
            min={event.capacity}
            step={1}
            placeholder={`現在 ${event.capacity} 名`}
            value={newCapacity}
            onChange={(e) => setNewCapacity(e.target.value)}
            required
          />{" "}
          <button type="submit">定員を変更</button>
        </form>
      </section>

      <section style={{ border: "1px solid #ccc", padding: 12, margin: "16px 0" }}>
        <h3>02 出欠を回答する (登録不要・名前だけ)</h3>
        {event.isClosed ? (
          <p>締め切りを過ぎたため回答できません。</p>
        ) : (
          <form onSubmit={submitRsvp}>
            <div>
              <label>
                名前:{" "}
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="名前のみ (メール不要)"
                />
              </label>
            </div>
            <div>
              {(Object.keys(STATUS_LABEL) as RsvpStatus[]).map((s) => (
                <label key={s} style={{ marginRight: 12 }}>
                  <input
                    type="radio"
                    name="status"
                    checked={status === s}
                    onChange={() => setStatus(s)}
                  />{" "}
                  {STATUS_LABEL[s]}
                </label>
              ))}
            </div>
            <button type="submit">回答する (何度でも上書き可)</button>
          </form>
        )}
      </section>

      <section>
        <h3>回答一覧 ({event.rsvps.length})</h3>
        <ul>
          {event.rsvps.map((r) => (
            <li key={r.name}>
              {r.name}: {STATUS_LABEL[r.status]}
            </li>
          ))}
        </ul>
      </section>

      {/* 03 一覧と集計（追加セクション。01/02のUI・APIは無変更） */}
      {summary03 && (
        <section style={{ border: "2px solid #333", padding: 12, margin: "16px 0" }}>
          <h3>
            03 一覧と集計 {summary03.finalized && <span style={{ color: "red" }}>【確定】</span>}
          </h3>
          <p>
            固定締切: {formatDateTime(summary03.fixedDeadline)}（開催日前日23:59固定）
          </p>
          <p>
            <strong>参加: {summary03.counts.attend}名</strong> ／ 不参加:{" "}
            {summary03.counts.decline}名 ／ 未定: {summary03.counts.maybe}名
            （※未定は数えない）
          </p>
          <h4>{summary03.finalized ? "確定名簿（繰り上げなし）" : "参加者一覧"}</h4>
          <ul>
            {summary03.participants.map((p) => (
              <li key={p.name}>{p.name}</li>
            ))}
          </ul>
          <h4>変更履歴（いつ・誰が・何に変えたか）</h4>
          {history.length === 0 ? (
            <p>履歴はまだありません。</p>
          ) : (
            <table
              border={1}
              cellPadding={6}
              style={{ borderCollapse: "collapse", width: "100%" }}
            >
              <thead>
                <tr>
                  <th>いつ</th>
                  <th>誰が</th>
                  <th>変更</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{formatDateTime(h.at)}</td>
                    <td>{h.actor}</td>
                    <td>
                      {h.from ? STATUS_LABEL[h.from] : "（新規）"} →{" "}
                      {STATUS_LABEL[h.to]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
