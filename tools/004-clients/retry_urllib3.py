# urllib3 の Retry は既定で respect_retry_after_header=True。
# 429 を status_forcelist に入れたときに Retry-After の秒数だけ待つかを測る。
import sys
import urllib3

url = sys.argv[1]
retries = urllib3.Retry(total=2, status_forcelist=[429], backoff_factor=0)
http = urllib3.PoolManager(retries=retries)
try:
    r = http.request("GET", url)
    print(f"status={r.status}")
except Exception as e:  # 再試行を使い切ると例外になる実装がある
    print(f"exhausted: {type(e).__name__}")
print(f"urllib3={urllib3.__version__}")
