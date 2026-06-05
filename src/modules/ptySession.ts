import { Terminal } from "@xterm/xterm";
import { spawn, ChildProcess } from "child_process";

const UNIX_PSEUDOTERMINAL_PY = `
import sys
from os import execvp, read, write, waitpid, waitstatus_to_exitcode
from fcntl import ioctl
from pty import fork
from termios import TIOCSWINSZ
from struct import pack
from selectors import DefaultSelector, EVENT_READ

_CHUNK_SIZE = 1024
_CMDIO = 3

def write_all(fd, data):
    while data:
        data = data[write(fd, data):]

def main():
    pid, pty_fd = fork()
    if pid == 0:
        execvp(sys.argv[1], sys.argv[1:])
    
    with DefaultSelector() as selector:
        selector.register(pty_fd, EVENT_READ, lambda: forward_pty(pty_fd))
        selector.register(0, EVENT_READ, lambda: forward_stdin(pty_fd))
        selector.register(_CMDIO, EVENT_READ, lambda: handle_resize(pty_fd))
        
        while True:
            events = selector.select()
            for key, _ in events:
                key.data()
            if not any(key.data for key in selector.get_map().values() if key.data):
                break
    
    waitstatus_to_exitcode(waitpid(pid, 0)[1])

def forward_pty(pty_fd):
    try:
        data = read(pty_fd, _CHUNK_SIZE)
    except OSError:
        data = b""
    if not data:
        sys.exit(0)
    write_all(1, data)

def forward_stdin(pty_fd):
    try:
        data = read(0, _CHUNK_SIZE)
    except OSError:
        data = b""
    if not data:
        sys.exit(0)
    write_all(pty_fd, data)

def handle_resize(pty_fd):
    try:
        data = read(_CMDIO, _CHUNK_SIZE)
    except OSError:
        data = b""
    if not data:
        return
    for line in data.decode("UTF-8", "strict").splitlines():
        rows, columns = (int(s.strip()) for s in line.split("x", 2))
        ioctl(pty_fd, TIOCSWINSZ, pack("HHHH", rows, columns, 0, 0))

if __name__ == "__main__":
    main()
`;

export interface PtySessionOptions {
	opencodePath: string;
	cwd: string;
	args: string[];
}

export class PtySession {
	ptyProcess: ChildProcess | null = null;

	spawn(terminal: Terminal, options: PtySessionOptions): void {
		const pythonPath = process.platform === "win32" ? "python" : "python3";

		if (process.platform === "win32") {
			terminal.writeln("\r\nWindows PTY support not yet implemented.\r\n");
			return;
		}

		this.ptyProcess = spawn(pythonPath, ["-c", UNIX_PSEUDOTERMINAL_PY, options.opencodePath, ...options.args], {
			cwd: options.cwd,
			env: process.env as NodeJS.ProcessEnv,
			stdio: ["pipe", "pipe", "pipe", "pipe"],
		});

		this.ptyProcess.stdout?.on("data", (chunk: Buffer) => {
			terminal.write(chunk);
		});

		this.ptyProcess.stderr?.on("data", (chunk: Buffer) => {
			console.error("PTY stderr:", chunk.toString());
		});

		this.ptyProcess.on("exit", (code, signal) => {
			terminal.writeln(`\r\n[Process exited with code ${code ?? signal}]\r\n`);
			this.ptyProcess = null;
		});

		this.ptyProcess.on("error", (err) => {
			terminal.writeln(`\r\nError: ${err.message}\r\n`);
		});

		// Initial resize after spawn
		setTimeout(() => {
			this.sendResize(terminal);
		}, 300);
	}

	kill(): void {
		if (this.ptyProcess) {
			this.ptyProcess.kill();
			this.ptyProcess = null;
		}
	}

	getStdin(): import("stream").Writable | null {
		return this.ptyProcess?.stdin ?? null;
	}

	writeStdin(data: string): void {
		if (this.ptyProcess?.stdin) {
			this.ptyProcess.stdin.write(data);
		}
	}

	sendResize(terminal: Terminal): void {
		if (!this.ptyProcess) return;
		const { rows, cols } = terminal;
		const cmdio = (this.ptyProcess as any).stdio?.[3];
		if (cmdio && typeof cmdio.write === "function") {
			cmdio.write(`${rows}x${cols}\n`);
		}
	}
}
