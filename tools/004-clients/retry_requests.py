# requests は urllib3 の上に載るが、既定の Retry は 0 回。
import sys
import requests

r = requests.get(sys.argv[1])
print(f"status={r.status_code} retry-after={r.headers.get('Retry-After')}")
print(f"requests={requests.__version__}")
