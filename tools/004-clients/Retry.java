// java.net.http.HttpClient に自動再試行の設定は無い。429 をそのまま返すかを測る。
import java.net.URI;
import java.net.http.*;

public class Retry {
    public static void main(String[] args) throws Exception {
        HttpClient c = HttpClient.newHttpClient();
        HttpResponse<String> r = c.send(
            HttpRequest.newBuilder(URI.create(args[0])).build(),
            HttpResponse.BodyHandlers.ofString());
        System.out.println("status=" + r.statusCode()
            + " retry-after=" + r.headers().firstValue("retry-after").orElse("none"));
        System.out.println("java=" + Runtime.version());
    }
}
