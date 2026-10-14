import { useState } from "react";
import { intentLabel, postRsvp, type RsvpIntent } from "./api";

export function RsvpForm({
  eventId,
  onDone,
}: {
  eventId: string;
  onDone: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [intent, setIntent] = useState<RsvpIntent>("attending");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await postRsvp(eventId, { name, email, intent });
      onDone(
        r.status === "confirmed"
          ? `${name}様: 席を確保しました(参加+未定で椅子を用意しています)`
          : `${name}様: 定員超過のためキャンセル待ち ${r.position}番目です`,
      );
      setName("");
      setEmail("");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 8, maxWidth: 360 }}>
      <h2>申し込み (参加 / 未定)</h2>
      <input
        placeholder="名前"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <input
        placeholder="メール (繰り上げ通知先)"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <label>
        意思:
        <select
          value={intent}
          onChange={(e) => setIntent(e.target.value as RsvpIntent)}
        >
          {(Object.keys(intentLabel) as RsvpIntent[]).map((k) => (
            <option key={k} value={k}>
              {intentLabel[k]}
            </option>
          ))}
        </select>
      </label>
      <button disabled={busy} type="submit">
        {busy ? "送信中…" : "申し込む"}
      </button>
      {err && <p style={{ color: "red" }}>{err}</p>}
      <small>椅子は「参加」と「未定」の合計で用意します。合計が定員を超えたら自動でキャンセル待ちになります。</small>
    </form>
  );
}
