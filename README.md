# 会場 04 キャンセル待ち + 03 一覧と集計 (React + Hono + TypeScript / pnpm)

イベント出欠管理の monorepo。`04 キャンセル待ち`（椅子数・FIFO繰り上げ・メール通知）が中核で、`03 一覧と集計`（参加集計・変更履歴・開催日締切）が追加されている。

## 技術スタック

- パッケージ管理: pnpm 10.18.1 (workspace: `apps/*`, `packages/*`)
- 言語: TypeScript 5.6.3 (strict, `tsconfig.base.json` 共有: ES2022 / bundler / react-jsx)
- API: Hono 4.7 + `@hono/node-server` 1.13, `tsx` watch で開発
- Web: React 19 + Vite 6 + `@vitejs/plugin-react`
- テスト: Vitest 3 (各パッケージに `test` スクリプト)

## ディレクトリ構成

```text
.
├── apps/api/                  # @opencd/api: Hono バックエンド (:8787)
│   └── src/
│       ├── app.ts             # 全エンドポイント・集計・締切判定 (createApp)
│       ├── store.ts           # EventStore (インメモリ + withLock)
│       ├── mailer.ts          # Mailer IF + InMemoryMailer
│       ├── index.ts           # serve() エントリ
│       └── app.test.ts        # API テスト6件
├── apps/web/                  # @opencd/web: React フロント (:5173)
│   ├── index.html             # lang=ja, title「会場 キャンセル待ち」
│   ├── vite.config.ts         # /api → http://localhost:8787 proxy
│   └── src/
│       ├── main.tsx           # StrictMode + App
│       ├── App.tsx            # EVENT_ID=demo固定, RsvpForm+EventBoard+SummaryBoard
│       ├── api.ts             # fetch ラッパ + 型 (EventState, EventSummary03, HistoryEntry)
│       ├── useEvent.ts        # 5秒ポーリングで GET /api/events/:id
│       ├── RsvpForm.tsx       # 申込フォーム (名前/メール/参加or未定)
│       ├── EventBoard.tsx     # 04表示: 容量/椅子/空き, 確定/待機 + キャンセル
│       └── SummaryBoard.tsx   # 03表示: 集計・確定名簿・履歴テーブル
├── packages/waitlist/         # @opencd/waitlist: 純粋ドメインロジック (依存なし)
│   └── src/
│       ├── index.ts           # countChairs/register/cancel/applyCapacityChange 等
│       └── index.test.ts      # ドメインテスト
├── backend/                   # 空 (node_modules のみ。実体は apps/api)
├── frontend/dist/             # 旧ビルド残骸のみ (タイトル「イベント出欠」。実体は apps/web)
├── package.json               # build/test/dev:api/dev:web スクリプト
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

> `backend/`, `frontend/` は現行コードではない。API は `apps/api`、Web は `apps/web` を使うこと。

## ドメイン仕様

### 04 キャンセル待ち (`packages/waitlist/src/index.ts`)

型: `RsvpIntent = "attending" | "maybe"`, `ParticipantStatus = "confirmed" | "waitlisted" | "cancelled"`, `Participant{id,name,email,intent,status,createdAt,seq,promotedAt?}`。

- **要件1 椅子数**: `consumesChair()` は `attending`/`maybe` ともに true。`countChairs()` は `status==="confirmed"` かつ椅子消費の件数。`registerParticipant(participants, capacity, input)` は `chairs < capacity` なら `confirmed`、そうでなければ `waitlisted + position (待機列長+1)`。
- **要件2 繰り上げ**: `cancelParticipant(participants, id, nowIso)` は指定 id を `cancelled` 化。キャンセル者が `confirmed` かつ椅子消費の場合のみ待機先頭を1名だけ `confirmed` 化 (`promotedAt` 付与)。順序は `getWaitlist()` の `(createdAt, seq)` 昇順 FIFO。既 `cancelled`/不明 id は無操作。待機者の取り下げでは繰り上げなし。二重キャンセルは冪等。
- **定員変更**: `applyCapacityChange(participants, newCapacity, nowIso)` は空きがある限り先頭から繰り上げ。縮小時は確定者を維持し超過を許容 (新規のみ待機)。
- **その他**: `getConfirmed()`, `changeIntent()` (椅子数不変のため待機列に影響なし), `assertValidCapacity()` (非負整数)。

### 03 一覧と集計 (`apps/api/src/app.ts`)

- `countAttending()`: `confirmed + attending` のみ数える (未定は除外。椅子数とは別指標)。`countMaybeConfirmed()` が未定確定数。`attendingRoster()` は参加確定のみを FIFO ソートして返す。
- `getFixedDeadline(eventDate)`: `YYYY-MM-DD` の前日 23:59:59 JST を締切とする。`isFixedClosed(eventDate)`: `eventDate` 未設定→締切なし (04互換)、設定済みで現在が締切超過→`true`。締切後は申込・キャンセル・定員変更を 403 で拒否し、名簿を固定 (繰り上げなし)。
- `HistoryEntry{id,eventId,at,actor,actorEmail?,kind:register|cancel|promote|capacity,from,to,detail?}` を register/cancel/promote/capacity ごとに追記 (追記のみ)。

## API (`apps/api/src/app.ts`, `store.ts`, `mailer.ts`)

`createApp(env?: {store, mailer})` が `Hono` を返す。`store` はインメモリ `EventStore` (イベント毎 `withLock(eventId)` プロミスチェーンで直列化、`nextSeq()` で `seq` 発番)。`mailer` 既定は `InMemoryMailer` (履歴 `sent[]` + console)。本番は SMTP/Resend/SES 等の `Mailer.sendPromotion()` 実装に差し替え。起動時に `demo` (会場イベント 定員2) を冪等 seed。

| メソッド | パス | 概要 |
|---|---|---|
| GET | `/api/events/:eventId` | 状態取得。`{id,name,capacity,chairsNeeded,freeSeats,confirmed,waitlist(+position),eventDate?,fixedDeadline,fixedClosed,attendingCount}`。404 なし時 |
| POST | `/api/events` | 作成。`{id,name,capacity,eventDate?}` → 201。400 (必須不備・eventDate形式)、409 (重複) |
| POST | `/api/events/:eventId/rsvps` | 申込。`{name,email(intent必須)}` を validate (email正規表現)。締切後 403。`withLock` + `registerParticipant` + history。201 `{status:confirmed\|waitlisted,participant,position?}`。404 なし時 |
| DELETE | `/api/events/:eventId/rsvps/:rsvpId` | キャンセル→FIFO繰り上げ→`mailer.sendPromotion()` を繰り上げ順に逐次呼出。失敗は繰り上げを取り消さず `warnings` に積む。`{cancelled,promotions,warnings,chairsNeeded}`。403 締切後、404 rsvp/eventなし |
| PATCH | `/api/events/:eventId/capacity` | 定員変更。`applyCapacityChange` + history + メール通知 (こちらは送信失敗時 throw)。403 締切後、400 形式不正、404 なし時 |
| GET | `/api/events/:eventId/history` | 履歴を `at` 降順で返す |
| GET | `/api/events/:eventId/summary` | 集計。`{capacity,eventDate?,fixedDeadline,fixedClosed,finalized,attendingCount,maybeCount,chairsNeeded,participants(確定名簿),confirmed,waitlist}` |

## Web (`apps/web/src/`)

- `App.tsx`: `EVENT_ID="demo"` 固定。`useEvent` + `msg` 表示。`RsvpForm` と `EventBoard` を横並び、下に `SummaryBoard`。
- `api.ts`: `intentLabel={attending:参加,maybe:未定}`、`fetchEvent/postRsvp/cancelRsvp/fetchSummary/fetchHistory` (非2xx は throw)。
- `RsvpForm.tsx`: 名前/メール/intent を `postRsvp`。成功時「席を確保しました」/「キャンセル待ち N番目です」、入力クリア。
- `EventBoard.tsx`: `定員/椅子/空き`、確定リスト (キャンセルbtn)、待機リスト (position番目 + 取り下げbtn)。`confirm()` 確認後に DELETE、繰り上げがあれば `alert` で通知先メール表示。
- `SummaryBoard.tsx`: `fetchSummary` + `fetchHistory` を初回取得。「03 一覧と集計」+ `finalized` 時【確定】バッジ、固定締切日時、参加N/未定M (椅子数併記)、確定名簿、履歴テーブル (いつ/誰が/変更 `from → to`)。
- `useEvent.ts`: 初回 + 5秒 interval で `fetchEvent` (`refresh` 返却)。

## 起動・ビルド・テスト

```bash
pnpm install
pnpm dev:api    # = pnpm --filter @opencd/api dev → tsx watch src/index.ts, http://localhost:8787 (PORTで上書き可)
pnpm dev:web    # = pnpm --filter @opencd/web dev → vite --port 5173, /api は 8787 にproxy
pnpm test       # pnpm -r test (waitlist + api の vitest, web は --passWithNoTests)
pnpm build      # pnpm -r build
```

個別: `pnpm --filter @opencd/api build|start|test` (`start` は `node dist/index.js`)、`pnpm --filter @opencd/web build|preview`、`pnpm --filter @opencd/waitlist build|test`。

## テスト内容

- `packages/waitlist/src/index.test.ts`: maybe も椅子消費、register の position 付与、capacity 0、FIFO 単発繰り上げ、待機取り下げで繰り上げなし、`createdAt→seq` 順、二重キャンセル冪等、定員増、changeIntent。
- `apps/api/src/app.test.ts` (6件): maybe で椅子消費→waitlist pos1、cancel で繰り上げ+メール、バリデーション 400、summary (参加2/未定1/椅子3)、history 1件、締切後は `fixedClosed=true` + POST 403。
