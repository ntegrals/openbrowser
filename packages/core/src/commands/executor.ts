import type { Page, CDPSession } from 'playwright';
import { z } from 'zod';
import { CommandCatalog } from './catalog/catalog.js';
import type {
	Command,
	CommandResult,
	ExecutionContext,
	InterpretedViewportError,
	ViewportErrorCategory,
} from './types.js';
import {
	TapCommandSchema,
	TypeTextCommandSchema,
	NavigateCommandSchema,
	BackCommandSchema,
	ScrollCommandSchema,
	PressKeysCommandSchema,
	ExtractCommandSchema,
	FinishCommandSchema,
	FocusTabCommandSchema,
	NewTabCommandSchema,
	CloseTabCommandSchema,
	WebSearchCommandSchema,
	UploadCommandSchema,
	SelectCommandSchema,
	CaptureCommandSchema,
	ReadPageCommandSchema,
	WaitCommandSchema,
	ScrollToCommandSchema,
	FindCommandSchema,
	SearchCommandSchema,
	ListOptionsCommandSchema,
	PickOptionCommandSchema,
	ExtractStructuredCommandSchema,
} from './types.js';
