# 004-auth-dialog — 記事に載せる値

> この表の値は `results/004-auth-dialog/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "004-auth-dialog",
  "mode": "M2",
  "values": {
    "os": "macOS 26.5.2",
    "engines": {
      "chrome": "151.0.7922.140",
      "firefox": "154.0",
      "safari": "26.5.2"
    },
    "dialog_shown_basic": ["chrome", "firefox", "safari"],
    "dialog_shown_bearer": [],
    "dialog_shown_stripped": [],
    "body_visible_bearer": ["chrome", "firefox", "safari"],
    "body_visible_stripped": ["chrome"],
    "firefox_dialog_style": "tab-modal（URL バーの下に出る）",
    "chrome_safari_dialog_style": "window-modal（画面中央に出る）"
  }
}
```

## 読み方

**`Basic` の 401 では 3 エンジンとも出ました。`Bearer` では 1 つも出ませんでした。**

| エンジン（実アプリ） | `Basic` の 401 | `Bearer` の 401 | プロキシで剥がした 401 |
|---|:--:|:--:|:--:|
| Google Chrome 151.0.7922.140 | **出る**（画面中央） | 出ない | 出ない |
| Firefox 154.0 | **出る**（URL バー直下） | 出ない | 未測定 |
| Safari 26.5.2 | **出る**（画面中央） | 出ない | 未測定 |

- ダイアログが出たとき、**本文は表示されません**。自分で書いたエラーメッセージは読者に届きません
- Firefox だけ出方が違い、**タブに紐づく形**で URL バーの直下に出ます
- Safari は `Your password will be sent unencrypted.` と添えます（平文の口で測ったため）
- **引き金は 401 そのものではなく challenge のスキーム**です。`Bearer` に変えるだけで出なくなります

> **測定装置の差**: 同じ 401 を Playwright の headless で測るとダイアログは存在せず、本文がそのままページへ渡ります。headed の Chromium だけがナビゲーションを打ち切りました（プロンプトを自前でキャンセルした跡）。**自動化の結果だけでは「出ない」と言えません。**
