import crypto from 'node:crypto';
import http from 'node:http';
import type { RawData } from 'ws';
import { WebSocket, WebSocketServer } from 'ws';
import { config } from './config.js';
import { CaptureDb } from './db.js';
import { AppError } from './errors.js';
import { DomainEvents } from './events.js';
import { logger } from './logger.js';
import { event, failure, parsePayload, parseRequest, response, type Operation } from './protocol.js';
import type { RecordService } from './record-service.js';
import { Scheduler } from './scheduler.js';

interface Client {
  id: string;
  socket: WebSocket;
}

export class CaptureServer {
  private readonly clients = new Map<string, Client>();
  private readonly httpServer = http.createServer((_request, res) => {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'WebSocket endpoint only' }));
  });
  private readonly wsServer = new WebSocketServer({
    server: this.httpServer,
    maxPayload: config.limits.requestBytes,
    perMessageDeflate: false,
  });

  constructor(
    private readonly records: RecordService,
    private readonly events: DomainEvents,
    private readonly db: CaptureDb,
    private readonly scheduler: Scheduler,
  ) {
    this.wsServer.on('connection', (socket) => this.onConnection(socket));
    this.wsServer.on('error', (error) => logger.high(`WebSocket server error: ${error.message}`));

    this.events.on('record.created', (payload) => this.broadcast('record.created', payload.record));
    this.events.on('record.updated', (payload) => this.broadcast('record.updated', payload.record));
    this.events.on('record.deleted', (payload) => this.broadcast('record.deleted', { id: payload.id }));
    this.events.on('record.reminded', (payload) => this.broadcast('record.reminded', payload.record));
    this.events.on('server.started', (payload) => this.broadcast('server.started', { at: payload.at }));
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        this.httpServer.off('listening', onListening);
        logger.high(`Server startup failed: ${error.message}`);
        reject(error);
      };
      const onListening = () => {
        this.httpServer.off('error', onError);
        logger.low(`WebSocket server listening on ws://${config.host}:${config.port}`);
        resolve();
      };
      this.httpServer.once('error', onError);
      this.httpServer.once('listening', onListening);
      this.httpServer.listen(config.port, config.host);
    });
  }

  async stop(): Promise<void> {
    this.scheduler.stop();
    for (const client of this.clients.values()) client.socket.close(1001, 'Server shutting down');
    await new Promise<void>((resolve) => this.wsServer.close(() => resolve()));
    await new Promise<void>((resolve, reject) => this.httpServer.close((err) => (err ? reject(err) : resolve())));
    this.db.close();
  }

  private onConnection(socket: WebSocket): void {
    const client: Client = { id: crypto.randomUUID(), socket };
    this.clients.set(client.id, client);
    logger.low(`WebSocket client connected: ${client.id}`);

    socket.on('message', (raw) => this.onMessage(client, raw));
    socket.on('error', (error) => logger.high(`WebSocket client ${client.id} error: ${error.message}`));
    socket.on('close', (code, reason) => {
      this.clients.delete(client.id);
      logger.medium(`WebSocket client ${client.id} disconnected: code=${code}, reason=${reason.toString()}`);
    });
  }

  private onMessage(client: Client, raw: RawData): void {
    const text = raw.toString();
    let requestId: string | null = null;
    try {
      const parsedJson = JSON.parse(text) as unknown;
      const request = parseRequest(parsedJson);
      requestId = request.requestId;
      logger.low(`Request ${request.requestId} from ${client.id}: ${request.operation}`);
      const payload = parsePayload(request.operation, request.payload);
      this.execute(request.operation, payload)
        .then((data) => this.send(client.socket, response(request.requestId, data)))
        .catch((error) => this.handleError(client, request.requestId, error));
    } catch (error) {
      requestId = requestId ?? this.extractRequestId(text);
      this.handleError(client, requestId, error);
    }
  }

  private handleError(client: Client, requestId: string | null, error: unknown): void {
    const appError = error instanceof AppError ? error : new AppError('INTERNAL_ERROR', 'Request failed', 500);
    if (error instanceof AppError && error.code === 'VALIDATION_ERROR') {
      logger.medium(`Validation error from ${client.id}: ${error.message}`);
    } else {
      logger.high(`Request ${requestId ?? 'unknown'} from ${client.id} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (requestId) this.send(client.socket, failure(requestId, appError.code, appError.message));
  }

  private async execute(operation: Operation, payload: any): Promise<unknown> {
    switch (operation) {
      case 'record.create':
        return this.records.create(payload);
      case 'record.list':
        return this.records.list(payload);
      case 'record.get':
        return this.records.get(payload.id);
      case 'record.update':
        return this.records.update(payload.id, payload);
      case 'record.delete':
        this.records.delete(payload.id);
        return { id: payload.id };
      case 'record.markDone':
        return this.records.markDone(payload.id);
      case 'record.archive':
        return this.records.archive(payload.id);
    }
  }

  private broadcast(eventName: string, data: unknown): void {
    const message = event(eventName, data);
    for (const client of this.clients.values()) {
      if (client.socket.readyState === WebSocket.OPEN) client.socket.send(message);
    }
  }

  private send(socket: WebSocket, message: string): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(message);
  }

  private extractRequestId(text: string): string | null {
    try {
      const parsed = JSON.parse(text) as { requestId?: unknown };
      return typeof parsed.requestId === 'string' ? parsed.requestId : null;
    } catch {
      return null;
    }
  }
}
