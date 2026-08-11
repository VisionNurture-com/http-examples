# 000-smoke の期待値

土台の版。ここが動いたら他シナリオの実測値も測り直します。

```json
{
  "scenario": "000-smoke",
  "mode": "M1",
  "values": {
    "app_node_version": "24.19.0",
    "app_express_version": "5.2.1"
  },
  "config_refs": [
    { "path": "nginx/conf.d/000-base.conf", "must_contain": "proxy_pass http://app_upstream;" }
  ]
}
```
