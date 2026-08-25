# ruby — open-uri の request_specific_fields で宛先を検査してから資格情報を出す。
#
# 素の URI.open("...", "Authorization" => "...") は、渡したヘッダをリダイレクト先へも
# そのまま送る。request_specific_fields に Proc を渡すと、リダイレクトを含む
# 各リクエストの直前に宛先 URI で評価されるため、行き先を見て出し分けられる。
#
# 🔴 ここでは「最初のオリジン（scheme + host + port）と一致するときだけ出す」形にする。
#    ホスト名だけを見る書き方だとポート差やスキーム差を素通しするため。
require "open-uri"

url = ARGV[0]
origin = URI.parse(url)

guard = lambda do |uri|
  same_origin =
    uri.scheme == origin.scheme &&
    uri.host   == origin.host &&
    uri.port   == origin.port
  same_origin ? { "Authorization" => "Bearer MEASUREMENT-TOKEN" } : {}
end

begin
  body = URI.open(url, request_specific_fields: guard, read_timeout: 20).read
  puts body.strip
rescue => e
  puts %({"auth":"error","detail":"#{e.class}"})
end
