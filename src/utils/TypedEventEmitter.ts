import { EventEmitter } from 'events';

/**
 * A strongly-typed wrapper around Node.js EventEmitter.
 *
 * Supply a mapping from event name (string) to payload type and all
 * emit/on/off operations will be enforced by TypeScript.
 */
export class TypedEventEmitter<E extends Record<string, any>> {
  private readonly _ee = new EventEmitter();

  on<K extends keyof E>(event: K, listener: (payload: E[K]) => void): this {
    // Cast because Node’s EventEmitter expects string | symbol.
    this._ee.on(event as string, listener as any);
    return this;
  }

  off<K extends keyof E>(event: K, listener: (payload: E[K]) => void): this {
    this._ee.off(event as string, listener as any);
    return this;
  }

  emit<K extends keyof E>(event: K, payload: E[K]): boolean {
    return this._ee.emit(event as string, payload);
  }

  listenerCount<K extends keyof E>(event: K): number {
    return this._ee.listenerCount(event as string);
  }
}
