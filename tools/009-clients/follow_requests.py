# python requests — リダイレクトは既定で追う。
# requests は Session.rebuild_auth() でホストが変わると Authorization を落とす。
import sys, requests
r = requests.get(sys.argv[1], headers={"Authorization": "Bearer MEASUREMENT-TOKEN"}, timeout=20)
print(r.text.strip())
