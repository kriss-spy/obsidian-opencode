import { Terminal } from "@xterm/xterm";
import { spawn, ChildProcess, execFileSync } from "child_process";
import { Notice } from "obsidian";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { WINDOWS_PTY_NATIVE_X64_BASE64 } from "../pty/windowsPtyNativeX64";
import { WINDOWS_PTY_NATIVE_ARM64_BASE64 } from "../pty/windowsPtyNativeArm64";

const FLATPAK_OVERRIDE_COMMAND = "flatpak override --user --talk-name=org.freedesktop.flatpak md.obsidian.Obsidian";

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

const COMMON_BIN_DIRS = [
	".opencode/bin",
	".local/bin",
	"bin",
] as const;

const WINDOWS_PTY_HOST_JS = String.raw`
const fs = require("fs");
const [nativePath, colsText, rowsText, file, ...args] = process.argv.slice(1);
const native = require(nativePath);
const env = Object.entries(process.env).filter(([, value]) => value !== undefined).map(([key, value]) => key + "=" + value);
let handle;
let ready = false;
let pendingResize;
let pendingWrites = [];
const result = native.spawn(file, args, env, process.cwd(), Number(colsText), Number(rowsText),
  (data) => {
    if (!ready) {
      ready = true;
      if (pendingResize) native.resize(handle, pendingResize.cols, pendingResize.rows);
      pendingResize = undefined;
      for (const pendingWrite of pendingWrites) native.write(handle, pendingWrite);
      pendingWrites = [];
    }
    process.stdout.write(data);
  },
  (info) => process.exit(info.exitCode || 0));
handle = result.handle;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (data) => {
  if (ready) native.write(handle, data);
  else pendingWrites.push(data);
});
let pending = "";
fs.createReadStream(null, { fd: 3 }).setEncoding("utf8").on("data", (data) => {
  pending += data;
  let newline;
  while ((newline = pending.indexOf("\n")) >= 0) {
    const [cols, rows] = pending.slice(0, newline).split("x").map(Number);
    pending = pending.slice(newline + 1);
    if (cols > 0 && rows > 0) {
      if (ready) native.resize(handle, cols, rows);
      else pendingResize = { cols, rows };
    }
  }
});
process.on("SIGTERM", () => native.kill(handle));
`;

function executableNames(executable: string): string[] {
	if (process.platform !== "win32" || path.extname(executable)) {
		return [executable];
	}
	const extensions = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
	return extensions.map((extension) => `${executable}${extension}`);
}

function resolveExecutablePath(executable: string): string {
	if (path.isAbsolute(executable)) {
		for (const candidate of executableNames(executable)) {
			try {
				fs.accessSync(candidate, fs.constants.X_OK);
				return candidate;
			} catch {
				continue;
			}
		}
		return executable;
	}
	const pathDirs = (process.env.PATH || "").split(path.delimiter);
	for (const dir of pathDirs) {
		if (!dir) continue;
		for (const candidate of executableNames(executable)) {
			const fullPath = path.join(dir, candidate);
			try {
				fs.accessSync(fullPath, fs.constants.X_OK);
				return fullPath;
			} catch {
				continue;
			}
		}
	}
	const homeDir = os.homedir();
	for (const sub of COMMON_BIN_DIRS) {
		for (const candidate of executableNames(executable)) {
			const fullPath = path.join(homeDir, sub, candidate);
			try {
				fs.accessSync(fullPath, fs.constants.X_OK);
				return fullPath;
			} catch {
				continue;
			}
		}
	}
	return executable;
}

function augmentPath(originalPath?: string): string {
	const homeDir = os.homedir();
	const userDirs = COMMON_BIN_DIRS.map((sub) => path.join(homeDir, sub));
	return [...userDirs, ...(originalPath || "").split(path.delimiter)].filter(Boolean).join(path.delimiter);
}

function createChildEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	for (const key of Object.keys(env)) {
		if (key.toLowerCase() === "path") delete env[key];
	}
	env.PATH = augmentPath(process.env.PATH);
	return env;
}

const materializedWindowsPty = new Map<string, string>();

function materializeWindowsPtyNative(architecture: "x64" | "arm64"): string {
	const existing = materializedWindowsPty.get(architecture);
	if (existing) return existing;
	const base64 = architecture === "arm64" ? WINDOWS_PTY_NATIVE_ARM64_BASE64 : WINDOWS_PTY_NATIVE_X64_BASE64;
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-opencode-"));
	const nativeModule = path.join(directory, `zigpty-${architecture}.node`);
	fs.writeFileSync(nativeModule, Buffer.from(base64, "base64"), { flag: "wx", mode: 0o600 });
	materializedWindowsPty.set(architecture, nativeModule);
	return nativeModule;
}

export interface PtySessionOptions {
	opencodePath: string;
	cwd: string;
	args: string[];
	editorPort?: number;
}

enum PtyBackend {
	Unix,
	WindowsConPty,
}

export class PtySession {
	ptyProcess: ChildProcess | null = null;
	private backend: PtyBackend | null = null;

	spawn(terminal: Terminal, options: PtySessionOptions): void {
		if (process.platform === "win32") {
			const windowsBuild = Number(os.release().split(".")[2]);
			if (Number.isFinite(windowsBuild) && windowsBuild > 0 && windowsBuild < 17763) {
				terminal.writeln("\r\nOpenCode requires Windows 10 version 1809 or later for ConPTY support.\r\n");
				return;
			}
		}

		// Resolve executable path, searching common user-local bin directories
		// that may not be in process.env.PATH (desktop-launched Electron apps
		// don't read shell init files like .bashrc / .zshrc).
		let executable = resolveExecutablePath(options.opencodePath);
		let args = [...options.args];

		const isFlatpak = process.platform !== "win32" && (fs.existsSync("/.flatpak-info") || process.env.FLATPAK_ID);
		if (isFlatpak) {
			const editorEnv = options.editorPort ? [`--env=OPENCODE_EDITOR_SSE_PORT=${options.editorPort}`] : [];
			args = ["--host", "--env=TERM=xterm-256color", ...editorEnv, executable, ...args];
			executable = "flatpak-spawn";
		}

		// Augment PATH so the Python PTY proxy's execvp can find the binary
		const env = createChildEnv();
		env.TERM = "xterm-256color";
		if (options.editorPort) {
			env.OPENCODE_EDITOR_SSE_PORT = String(options.editorPort);
		}

		let ptyProcess: ChildProcess;
		if (process.platform === "win32") {
			this.backend = PtyBackend.WindowsConPty;
			const nodeExecutable = resolveExecutablePath("node.exe");
			let nodeArchitecture: string;
			try {
				nodeArchitecture = execFileSync(nodeExecutable, ["-p", "process.arch"], {
					encoding: "utf8",
					windowsHide: true,
				}).trim();
			} catch (error) {
				terminal.writeln(`\r\nOpenCode Windows PTY requires Node.js on PATH: ${String(error)}\r\n`);
				return;
			}
			if (nodeArchitecture !== "x64" && nodeArchitecture !== "arm64") {
				terminal.writeln(`\r\nUnsupported Windows Node.js architecture: ${nodeArchitecture}\r\n`);
				return;
			}
			try {
				ptyProcess = spawn(nodeExecutable, [
					"-e",
					WINDOWS_PTY_HOST_JS,
					materializeWindowsPtyNative(nodeArchitecture),
					String(Math.min(32767, Math.max(1, terminal.cols))),
					String(Math.min(32767, Math.max(1, terminal.rows))),
					executable,
					...args,
				], {
					cwd: options.cwd,
					env,
					stdio: ["pipe", "pipe", "pipe", "pipe"],
					windowsHide: true,
				});
			} catch (error) {
				this.backend = null;
				const message = error instanceof Error ? error.message : String(error);
				terminal.writeln(`\r\nUnable to start the OpenCode Windows PTY: ${message}\r\n`);
				return;
			}
		} else {
			this.backend = PtyBackend.Unix;
			ptyProcess = spawn("python3", ["-c", UNIX_PSEUDOTERMINAL_PY, executable, ...args], {
				cwd: options.cwd,
				env,
				stdio: ["pipe", "pipe", "pipe", "pipe"],
			});
		}
		this.ptyProcess = ptyProcess;

		ptyProcess.stdout?.on("data", (chunk: Buffer) => {
			const str = chunk.toString();
			if (str.includes("org.freedesktop.DBus.Error.ServiceUnknown")) {
				new Notice(`Additional sandbox permissions are required. Run '${FLATPAK_OVERRIDE_COMMAND}' on your host system to allow command execution.`, 15000);
			}
			terminal.write(chunk);
		});

		ptyProcess.stderr?.on("data", (chunk: Buffer) => {
			const str = chunk.toString();
			console.error("PTY stderr:", str);
			if (this.backend === PtyBackend.WindowsConPty) {
				terminal.write(chunk);
			}
			if (str.includes("org.freedesktop.DBus.Error.ServiceUnknown")) {
				new Notice(`Additional sandbox permissions are required. Run '${FLATPAK_OVERRIDE_COMMAND}' on your host system to allow command execution.`, 15000);
			}
		});

		ptyProcess.on("exit", (code, signal) => {
			if (this.ptyProcess === ptyProcess) {
				terminal.writeln(`\r\n[Process exited with code ${code ?? signal}]\r\n`);
				this.ptyProcess = null;
			}
		});

		ptyProcess.on("error", (err) => {
			terminal.writeln(`\r\nError: ${err.message}\r\n`);
		});

	}

	kill(): void {
		if (this.ptyProcess) {
			const ptyProcess = this.ptyProcess;
			this.ptyProcess = null;
			if (this.backend === PtyBackend.WindowsConPty && ptyProcess.pid) {
				const taskkill = spawn("taskkill.exe", ["/pid", String(ptyProcess.pid), "/T", "/F"], {
					stdio: "ignore",
					windowsHide: true,
				});
				const fallback = () => ptyProcess.kill();
				taskkill.on("error", fallback);
				taskkill.on("exit", (code) => {
					if (code !== 0) fallback();
				});
			} else {
				ptyProcess.kill();
			}
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
		if (this.backend === PtyBackend.WindowsConPty) {
			const cmdio = this.ptyProcess.stdio?.[3] as import("stream").Writable | undefined;
			cmdio?.write(`${cols}x${rows}\n`);
			return;
		}
		const cmdio = this.ptyProcess.stdio?.[3] as import("stream").Writable | undefined;
		if (cmdio && typeof cmdio.write === "function") {
			cmdio.write(`${rows}x${cols}\n`);
		}
	}

}
