import { describe, it, expect } from 'bun:test';
import { BridgeServer } from './server';

describe('BridgeServer', () => {
  it('should create a server with default options', () => {
    const server = new BridgeServer();
    expect(server).toBeDefined();
  });

  it('should accept custom port', () => {
    const server = new BridgeServer({ port: 9999 });
    expect(server).toBeDefined();
  });
});
