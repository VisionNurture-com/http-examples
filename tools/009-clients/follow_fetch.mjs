// Web 標準の fetch。node は undici、bun は独自実装。
const res = await fetch(process.argv[2], { headers: { Authorization: "Bearer MEASUREMENT-TOKEN" } });
console.log((await res.text()).trim());
