// Bun の fetch は Web 標準の fetch。再試行の規定は無い。
const r = await fetch(Bun.argv[2]);
console.log(`status=${r.status} retry-after=${r.headers.get("retry-after")}`);
console.log(`bun=${Bun.version}`);
