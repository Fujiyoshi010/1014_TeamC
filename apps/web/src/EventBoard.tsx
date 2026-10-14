import { cancelRsvp, intentLabel, type EventState } from "./api";

export function EventBoard({
  state,
  eventId,
  onChange,
}: {
  state: EventState;
  eventId: string;
  onChange: () => void;
}) {
  async function cancel(id: string, name: string) {
    if (!confirm(`${name}様の予約を取り消しますか? 空きが出れば先頭が自動繰り上げされます。`))
      return;
    const r = await cancelRsvp(eventId, id);
    alert(
      r.promotions.length > 0
        ? `繰り上げ: ${r.promotions.map((p) => p.email).join(", ")} にメール通知しました`
        : "キャンセルしました",
    );
    onChange();
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section>
        <h2>
          {state.name} (定員 {state.capacity} / 椅子 {state.chairsNeeded} / 空き{" "}
          {state.freeSeats})
        </h2>
      </section>
      <section>
        <h3>確定 ({state.confirmed.length})</h3>
        <ul>
          {state.confirmed.map((p) => (
            <li key={p.id}>
              {p.name} [{intentLabel[p.intent]}] {p.email}{" "}
              <button onClick={() => cancel(p.id, p.name)}>キャンセル</button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>キャンセル待ち ({state.waitlist.length})</h3>
        <ol>
          {state.waitlist.map((p) => (
            <li key={p.id}>
              {p.position}番目: {p.name} [{intentLabel[p.intent]}] {p.email}{" "}
              <button onClick={() => cancel(p.id, p.name)}>取り下げ</button>
            </li>
          ))}
        </ol>
        {state.waitlist.length === 0 && <p>待機者はいません</p>}
      </section>
    </div>
  );
}
