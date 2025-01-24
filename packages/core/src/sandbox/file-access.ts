import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger } from '../logging.js';

const logger = createLogger('filesystem');

const ALLOWED_EXTENSIONS = new Set([
	'.txt', '.md', '.json', '.csv', '.html', '.xml', '.yaml', '.yml',
	'.js', '.ts', '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp',
	'.css', '.scss', '.less', '.svg', '.log', '.env', '.toml', '.ini',
	'.sh', '.bash', '.zsh', '.sql', '.graphql',
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export interface FileAccessOptions {
	sandboxDir: string;
	allowedExtensions?: Set<string>;
	maxFileSize?: number;
	readOnly?: boolean;
}

export interface FileInfo {
	name: string;
	path: string;
	size: number;
	isDirectory: boolean;
	modifiedAt: Date;
	extension: string;
}

export interface FileAccessState {
	files: Map<string, FileInfo>;
	totalSize: number;
	operationCount: number;
}

export class FileAccess {
	private sandboxDir: string;
	private allowedExtensions: Set<string>;
	private maxFileSize: number;
	private readOnly: boolean;
	private state: FileAccessState;

	constructor(options: FileAccessOptions) {
		this.sandboxDir = path.resolve(options.sandboxDir);
		this.allowedExtensions = options.allowedExtensions ?? ALLOWED_EXTENSIONS;
		this.maxFileSize = options.maxFileSize ?? MAX_FILE_SIZE;
		this.readOnly = options.readOnly ?? false;

		this.state = {
			files: new Map(),
			totalSize: 0,
			operationCount: 0,
		};

		// Ensure sandbox directory exists
		if (!fs.existsSync(this.sandboxDir)) {
			fs.mkdirSync(this.sandboxDir, { recursive: true });
		}

		// Index existing files
		this.indexDirectory();
	}

	private indexDirectory(): void {
		try {
			const entries = fs.readdirSync(this.sandboxDir, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = path.join(this.sandboxDir, entry.name);
				if (entry.isFile()) {
					const stat = fs.statSync(fullPath);
					this.state.files.set(entry.name, {
						name: entry.name,
						path: fullPath,
						size: stat.size,
						isDirectory: false,
						modifiedAt: stat.mtime,
						extension: path.extname(entry.name).toLowerCase(),
					});
					this.state.totalSize += stat.size;
				}
			}
		} catch {
			logger.debug('Failed to index sandbox directory');
		}
	}

	private resolvePath(relativePath: string): string {
		const resolved = path.resolve(this.sandboxDir, relativePath);
		// Prevent path traversal
		if (!resolved.startsWith(this.sandboxDir)) {
			throw new Error(`Path traversal detected: ${relativePath}`);
		}
		return resolved;
	}

	private validateExtension(filePath: string): void {
		const ext = path.extname(filePath).toLowerCase();
		if (!this.allowedExtensions.has(ext)) {
			throw new Error(
				`File extension "${ext}" is not allowed. Allowed: ${[...this.allowedExtensions].join(', ')}`,
			);
		}
	}

	private isBinaryFile(filePath: string): boolean {
		const ext = path.extname(filePath).toLowerCase();
		const binaryExts = new Set([
			'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp',
			'.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
			'.zip', '.tar', '.gz', '.7z', '.rar',
			'.exe', '.dll', '.so', '.dylib',
			'.mp3', '.mp4', '.avi', '.mkv', '.wav',
			'.woff', '.woff2', '.ttf', '.eot',
		]);
		return binaryExts.has(ext);
	}

	async read(relativePath: string): Promise<string> {
		const fullPath = this.resolvePath(relativePath);

		if (!fs.existsSync(fullPath)) {
			throw new Error(`File not found: ${relativePath}`);
		}

		if (this.isBinaryFile(fullPath)) {
			throw new Error(`Cannot read binary file: ${relativePath}`);
		}

		const stat = fs.statSync(fullPath);
		if (stat.size > this.maxFileSize) {
			throw new Error(
				`File too large: ${(stat.size / 1024 / 1024).toFixed(1)}MB (max: ${(this.maxFileSize / 1024 / 1024).toFixed(1)}MB)`,
			);
		}

		this.state.operationCount++;
		logger.debug(`Read file: ${relativePath} (${stat.size} bytes)`);
		return fs.readFileSync(fullPath, 'utf-8');
	}

	async write(relativePath: string, content: string): Promise<void> {
		if (this.readOnly) {
			throw new Error('File system is read-only');
		}

		const fullPath = this.resolvePath(relativePath);
		this.validateExtension(fullPath);

		const contentSize = Buffer.byteLength(content, 'utf-8');
		if (contentSize > this.maxFileSize) {
			throw new Error(`Content too large: ${(contentSize / 1024 / 1024).toFixed(1)}MB`);
		}

		// Ensure parent directory exists
		const dir = path.dirname(fullPath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		fs.writeFileSync(fullPath, content, 'utf-8');

		const info: FileInfo = {
			name: path.basename(relativePath),
			path: fullPath,
			size: contentSize,
			isDirectory: false,
			modifiedAt: new Date(),
			extension: path.extname(relativePath).toLowerCase(),
		};

		this.state.files.set(relativePath, info);
		this.state.totalSize += contentSize;
		this.state.operationCount++;
		logger.debug(`Wrote file: ${relativePath} (${contentSize} bytes)`);
	}

	async list(relativeDir = '.'): Promise<FileInfo[]> {
		const fullPath = this.resolvePath(relativeDir);

		if (!fs.existsSync(fullPath)) {
			return [];
		}

		const entries = fs.readdirSync(fullPath, { withFileTypes: true });
		const result: FileInfo[] = [];

		for (const entry of entries) {
			const entryPath = path.join(fullPath, entry.name);
			const stat = fs.statSync(entryPath);
			result.push({
				name: entry.name,
				path: entryPath,
				size: stat.size,
				isDirectory: entry.isDirectory(),
				modifiedAt: stat.mtime,
				extension: path.extname(entry.name).toLowerCase(),
			});
		}
