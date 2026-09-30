import type { Style } from "../src/types";
export type ImageRecipe = {
  id: string;
  name: string;
  origin: string;
  sourceId?: string;
  layout: string;
  typography: string;
  graphics: string;
  avoid: string;
  constraints?: unknown[];
  adaptationRules?: string[];
};
export function styleRecipes(style: Partial<Style>): ImageRecipe[];
