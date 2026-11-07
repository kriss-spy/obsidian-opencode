// Deterministic native Windows peer: no OpenCode profile, network, or credentials.
if (process.argv.includes("--help")) {
	console.log("opencode [project]  start opencode tui");
	process.exit(0);
}
const sixel = Buffer.from("G1AwOzE7MHEiMTsxOzMyOzE2IzA7MjsxMDA7MDswIzE7Mjs5MzswOzcjMjsyOzg3OzA7MTMjMzsyOzgwOzA7MjAjNDsyOzczOzA7MjcjNTsyOzY3OzA7MzMjNjsyOzYwOzA7NDAjNzsyOzUzOzA7NDcjODsyOzQ3OzA7NTMjOTsyOzQwOzA7NjAjMTA7MjszMzswOzY3IzExOzI7Mjc7MDs3MyMxMjsyOzIwOzA7ODAjMTM7MjsxMzswOzg3IzE0OzI7NzswOzkzIzE1OzI7MDswOzEwMCMwITMyQCQjMSEzMkEkIzIhMzJDJCMzITMyRyQjNCEzMk8kIzUhMzJfLSM2ITMyQCQjNyEzMkEkIzghMzJDJCM5ITMyRyQjMTAhMzJPJCMxMSEzMl8tIzEyITMyQCQjMTMhMzJBJCMxNCEzMkMkIzE1ITMyRy0bXA==", "base64");
const titles = ["Skills", "Select model", "Sessions"];
let current = 0, input = "", ready = false;
process.stdin.setRawMode(true);
process.stdin.resume();
function draw() {
	process.stdout.write(`\x1b[2;1H${titles[current]}                         esc\x1b[K\x1b[4;1H  alpha  first item\x1b[K\x1b[5;1H  beta   second item with description\x1b[K\x1b[7;1H\x1b[K`);
}
function finish() {
	if (ready) return;
	ready = true;
	process.stdout.write("\x1b[2J\x1b[H\x1b[?1000h\x1b[?1006h");
	if (input.includes(";4;")) process.stdout.write("\x1b[10;1H" + sixel);
	draw();
	process.stdout.write("\x1b[8;1HPROTOCOL_READY");
}
process.stdin.on("data", data => {
	input += data.toString();
	if (!ready && /\x1b\[\?[^c]*c/.test(input)) finish();
	if (ready && /\x1b\[<0;\d+;5m/.test(input)) {
		process.stdout.write(`\x1b[7;1HCLICKED:${titles[current]}:beta\x1b[K`);
		input = "";
	}
	if (ready && input.endsWith("n")) {
		current = (current + 1) % titles.length;
		input = "";
		draw();
	}
});
process.stdout.write("\x1b[c");
setTimeout(finish, 800);
