// net/http の Client に自動再試行は無い。429 をそのまま返すかを測る。
package main

import (
	"fmt"
	"net/http"
	"os"
	"runtime"
)

func main() {
	resp, err := http.Get(os.Args[1])
	if err != nil {
		fmt.Println("error:", err)
		return
	}
	defer resp.Body.Close()
	fmt.Printf("status=%d retry-after=%s\n", resp.StatusCode, resp.Header.Get("Retry-After"))
	fmt.Println("go=" + runtime.Version())
}
