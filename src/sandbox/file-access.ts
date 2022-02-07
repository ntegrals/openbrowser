import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../logging';

const logger = createLogger('file-access');

/**
 * Sandboxed file access for saving screenshots, recordings, etc.
 */
export class FileAccess {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = path.resolve(basePath);
    this.ensureDir(this.basePath);
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  resolvePath(relativePath: string): string {
    const resolved = path.resolve(this.basePath, relativePath);
    // Security: ensure we don't escape the base path
    if (!resolved.startsWith(this.basePath)) {
      throw new Error(`Path traversal detected: ${relativePath}`);
    }
    return resolved;
  }

  async writeFile(relativePath: string, data: Buffer | string): Promise<string> {
    const fullPath = this.resolvePath(relativePath);
    this.ensureDir(path.dirname(fullPath));
    fs.writeFileSync(fullPath, data);
    logger.debug(`Wrote file: ${fullPath}`);
    return fullPath;
  }

  async readFile(relativePath: string): Promise<Buffer> {
    const fullPath = this.resolvePath(relativePath);
    return fs.readFileSync(fullPath);
  }

  exists(relativePath: string): boolean {
    const fullPath = this.resolvePath(relativePath);
    return fs.existsSync(fullPath);
  }

  listFiles(relativePath: string = '.'): string[] {
    const fullPath = this.resolvePath(relativePath);
    if (!fs.existsSync(fullPath)) return [];
    return fs.readdirSync(fullPath);
  }
}
