import { z } from 'zod';

export const ClickCommandSchema = z.object({
  command: z.literal('click'),
  selector: z.string(),
  timeout: z.number().optional(),
});

export const TypeCommandSchema = z.object({
  command: z.literal('type_text'),
  selector: z.string(),
  text: z.string(),
  clearFirst: z.boolean().optional(),
});

export const NavigateCommandSchema = z.object({
  command: z.literal('navigate'),
  url: z.string(),
});

export const ScrollCommandSchema = z.object({
  command: z.literal('scroll'),
  direction: z.enum(['up', 'down', 'left', 'right']),
  amount: z.number().optional(),
});

export const ScreenshotCommandSchema = z.object({
  command: z.literal('screenshot'),
  fullPage: z.boolean().optional(),
});

export const BackCommandSchema = z.object({
  command: z.literal('back'),
});

export const PressKeyCommandSchema = z.object({
  command: z.literal('press_keys'),
  key: z.string(),
});

export const ExtractCommandSchema = z.object({
  command: z.literal('extract'),
  selector: z.string().optional(),
});

export const CommandSchema = z.discriminatedUnion('command', [
  ClickCommandSchema,
  TypeCommandSchema,
  NavigateCommandSchema,
  ScrollCommandSchema,
  ScreenshotCommandSchema,
  PressKeyCommandSchema,
]);

export type Command = z.infer<typeof CommandSchema>;
