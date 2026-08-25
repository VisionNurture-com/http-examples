// java.net.http.HttpClient — followRedirects(NORMAL) を明示する（既定は NEVER）
import java.net.URI;
import java.net.http.*;
import java.time.Duration;

public class Follow {
    public static void main(String[] args) throws Exception {
        HttpClient c = HttpClient.newBuilder()
                .followRedirects(HttpClient.Redirect.NORMAL)
                .connectTimeout(Duration.ofSeconds(20))
                .build();
        HttpRequest req = HttpRequest.newBuilder(URI.create(args[0]))
                .header("Authorization", "Bearer MEASUREMENT-TOKEN")
                .GET().build();
        HttpResponse<String> res = c.send(req, HttpResponse.BodyHandlers.ofString());
        System.out.println(res.body().trim());
    }
}
