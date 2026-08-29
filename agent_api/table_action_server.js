import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Ajv from 'ajv';
import { TABLE_ACTION_API_PHASE, TABLE_ACTION_API_VERSION, IMPLEMENTED_ACTIONS, getActionMetadata } from './table_action_api.js';
import { buildActionRequestSchema } from './action_definitions.js';

const API_VERSION = TABLE_ACTION_API_VERSION;
const actionSchema = buildActionRequestSchema();
const validateActionRequest = new Ajv({ allErrors: true, jsonPointers: true, schemaId: 'auto' }).compile(actionSchema);

const ALL_PERMISSIONS = new Set([
  'read', 'write:data', 'write:schema', 'execute:generation', 'write:media',
  'filesystem:export', 'workspace:save', 'destructive'
]);

function argValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function hasArg(name) {
  return process.argv.includes(`--${name}`);
}

export function createTableActionServer({ app, BrowserWindow, ipcMain }) {
  const pending = new Map();
  let httpServer = null;
  let sessionFile = null;
  let auditLogFile = null;
  const eventClients = new Set();
  // Serialize localhost requests before they enter the renderer. This prevents
  // concurrent Agent writes from racing against the renderer's React commit.
  let dispatchQueue = Promise.resolve();

  function publishEvent(type, data = {}) {
    const event = { id: crypto.randomUUID(), type, timestamp: new Date().toISOString(), data };
    const payload = `id: ${event.id}\nevent: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of [...eventClients]) {
      try { client.write(payload); }
      catch (_) { eventClients.delete(client); }
    }
    return event;
  }

  function writeAudit(entry) {
    if (!auditLogFile) return;
    const safeEntry = { timestamp: new Date().toISOString(), ...entry };
    fs.promises.appendFile(auditLogFile, `${JSON.stringify(safeEntry)}\n`, 'utf8').catch(error => {
      console.warn('[Table Action API] audit log write failed:', error?.message || error);
    });
  }

  const responseHandler = (_event, payload) => {
    const bridgeId = payload?.bridgeId;
    if (!bridgeId || !pending.has(bridgeId)) return;
    const entry = pending.get(bridgeId);
    pending.delete(bridgeId);
    clearTimeout(entry.timer);
    entry.resolve(payload.response);
  };
  ipcMain.on('table-action-api:response', responseHandler);

  function getRendererWindow() {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused && !focused.isDestroyed()) return focused;
    return BrowserWindow.getAllWindows().find(win => !win.isDestroyed()) || null;
  }

  function dispatchToRenderer(request, timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      const win = getRendererWindow();
      if (!win) {
        reject(new Error('No AI Table Studio renderer window is available.'));
        return;
      }
      const bridgeId = `bridge_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
      const timer = setTimeout(() => {
        pending.delete(bridgeId);
        reject(new Error(`Renderer action timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      pending.set(bridgeId, { resolve, reject, timer });
      win.webContents.send('table-action-api:request', { bridgeId, request });
    });
  }

  function enqueueDispatch(request, timeoutMs = 12000) {
    const task = dispatchQueue.then(() => dispatchToRenderer(request, timeoutMs));
    // A failed request must not poison the queue for later Agent actions.
    dispatchQueue = task.catch(() => undefined);
    return task;
  }

  async function startIfEnabled() {
    if (httpServer) return { started: true };

    const enabled = process.env.HONGS_TABLE_ACTION_API === '1' || hasArg('table-action-api');
    if (!enabled) {
      console.log('[Table Action API] disabled (set HONGS_TABLE_ACTION_API=1 or --table-action-api to enable)');
      return { started: false, reason: 'disabled' };
    }

    const host = '127.0.0.1';
    const parsedPort = Number(process.env.HONGS_TABLE_ACTION_PORT || argValue('table-action-port') || 17321);
    const port = Number.isInteger(parsedPort) && parsedPort >= 1024 && parsedPort <= 65535 ? parsedPort : 17321;
    const configuredToken = process.env.HONGS_TABLE_ACTION_TOKEN || argValue('table-action-token');
    const token = configuredToken || crypto.randomBytes(24).toString('hex');
    const configuredPermissions = String(process.env.HONGS_TABLE_ACTION_PERMISSIONS || '').split(',').map(value => value.trim()).filter(Boolean);
    const permissions = configuredPermissions.length ? new Set(configuredPermissions) : new Set(ALL_PERMISSIONS);
    const actorId = String(process.env.HONGS_TABLE_ACTION_ACTOR_ID || `local-agent-${process.pid}`);
    const actorName = String(process.env.HONGS_TABLE_ACTION_ACTOR_NAME || 'Local Table Action Agent');
    const explicitExpiry = Date.parse(String(process.env.HONGS_TABLE_ACTION_TOKEN_EXPIRES_AT || ''));
    const ttlSeconds = Number(process.env.HONGS_TABLE_ACTION_TOKEN_TTL_SECONDS || 0);
    const expiresAt = Number.isFinite(explicitExpiry) ? explicitExpiry : ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null;
    auditLogFile = path.join(app.getPath('userData'), 'table-action-api-audit.jsonl');

    const serverApp = express();
    serverApp.disable('x-powered-by');
    serverApp.use(express.json({ limit: '2mb', strict: true }));

    const authenticate = (req, res, next) => {
      const auth = String(req.headers.authorization || '');
      const alt = String(req.headers['x-ai-table-token'] || '');
      const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : alt;
      const suppliedBuffer = Buffer.from(supplied);
      const tokenBuffer = Buffer.from(token);
      if (!supplied || suppliedBuffer.length !== tokenBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, tokenBuffer)) {
        res.status(401).json({ ok: false, error: { code: 'PERMISSION_DENIED', message: 'Invalid Table Action API token', retryable: false } });
        return;
      }
      if (expiresAt && Date.now() >= expiresAt) {
        res.status(401).json({ ok: false, error: { code: 'TOKEN_EXPIRED', message: 'Table Action API token has expired', retryable: false, details: { expiresAt: new Date(expiresAt).toISOString() } } });
        return;
      }
      req.tableActionSession = { actorId, actorName, permissions: [...permissions], expiresAt };
      next();
    };

    serverApp.get('/health', (_req, res) => {
      res.json({ ok: true, service: 'ai-table-action-api', version: API_VERSION, phase: TABLE_ACTION_API_PHASE });
    });

    serverApp.get('/v0.1/events', authenticate, (req, res) => {
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
      res.write(`event: connected\ndata: ${JSON.stringify({ type: 'connected', phase: TABLE_ACTION_API_PHASE, timestamp: new Date().toISOString() })}\n\n`);
      eventClients.add(res);
      const keepAlive = setInterval(() => { try { res.write(': keep-alive\n\n'); } catch (_) {} }, 15000);
      req.on('close', () => { clearInterval(keepAlive); eventClients.delete(res); });
    });

    serverApp.post('/v0.1/actions', authenticate, async (req, res) => {
      if (!validateActionRequest(req.body)) {
        const details = (validateActionRequest.errors || []).map(error => ({ path: error.dataPath || '/', keyword: error.keyword, message: error.message, params: error.params }));
        writeAudit({ actorId, action: req.body?.action || null, requestId: req.body?.requestId || null, ok: false, code: 'SCHEMA_VALIDATION_FAILED', details });
        res.status(400).json({ ok: false, version: API_VERSION, action: req.body?.action || null, requestId: req.body?.requestId || null, error: { code: 'SCHEMA_VALIDATION_FAILED', message: 'Request did not match the Table Action JSON Schema', retryable: false, details } });
        return;
      }
      const actionName = String(req.body.action || '');
      const meta = getActionMetadata(actionName);
      if (!meta || !IMPLEMENTED_ACTIONS.includes(actionName)) {
        res.status(400).json({ ok: false, error: { code: 'INVALID_REQUEST', message: `Unknown action: ${actionName}`, retryable: false } });
        return;
      }
      const requiredPermissions = new Set([meta.permission]);
      if (actionName === 'transaction.execute') {
        for (const step of req.body.params?.actions || []) {
          const childMeta = getActionMetadata(step?.action);
          if (childMeta?.permission) requiredPermissions.add(childMeta.permission);
        }
      }
      const missingPermissions = [...requiredPermissions].filter(permission => !permissions.has('*') && !permissions.has(permission));
      if (missingPermissions.length) {
        writeAudit({ actorId, action: actionName, requestId: req.body?.requestId || null, ok: false, code: 'PERMISSION_DENIED', requiredPermission: meta.permission });
        res.status(403).json({ ok: false, version: API_VERSION, action: actionName, requestId: req.body?.requestId || null, error: { code: 'PERMISSION_DENIED', message: `Token lacks required permission(s): ${missingPermissions.join(', ')}`, retryable: false, details: { requiredPermissions: [...requiredPermissions], missingPermissions } } });
        return;
      }
      const request = { ...req.body, actor: req.body.actor || { type: 'agent', name: actorName } };
      try {
        const timeoutMs = actionName === 'generation.run' ? 120000
          : actionName === 'generation.preview' ? 30000
          : actionName.startsWith('job.') ? 30000
          : 12000;
        const response = await enqueueDispatch(request, timeoutMs);
        const status = response?.ok ? 200
          : ['CONFIRMATION_REQUIRED', 'STALE_WORKSPACE', 'WRITE_CONFLICT'].includes(response?.error?.code) ? 409
          : response?.error?.code === 'PERMISSION_DENIED' ? 403
          : 400;
        writeAudit({
          actorId, actorName, action: actionName, requestId: request.requestId || null, idempotencyKey: request.idempotencyKey || request.params?.idempotencyKey || null,
          expectedRevision: request.expectedRevision ?? null, workspaceRevision: response?.workspaceRevision ?? null,
          ok: !!response?.ok, code: response?.error?.code || null, effects: response?.effects || null, undoToken: response?.undoToken || null
        });
        if (response?.ok) {
          if (response.undoToken || response.data?.workspaceChanged) publishEvent('workspace.changed', { action: actionName, workspaceRevision: response.workspaceRevision, effects: response.effects, undoToken: response.undoToken || null });
          if (actionName.startsWith('job.')) publishEvent('job.updated', { action: actionName, data: response.data });
          if (actionName === 'generation.run') publishEvent('generation.completed', { action: actionName, data: response.data });
          if (actionName.startsWith('batch.') && response.data?.batch?.counts && response.data.batch.counts.completed + response.data.batch.counts.failed + response.data.batch.counts.cancelled === response.data.batch.counts.total) {
            publishEvent('batch.completed', { batchId: response.data.batch.batchId, counts: response.data.batch.counts });
          }
        }
        res.status(status).json(response);
      } catch (error) {
        writeAudit({ actorId, action: actionName, requestId: req.body?.requestId || null, ok: false, code: 'RENDERER_UNAVAILABLE', message: error?.message || String(error) });
        res.status(503).json({
          ok: false,
          version: API_VERSION,
          action: req.body?.action || null,
          requestId: req.body?.requestId || null,
          error: { code: 'RENDERER_UNAVAILABLE', message: error?.message || String(error), retryable: true }
        });
      }
    });

    await new Promise((resolve, reject) => {
      httpServer = serverApp.listen(port, host, resolve);
      httpServer.once('error', reject);
    });
    globalThis.__publishTableActionEvent = publishEvent;

    try {
      sessionFile = path.join(app.getPath('userData'), 'table-action-api-session.json');
      fs.writeFileSync(sessionFile, JSON.stringify({
        version: API_VERSION,
        phase: TABLE_ACTION_API_PHASE,
        host,
        port,
        token,
        actorId,
        actorName,
        permissions: [...permissions],
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        eventsUrl: `http://${host}:${port}/v0.1/events`,
        auditLogFile,
        pid: process.pid,
        startedAt: new Date().toISOString()
      }, null, 2), 'utf8');
    } catch (error) {
      console.warn('[Table Action API] could not write session info:', error?.message || error);
    }

    console.log(`[Table Action API] listening on http://${host}:${port}/v0.1/actions`);
    console.log(`[Table Action API] session info: ${sessionFile || '(unavailable)'}`);
    if (!configuredToken) {
      console.log('[Table Action API] generated a session token automatically; read it from the session info file.');
    }
    return { started: true, host, port, sessionFile };
  }

  async function stop() {
    for (const [bridgeId, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Table Action API server stopped.'));
      pending.delete(bridgeId);
    }
    for (const client of eventClients) {
      try { client.end(); } catch (_) {}
    }
    eventClients.clear();
    if (httpServer) {
      await new Promise(resolve => httpServer.close(resolve));
      httpServer = null;
    }
    dispatchQueue = Promise.resolve();
    if (globalThis.__publishTableActionEvent === publishEvent) delete globalThis.__publishTableActionEvent;
    if (sessionFile) {
      try { fs.unlinkSync(sessionFile); } catch (_) {}
      sessionFile = null;
    }
  }

  function dispose() {
    ipcMain.removeListener('table-action-api:response', responseHandler);
  }

  return { startIfEnabled, stop, dispose, dispatchToRenderer, publishEvent };
}
