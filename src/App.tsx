import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";

// Rust 側の cmc::Comic / cmc::Page に対応
type Page = {
  fileName: string;
  number: number;
  span: number;
  memo: string;
};

type Comic = {
  title: string;
  pages: Page[];
};

function pageLabel(page: Page): string {
  return page.span === 2 ? `p${page.number}-${page.number + 1}` : `p${page.number}`;
}

function PageCard({ cmcPath, page }: { cmcPath: string; page: Page }) {
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invoke<string>("load_thumbnail", { cmcPath, fileName: page.fileName })
      .then((url) => !cancelled && setThumbnail(url))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [cmcPath, page.fileName]);

  return (
    <li className={`page-card${page.span === 2 ? " spread" : ""}`}>
      <div className="thumb">
        {thumbnail ? (
          <img src={thumbnail} alt={pageLabel(page)} />
        ) : (
          <span className="thumb-placeholder">{failed ? "読み込めませんでした" : "読み込み中…"}</span>
        )}
      </div>
      <div className="page-meta">
        <span className="page-number">{pageLabel(page)}</span>
        {page.span === 2 && <span className="tag">見開き</span>}
      </div>
      <div className="page-file">{page.fileName}</div>
    </li>
  );
}

function App() {
  const [cmcPath, setCmcPath] = useState<string | null>(null);
  const [comic, setComic] = useState<Comic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function openComic() {
    const selected = await open({
      title: "漫画ファイルを選ぶ",
      multiple: false,
      directory: false,
      filters: [{ name: "CLIP STUDIO 漫画ファイル", extensions: ["cmc"] }],
    });
    if (typeof selected !== "string") return;

    setLoading(true);
    setError(null);
    try {
      setComic(await invoke<Comic>("load_comic", { cmcPath: selected }));
      setCmcPath(selected);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const pageCount = comic?.pages.reduce((sum, p) => sum + p.span, 0) ?? 0;

  return (
    <main className="app">
      <header className="app-header">
        <h1 className="logo">Otosazu</h1>
        <button className="primary" onClick={openComic} disabled={loading}>
          {loading ? "読み込み中…" : "漫画ファイル（.cmc）を開く"}
        </button>
      </header>

      {error && <p className="error">{error}</p>}

      {comic && cmcPath ? (
        <section>
          <div className="comic-heading">
            <h2>{comic.title}</h2>
            <span className="comic-count">全 {pageCount} ページ</span>
          </div>
          <p className="comic-path">{cmcPath}</p>
          <ul className="page-grid">
            {comic.pages.map((page) => (
              <PageCard key={`${cmcPath}/${page.fileName}`} cmcPath={cmcPath} page={page} />
            ))}
          </ul>
        </section>
      ) : (
        !error && (
          <p className="empty">
            CLIP STUDIO PAINT で作った漫画ファイル（.cmc）を開くと、ページの一覧が表示されます。
          </p>
        )
      )}
    </main>
  );
}

export default App;
