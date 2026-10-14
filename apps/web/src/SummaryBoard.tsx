import { useEffect, useState } from "react";
import {
  fetchHistory,
  fetchSummary,
  intentLabel,
  type EventSummary03,
  type HistoryEntry,
} from "./api";

/** 03 一覧と集計セクション（04の確定/待機表示はEventBoardのまま） */
export function SummaryBoard({ eventId }: { eventId: string }) {
  const [summary, setSummary] = useState<EventSummary03 | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, h] = await Promise.all([fetchSummary(eventId), fetchHistory(eventId)]);
        if (alive) {
          setSummary(s);
          setHistory(h);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [eventId]);

  if (error) return <p style={{ color: "red" }}>{error}</p>;
  if (!summary) return <p>集計を読み込み中…</p>;

  return (
    <section style={{ border: "2px solid #333", padding: 12 }}>
      <h2>
        03 一覧と集計 {summary.finalized && <span style={{ color: "red" }}>【確定】</span>}
      </h2>
      {summary.fixedDeadline && (
        <p>固定締切: {new Date(summary.fixedDeadline).toLocaleString("ja-JP")}（開催日前日23:59固定）</p>
      )}
      <p>
        <strong>参加: {summary.attendingCount}名</strong> ／ 未定: {summary.maybeCount}名
        （※未定は数えない。椅子数は別に {summary.chairsNeeded} 脚）
      </p>
      <h3>{summary.finalized ? "確定名簿（繰り上げなし）" : "参加者一覧"}</h3>
      {summary.participants.length === 0 ? (
        <p>参加者はまだいません。</p>
      ) : (
        <ul>
          {summary.participants.map((p) => (
            <li key={p.id}>
              {p.name} [{intentLabel[p.intent]}]
            </li>
          ))}
        </ul>
      )}
      <h3>変更履歴（いつ・誰が・何に変えたか）</h3>
      {history.length === 0 ? (
        <p>履歴はまだありません。</p>
      ) : (
        <table border={1} cellPadding={6} style={{ borderCollapse: "collapse", width: "100%" }}>
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
                <td>{new Date(h.at).toLocaleString("ja-JP")}</td>
                <td>{h.actor}</td>
                <td>
                  {h.from ?? "（新規）"} → {h.to}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
