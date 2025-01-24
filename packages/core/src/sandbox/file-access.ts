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

