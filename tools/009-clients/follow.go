// net/http — 既定でリダイレクトを追う。
// Go 1.8 以降、ドメインが変わると Authorization などの機微なヘッダを落とす。
package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

func main() {
	c := &http.Client{Timeout: 20 * time.Second}
	req, _ := http.NewRequest("GET", os.Args[1], nil)
	req.Header.Set("Authorization", "Bearer MEASUREMENT-TOKEN")
	res, err := c.Do(req)
	if err != nil {
		fmt.Println(`{"auth":"error"}`)
		return
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	fmt.Println(strings.TrimSpace(string(b)))
}
