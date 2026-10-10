import {
  MagnifyingGlass,
  CaretLeft,
  CaretRight,
  X,
} from "@phosphor-icons/react";
import { Button } from "./components";
import type { browsePages } from "../shared/page-browser.mjs";
import "./page-browser.css";

export function PagePagination({
  result,
  onPage,
}: {
  result: ReturnType<typeof browsePages>;
  onPage: (page: number) => void;
}) {
  if (result.pages <= 1) return null;
  return (
    <nav className="page-pagination" aria-label="页面列表翻页">
      <Button
        disabled={result.current === 0}
        onClick={() => onPage(result.current - 1)}
      >
        <CaretLeft size={16} />
        上一组
      </Button>
      <span>
        {result.current + 1} / {result.pages}
      </span>
      <Button
        disabled={result.current === result.pages - 1}
        onClick={() => onPage(result.current + 1)}
      >
        下一组
        <CaretRight size={16} />
      </Button>
    </nav>
  );
}

export function PageBrowser({
  query,
  onQuery,
  result,
  onPage,
  selectedHidden,
}: {
  query: string;
  onQuery: (query: string) => void;
  result: ReturnType<typeof browsePages>;
  onPage: (page: number) => void;
  selectedHidden: number;
}) {
  return (
    <div className="page-browser">
      <label className="page-search">
        <MagnifyingGlass size={18} />
        <input
          type="search"
          aria-label="搜索当前范围的页面"
          placeholder="搜索标题、讲稿或页码"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
        {query && (
          <button
            className="icon-btn"
            aria-label="清除页面搜索"
            onClick={() => onQuery("")}
          >
            <X size={16} />
          </button>
        )}
      </label>
      <span className="page-result-count" role="status">
        {query.trim() ? `找到 ${result.total} 页` : `共 ${result.total} 页`}
        {result.total > 24 && ` · 显示 ${result.start + 1}–${result.end}`}
        {selectedHidden > 0 && ` · 另有 ${selectedHidden} 页已选`}
      </span>
      <PagePagination result={result} onPage={onPage} />
    </div>
  );
}
