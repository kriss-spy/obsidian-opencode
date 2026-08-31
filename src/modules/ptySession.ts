import { Terminal } from "@xterm/xterm";
import { spawn, ChildProcess, execFileSync } from "child_process";
import { Notice } from "obsidian";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { WINDOWS_PTY_NATIVE_X64_BASE64 } from "../pty/windowsPtyNativeX64";
import { WINDOWS_PTY_NATIVE_ARM64_BASE64 } from "../pty/windowsPtyNativeArm64";
import { WINDOWS_PTY_JOB_HOST_BASE64 } from "../pty/windowsPtyJobHost";

const FLATPAK_OVERRIDE_COMMAND = "flatpak override --user --talk-name=org.freedesktop.Flatpak md.obsidian.Obsidian";

// When the PTY proxy execs into `flatpak-spawn --host`, the host-side process
// has no controlling terminal, so the kernel never delivers SIGWINCH after
// TIOCSWINSZ (the winsize itself propagates, the signal does not). The TUI
// then keeps drawing at its startup size and overlaps itself on every
// terminal resize. This host-side supervisor polls the PTY winsize and
// forwards SIGWINCH explicitly. Must not contain single quotes (it is passed
// as one argv element to `sh -c`).
const FLATPAK_HOST_RESIZE_WRAPPER = `
"$@" 0<&0 &
pid=$!
last=""
while kill -0 "$pid" 2>/dev/null; do
  cur=$(stty size 2>/dev/null)
  if [ -n "$cur" ] && [ "$cur" != "$last" ]; then
    kill -WINCH "$pid" 2>/dev/null
    last="$cur"
  fi
  sleep 0.3
done
wait "$pid"
`;

const UNIX_PSEUDOTERMINAL_PY = `
import sys, os
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

    initial_size = os.environ.get("OPENCODE_PTY_INITIAL_SIZE", "")
    if initial_size:
        try:
            rows, columns = (int(s) for s in initial_size.split("x", 2))
            ioctl(pty_fd, TIOCSWINSZ, pack("HHHH", rows, columns, 0, 0))
        except (ValueError, OSError):
            pass

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
function start() {
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
}
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
fs.createReadStream(null, { fd: 4 }).once("data", start);
process.on("SIGTERM", () => {
  if (handle) native.kill(handle);
  else process.exit(0);
});
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
	const inheritedPath = Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1];
	for (const key of Object.keys(env)) {
		if (key.toLowerCase() === "path") delete env[key];
	}
	env.PATH = augmentPath(inheritedPath);
	return env;
}

const materializedWindowsPty = new Map<string, string>();
let materializedWindowsPtyJobHost: string | null = null;

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

function materializeWindowsPtyJobHost(): string {
	if (materializedWindowsPtyJobHost) return materializedWindowsPtyJobHost;
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-opencode-job-"));
	const executable = path.join(directory, "windows-pty-job-host.exe");
	fs.writeFileSync(executable, Buffer.from(WINDOWS_PTY_JOB_HOST_BASE64, "base64"), { flag: "wx", mode: 0o700 });
	materializedWindowsPtyJobHost = executable;
	return executable;
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

function childExit(child: ChildProcess | null): Promise<void> {
	if (!child || !child.pid || child.exitCode != null || child.signalCode != null) return Promise.resolve();
	return new Promise((resolve) => {
		const finish = () => {
			child.removeListener("exit", finish);
			resolve();
		};
		child.once("exit", finish);
	});
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
	return new Promise((resolve) => {
		const timeoutWindow = window;
		const timeout = timeoutWindow.setTimeout(() => resolve(null), timeoutMs);
		promise.then((value) => {
			timeoutWindow.clearTimeout(timeout);
			resolve(value);
		}, () => {
			timeoutWindow.clearTimeout(timeout);
			resolve(null);
		});
	});
}

export class PtySession {
	ptyProcess: ChildProcess | null = null;
	private backend: PtyBackend | null = null;
	private windowsJobProcess: ChildProcess | null = null;

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
			// Wrap the host command so SIGWINCH is forwarded on resize; the
			// kernel cannot deliver it across the flatpak portal boundary.
			args = ["--host", "--env=TERM=xterm-256color", ...editorEnv, "sh", "-c", FLATPAK_HOST_RESIZE_WRAPPER.trim(), "opencode-host-wrapper", executable, ...args];
			executable = "flatpak-spawn";
		}

		// Augment PATH so the Python PTY proxy's execvp can find the binary
		const env = createChildEnv();
		env.TERM = "xterm-256color";
		if (options.editorPort) {
			env.OPENCODE_EDITOR_SSE_PORT = String(options.editorPort);
		}
		// pty.fork() starts at 0x0, which the TUI cannot use. Apply the
		// terminal's current size to the PTY before the app starts.
		env.OPENCODE_PTY_INITIAL_SIZE = `${Math.min(65535, Math.max(1, terminal.rows))}x${Math.min(65535, Math.max(1, terminal.cols))}`;

		let ptyProcess: ChildProcess;
		if (process.platform === "win32") {
			this.backend = PtyBackend.WindowsConPty;
			let windowsPtyProcess: ChildProcess | null = null;
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
				ptyProcess = windowsPtyProcess = spawn(nodeExecutable, [
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
					stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
					windowsHide: true,
				});
				if (!ptyProcess.pid) throw new Error("Windows PTY host did not return a process ID");
				const jobProcess = spawn(materializeWindowsPtyJobHost(), [String(process.pid), String(ptyProcess.pid)], {
					stdio: ["ignore", "pipe", "pipe"],
					windowsHide: true,
				});
				this.windowsJobProcess = jobProcess;
				let jobReady = false;
				jobProcess.stdout?.once("data", () => {
					jobReady = true;
					const startPipe = ptyProcess.stdio?.[4] as import("stream").Writable | undefined;
					startPipe?.write("start\n");
				});
				jobProcess.stderr?.on("data", (chunk: Buffer) => {
					terminal.write(chunk);
				});
				jobProcess.once("error", (error) => {
					terminal.writeln(`\r\nUnable to secure the OpenCode process tree: ${error.message}\r\n`);
					ptyProcess.kill();
				});
				jobProcess.once("exit", (code) => {
					if (this.windowsJobProcess === jobProcess) this.windowsJobProcess = null;
					if (!jobReady && code !== 0) {
						terminal.writeln(`\r\nUnable to secure the OpenCode process tree (job host exited with code ${code}).\r\n`);
						ptyProcess.kill();
					}
				});
			} catch (error) {
				windowsPtyProcess?.kill();
				this.windowsJobProcess?.kill();
				this.windowsJobProcess = null;
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

	async kill(): Promise<void> {
		const windowsJobProcess = this.windowsJobProcess;
		this.windowsJobProcess = null;
		if (this.ptyProcess) {
			const ptyProcess = this.ptyProcess;
			this.ptyProcess = null;
			if (this.backend === PtyBackend.WindowsConPty && ptyProcess.pid) {
				const ptyExited = childExit(ptyProcess);
				const jobExited = childExit(windowsJobProcess);
				const taskkillSucceeded = await new Promise<boolean>((resolve) => {
					const timeoutWindow = window;
					let settled = false;
					let taskkill: ChildProcess | null = null;
					const finish = (succeeded: boolean) => {
						if (settled) return;
						settled = true;
						timeoutWindow.clearTimeout(timeout);
						if (!succeeded) taskkill?.kill();
						resolve(succeeded);
					};
					const timeout = timeoutWindow.setTimeout(() => finish(false), 5000);
					try {
						taskkill = spawn("taskkill.exe", ["/pid", String(ptyProcess.pid), "/T", "/F"], {
							stdio: "ignore",
							windowsHide: true,
						});
						taskkill.once("error", () => finish(false));
						taskkill.once("exit", (code) => finish(code === 0));
					} catch {
						finish(false);
					}
				});

				if (!taskkillSucceeded) ptyProcess.kill();
				windowsJobProcess?.kill();
				const confirmed = await withTimeout(Promise.all([ptyExited, jobExited]), 5000);
				if (!confirmed) {
					ptyProcess.kill();
					windowsJobProcess?.kill();
					throw new Error(`Windows PTY process tree ${ptyProcess.pid} did not exit after forced shutdown`);
				}
				return;
			} else {
				ptyProcess.kill();
				windowsJobProcess?.kill();
			}
		}
		windowsJobProcess?.kill();
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
