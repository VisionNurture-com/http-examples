# Net::HTTP に自動再試行は無い（接続の再試行はあるが応答コードは見ない）。
require "net/http"
require "uri"

uri = URI.parse(ARGV[0])
res = Net::HTTP.get_response(uri)
puts "status=#{res.code} retry-after=#{res['Retry-After']}"
puts "ruby=#{RUBY_VERSION}"
