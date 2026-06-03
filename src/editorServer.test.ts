import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as WebSocket from 'ws';
import { EditorServer } from './editorServer';

describe('EditorServer', () => {
    let tempLockDir: string;
    let server: EditorServer;

    beforeEach(() => {
        tempLockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-test-'));
    });

    afterEach(async () => {
        if (server?.isRunning()) {
            await server.stop();
        }
        fs.rmSync(tempLockDir, { recursive: true, force: true });
    });

    it('should start, bind to a port, and write a lock file', async () => {
        server = new EditorServer({ lockDir: tempLockDir });
        const port = await server.start('/path/to/vault');

        expect(server.isRunning()).toBe(true);
        expect(port).toBeGreaterThan(0);

        const lockFilePath = path.join(tempLockDir, `${port}.lock`);
        expect(fs.existsSync(lockFilePath)).toBe(true);

        const lockContent = JSON.parse(fs.readFileSync(lockFilePath, 'utf-8'));
        expect(lockContent.transport).toBe('ws');
        expect(lockContent.workspaceFolders).toEqual(['/path/to/vault']);
    });

    it('should respond to initialize JSON-RPC request', async () => {
        server = new EditorServer({ lockDir: tempLockDir });
        const port = await server.start('/path/to/vault');

        const client = new (WebSocket as any).default(`ws://127.0.0.1:${port}`);
        await new Promise<void>((resolve, reject) => {
            client.once('open', resolve);
            client.once('error', reject);
        });

        const response = await new Promise<any>((resolve) => {
            client.once('message', (data: WebSocket.RawData) => {
                resolve(JSON.parse(data.toString()));
            });

            client.send(JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: '2025-11-25',
                    capabilities: {},
                    clientInfo: { name: 'opencode', version: '0.0.0' }
                }
            }));
        });

        expect(response.jsonrpc).toBe('2.0');
        expect(response.id).toBe(1);
        expect(response.result).toBeDefined();
        expect(response.result.protocolVersion).toBe('2025-11-25');
        expect(response.result.serverInfo).toEqual({
            name: 'obsidian-opencode',
            version: '1.1.1'
        });

        client.close();
    });

    it('should accept notifications/initialized without responding', async () => {
        server = new EditorServer({ lockDir: tempLockDir });
        const port = await server.start('/path/to/vault');

        const client = new (WebSocket as any).default(`ws://127.0.0.1:${port}`);
        await new Promise<void>((resolve, reject) => {
            client.once('open', resolve);
            client.once('error', reject);
        });

        // Send initialize first to get a valid session
        const initResponse = await new Promise<any>((resolve) => {
            client.once('message', (data: WebSocket.RawData) => {
                resolve(JSON.parse(data.toString()));
            });
            client.send(JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'opencode', version: '0.0.0' } }
            }));
        });
        expect(initResponse.result).toBeDefined();

        // Send notifications/initialized — server should not send anything back
        let receivedMessage = false;
        const messageHandler = () => { receivedMessage = true; };
        client.on('message', messageHandler);

        client.send(JSON.stringify({
            jsonrpc: '2.0',
            method: 'notifications/initialized',
            params: {}
        }));

        // Wait a tick to ensure no response was sent
        await new Promise(r => setTimeout(r, 50));
        expect(receivedMessage).toBe(false);

        client.off('message', messageHandler);
        client.close();
    });

    it('should send at_mentioned to connected client', async () => {
        server = new EditorServer({ lockDir: tempLockDir });
        const port = await server.start('/path/to/vault');

        const client = new (WebSocket as any).default(`ws://127.0.0.1:${port}`);
        await new Promise<void>((resolve, reject) => {
            client.once('open', resolve);
            client.once('error', reject);
        });

        const received = new Promise<any>((resolve) => {
            client.once('message', (data: WebSocket.RawData) => {
                resolve(JSON.parse(data.toString()));
            });
        });

        server.notifyAtMentioned('path/to/note.md', 1, 5);

        const msg = await received;
        expect(msg.jsonrpc).toBe('2.0');
        expect(msg.method).toBe('at_mentioned');
        expect(msg.params).toEqual({
            filePath: 'path/to/note.md',
            lineStart: 1,
            lineEnd: 5
        });

        client.close();
    });

    it('should stop and clean up lock file', async () => {
        server = new EditorServer({ lockDir: tempLockDir });
        const port = await server.start('/path/to/vault');

        const lockFilePath = path.join(tempLockDir, `${port}.lock`);
        expect(fs.existsSync(lockFilePath)).toBe(true);
        expect(server.isRunning()).toBe(true);

        await server.stop();

        expect(fs.existsSync(lockFilePath)).toBe(false);
        expect(server.isRunning()).toBe(false);
    });
});
