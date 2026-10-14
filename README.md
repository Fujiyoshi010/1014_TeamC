# 会場 04 キャンセル待ち (React + Hono + TypeScript / pnpm)

## 要件対応

1. **椅子は「参加」と「未定」の合計**: `packages/waitlist` の `countChairs()` が `intent==="attending" || "maybe"` かつ `status==="confirmed"` を数える。`POST /api/events/:eventId/rsvps` は空きがなければ `waitlisted + position` で返す。
2. **空きが出たら先頭を自動繰り上げ**: `cancelParticipant()` が FIFO (`createdAt`, `seq` 昇順) で1名だけ繰り上げ。`DELETE .../rsvps/:id` と `PATCH .../capacity` がこれを実行する。排他は `EventStore.withLock(eventId)` で直列化。
3. **繰り上がりはメール通知**: Hono は `Mailer.sendPromotion()` を繰り上げ順に呼ぶ。既定は `InMemoryMailer` (履歴保持+console)。本番は SMTP/Resend/SES 等の実装に差し替え。送信失敗しても繰り上げは取り消さず `warnings` で返す。

## 起動

```bash
pnpm install
pnpm --filter @opencd/api dev   # http://localhost:8787
pnpm --filter @opencd/web dev   # http://localhost:5173
```

## テスト

```bash
pnpm test
```
