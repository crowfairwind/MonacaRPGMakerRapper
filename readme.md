# Monaca AdMob iframe ブリッジ仕様まとめ（引き継ぎ用）

## 1. 全体構成

本構成は、RPGツクールMV（iframe内：子）と Monaca / Cordova（親）間で
postMessage を用いて AdMob（admob-plus）を制御するための
最小・安全構成である。

ゲーム進行は常に 子側主導 とし、
親側は 広告処理と結果応答のみ を担当する。

---

## 2. 通信方式

- 通信手段：window.postMessage
- 受信：親 window.addEventListener('message', ...)
- 返信先：必ず ev.source に返す（iframe ID 等は使用しない）
- 識別：token によるフィルタリングのみ

---

## 3. JSON フォーマット

### 子 → 親

```json
{
  "token": "...",
  "cmd": "...",
  "id": "ca-app-pub-xxxx/yyyy"
}
```

### 親 → 子

```json
{
  "token": "...",
  "cmd": "...",
  "ok": true
}
```

- id には AdMob の広告ユニットID を指定する
- AdMob App ID は Monaca クラウドIDE側で管理するため、payload には含めない

---

## 4. cmd 一覧（現状）

- inter_ad_load
  インタースティシャル広告をロード
- inter_ad_show
  ロード済み広告を表示

---

## 5. 子側（RPGツクールMV プラグイン）仕様

- ゲーム進行は停止しない（待機・ブロック処理なし）
- 同一 cmd はクールダウン時間内に再送不可（連打抑止のみ）
- ロード成功でなければ show を送らない運用が可能
- cmd ごとに最新ステータスを保持
- get_status <cmd> <varId> でステータス取得
  - 1 : 成功
  - 0 : 失敗
  - -1 : 未取得
- inter_ad_show の応答時に After 共通イベントを1つだけ呼び出す

---

## 6. 親側（Monaca / admob-plus）仕様

- 受信した cmd に対して必ず1回だけ応答を返す
- 二重応答防止フラグを持つ
- inter_ad_load
  - load 実行 → 成否を返す
- inter_ad_show
  - ロード済みのみ show
  - 未ロードは即 false
- autoshow は行わない
- タイムアウト付き Promise.race で応答漏れを防止

---

## 7. 運用ルール（重要）

- 広告を出すかどうかの最終判断は必ずゲーム側で行う
- ロード失敗時は show を送らず、
  After 共通イベントを直接呼んで次へ進める
- 想定外タイミングで広告が出ることを防ぐため autoshow を禁止
- 親JSが完全にクラッシュした場合は
  アプリ全体停止とみなし、回避対象外とする

---

## 8. ログ出力指針

デバッグおよび検証のため、
親・子ともに以下の項目でログを統一する

- cmd
- id
- ok
