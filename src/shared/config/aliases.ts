import fs from 'node:fs';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import { normalizeChannelName } from '../resolve/normalize';

const aliasGroupSchema = z.object({
  canonical: z.string().min(1),
  names: z.array(z.string().min(1)).min(1),
});

const aliasesFileSchema = z.object({
  version: z.literal(1),
  aliases: z.array(aliasGroupSchema),
});

export type AliasGroup = z.infer<typeof aliasGroupSchema>;
export type AliasesFile = z.infer<typeof aliasesFileSchema>;

export function loadAliasesFromString(content: string): AliasesFile {
  return aliasesFileSchema.parse(yaml.load(content));
}

export function loadAliasesFromFile(filePath: string): AliasesFile {
  return loadAliasesFromString(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Builds normalizedName -> canonical lookup. Every alias name is run
 * through the same normalizer as incoming channel names, so "Bally
 * Sports Detroit" and "bally  sports   detroit HD" hash to the same key.
 */
export function buildAliasIndex(file: AliasesFile): Map<string, string> {
  const index = new Map<string, string>();
  for (const group of file.aliases) {
    for (const name of group.names) {
      const { normalized } = normalizeChannelName(name);
      if (normalized) index.set(normalized, group.canonical);
    }
  }
  return index;
}
