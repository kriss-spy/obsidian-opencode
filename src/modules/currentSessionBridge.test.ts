import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { CURRENT_SESSION_PLUGIN, CurrentSessionBridge } from "./currentSessionBridge";

interface BridgeConfig { tabs?: unknown; plugins: { options: { url: string } }[] }

describe("current terminal session bridge", () => {
	const bridge = new CurrentSessionBridge();
	const profile = mkdtempSync(join(tmpdir(), "session-bridge-test-"));
	afterEach(async () => { await bridge.stop(); rmSync(profile, { recursive: true, force: true }); });

	it("queries the live route through the generated plugin, including switch, new session, home and disconnect", async () => {
		const config = JSON.parse(await bridge.start({ XDG_CONFIG_HOME: profile, OPENCODE_CLI_CONFIG_CONTENT: '{"tabs":{"mode":"off"}}' })) as BridgeConfig;
		expect(config.tabs).toEqual({ mode: "off" });
		let route = { type: "session", sessionID: "ses_first" };
		let directory = "/first";
		let connected!: () => void;
		const connection = new Promise<void>((resolve) => { connected = resolve; });
		class PluginSocket extends WebSocket {
			constructor(url: string) { super(url); this.once("open", connected); }
		}
		const plugin = runInNewContext(CURRENT_SESSION_PLUGIN
			.replace('import { Plugin } from "@opencode/plugin/tui";', "")
			.replace("export default", ""), { Plugin: { define: (definition: unknown) => definition }, WebSocket: PluginSocket }) as { setup: (context: unknown) => () => void };
		const dispose = plugin.setup({
			options: config.plugins[0].options,
			ui: { router: { current: () => route } },
			data: { session: { get: (id: string) => ({ id, location: { directory } }) } },
		});
		await connection;
		expect(await bridge.read()).toEqual({ id: "ses_first", directory: "/first" });
		route = { type: "session", sessionID: "ses_new" }; directory = "/新 session";
		expect(await bridge.read()).toEqual({ id: "ses_new", directory });
		route = { type: "home", sessionID: "" };
		expect(await bridge.read()).toBeNull();
		dispose();
		await bridge.stop();
		expect(await bridge.read()).toBeNull();
	});

	it("preserves configured CLI plugin directives and inline preferences", async () => {
		mkdirSync(join(profile, "opencode"), { recursive: true });
		writeFileSync(join(profile, "opencode", "cli.json"), '{ // config\n"plugins": ["*", "-opencode.notifications", "third-party",],}');
		const config = JSON.parse(await bridge.start({ XDG_CONFIG_HOME: profile })) as BridgeConfig;
		expect(config.plugins.slice(0, -1)).toEqual(["*", "-opencode.notifications", "third-party"]);
	});
});
