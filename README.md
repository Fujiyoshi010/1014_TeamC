# イベント出欠アプリ

React + Hono + TypeScript (pnpm)

## 構成

- `backend/` Hono API (`:3001`)
- `frontend/` React + Vite (`:5173`)

## 起動

```sh
pnpm install
pnpm --filter backend dev   # API
pnpm --filter frontend dev  # UI
```

## 仕様対応

1. イベントはタイトル・開催日時・定員を持つ (`POST /api/events`)
2. 締め切りはイベントごとに主催者が自由に設定 (`deadline`)
3. 定員はあとから増やせる (`PATCH /api/events/:id`、減少は400)
4. 回答は名前だけ (登録・メール不要)
5. 参加 / 不参加 / 未定 の3択 (`attend` / `decline` / `maybe`)
6. 締め切りまでは何度でも上書き可 (同名は最後の回答で上書き、締め切り後は400)
```
