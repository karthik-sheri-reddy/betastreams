import fs from 'node:fs';
import * as yaml from 'js-yaml';
import { z } from 'zod';

const leagueSchema = z.object({
  espnPath: z.string().min(1),
  displayName: z.string().min(1),
  priority: z.number().int().positive(),
  disabled: z.boolean().optional().default(false),
  disabledReason: z.string().optional(),
});

const categorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  order: z.number().int().positive(),
  leagues: z.array(leagueSchema).default([]),
  epgKeywords: z.array(z.string()).optional().default([]),
});

const categoriesFileSchema = z.object({
  version: z.literal(1),
  categories: z.array(categorySchema),
});

export type LeagueConfig = z.infer<typeof leagueSchema>;
export type CategoryConfig = z.infer<typeof categorySchema>;
export type CategoriesFile = z.infer<typeof categoriesFileSchema>;

export function loadCategoriesFromString(content: string): CategoriesFile {
  const parsed = yaml.load(content);
  return categoriesFileSchema.parse(parsed);
}

export function loadCategoriesFromFile(filePath: string): CategoriesFile {
  return loadCategoriesFromString(fs.readFileSync(filePath, 'utf-8'));
}

/** Flattens every league across every category, tagged with its parent category id — what the ESPN poller and the path-verification script iterate over. */
export function flattenLeagues(file: CategoriesFile): Array<LeagueConfig & { categoryId: string }> {
  const out: Array<LeagueConfig & { categoryId: string }> = [];
  for (const cat of file.categories) {
    for (const league of cat.leagues) {
      out.push({ ...league, categoryId: cat.id });
    }
  }
  return out;
}

export function serializeCategoriesToYaml(file: CategoriesFile): string {
  return yaml.dump(file, { lineWidth: 100 });
}
