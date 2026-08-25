# ruby — Net::HTTP はリダイレクトを自分では追わない。
# 標準ライブラリで追う道は open-uri なので、そちらで測る。
require "open-uri"
begin
  body = URI.open(ARGV[0], "Authorization" => "Bearer MEASUREMENT-TOKEN", :read_timeout => 20).read
  puts body.strip
rescue => e
  puts %({"auth":"error","detail":"#{e.class}"})
end
