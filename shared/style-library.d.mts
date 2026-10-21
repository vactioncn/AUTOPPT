export function styleLibraryEntries<
  T extends {
    id: string;
    deletedAt?: string;
    catalogSourceId?: string;
    catalogHidden?: boolean;
    publishedAt?: string | null;
    examples?: { id: string }[];
    sampleExamples?: { id: string }[];
  },
>(
  styles: T[],
  options?: { canManage?: boolean; hosted?: boolean },
): {
  style: T;
  manageStyle?: T;
  unpublished: boolean;
}[];
