export function styleLibraryEntries<
  T extends {
    id: string;
    deletedAt?: string;
    catalogSourceId?: string;
    catalogHidden?: boolean;
    publishedAt?: string | null;
  },
>(
  styles: T[],
  options?: { canManage?: boolean; hosted?: boolean },
): {
  style: T;
  manageStyle?: T;
  unpublished: boolean;
}[];
