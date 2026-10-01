import { EventEmitter } from 'node:events';
import type { Record } from './types.js';

export interface DomainEventMap {
  'server.started': { type: 'server.started'; at: string };
  'record.created': { type: 'record.created'; record: Record };
  'record.updated': { type: 'record.updated'; record: Record };
  'record.deleted': { type: 'record.deleted'; id: string };
  'record.reminded': { type: 'record.reminded'; record: Record };
}

export class DomainEvents extends EventEmitter {
  emitEvent<K extends keyof DomainEventMap>(key: K, payload: DomainEventMap[K]): void {
    this.emit(key, payload);
  }

  on<K extends keyof DomainEventMap>(key: K, listener: (payload: DomainEventMap[K]) => void): this {
    return super.on(key, listener);
  }
}
