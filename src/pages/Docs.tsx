import { useState, useMemo, useRef, useEffect } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Search, ChevronRight, ChevronDown, Copy, Check,
  BookOpen, FileText, Menu, X, ExternalLink,
} from "lucide-react";
import { DOCS, DocBlock, DocSection, DocArticle } from "@/data/docs-content";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── helpers ───────────────────────────────────────────────────────────────
const BADGE_COLORS: Record<string, string> = {
  green:  "bg-success/15 text-success border-success/20",
  blue:   "bg-info/15 text-info border-info/20",
  purple: "bg-primary/15 text-primary border-primary/20",
  orange: "bg-warning/15 text-warning border-warning/20",
};
const CARD_COLORS: Record<string, string> = {
  blue:   "border-blue-500/20 bg-blue-500/5",
  purple: "border-primary/20 bg-primary/5",
  green:  "border-success/20 bg-success/5",
  orange: "border-warning/20 bg-warning/5",
};
const CALLOUT_STYLES: Record<string, string> = {
  info:    "border-blue-500 bg-blue-500/10 text-blue-400",
  success: "border-success bg-success/10 text-success",
  warn:    "border-warning bg-warning/10 text-warning",
  danger:  "border-destructive bg-destructive/10 text-destructive",
};
const CALLOUT_ICONS: Record<string, string> = {
  info: "ℹ️", success: "✅", warn: "⚠️", danger: "🚨",
};

// ─── CopyButton ────────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="absolute top-2 right-2 p-1.5 rounded bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

// ─── BlockRenderer ─────────────────────────────────────────────────────────
function BlockRenderer({ block }: { block: DocBlock }) {
  if (block.type === "heading") {
    const Tag = `h${block.level}` as "h2" | "h3" | "h4";
    const sizes = { 2: "text-xl font-bold mt-8 mb-3", 3: "text-base font-semibold mt-6 mb-2", 4: "text-sm font-semibold mt-4 mb-1" };
    return <Tag className={cn(sizes[block.level], "text-foreground")}>{block.text}</Tag>;
  }

  if (block.type === "paragraph") {
    return <p className="text-sm text-muted-foreground leading-relaxed mb-3">{block.text}</p>;
  }

  if (block.type === "divider") {
    return <hr className="border-border my-6" />;
  }

  if (block.type === "callout") {
    return (
      <div className={cn("border-l-4 rounded-r-lg p-4 mb-4 text-sm", CALLOUT_STYLES[block.variant])}>
        <p className="font-semibold flex items-center gap-2 mb-1">
          <span>{CALLOUT_ICONS[block.variant]}</span> {block.title}
        </p>
        <p className="opacity-85 leading-relaxed">{block.text}</p>
      </div>
    );
  }

  if (block.type === "code") {
    return (
      <div className="mb-4">
        {block.label && <p className="text-xs text-muted-foreground mb-1 font-mono">{block.label}</p>}
        <div className="relative rounded-lg bg-[#0d1117] border border-border overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2 bg-white/5 border-b border-border/50">
            <div className="flex gap-1.5">
              <span className="w-3 h-3 rounded-full bg-red-500/60" />
              <span className="w-3 h-3 rounded-full bg-yellow-500/60" />
              <span className="w-3 h-3 rounded-full bg-green-500/60" />
            </div>
            <span className="text-xs text-muted-foreground ml-1">{block.lang}</span>
          </div>
          <CopyButton text={block.code} />
          <pre className="p-4 text-xs text-green-300 font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap break-words">
            {block.code}
          </pre>
        </div>
      </div>
    );
  }

  if (block.type === "table") {
    return (
      <div className="mb-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50">
              {block.headers.map((h) => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                {row.map((cell, j) => (
                  <td key={j} className="px-4 py-2.5 text-sm text-foreground/80 font-mono text-xs leading-relaxed">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (block.type === "list") {
    const Tag = block.ordered ? "ol" : "ul";
    return (
      <Tag className={cn("mb-4 space-y-1.5 text-sm text-muted-foreground", block.ordered ? "list-decimal pl-5" : "list-none pl-0")}>
        {block.items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 leading-relaxed">
            {!block.ordered && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
            <span>{item}</span>
          </li>
        ))}
      </Tag>
    );
  }

  if (block.type === "cards") {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        {block.items.map((card, i) => (
          <div key={i} className={cn("rounded-lg border p-4", CARD_COLORS[card.color] || CARD_COLORS.blue)}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">{card.icon}</span>
              <h4 className="text-sm font-semibold text-foreground">{card.title}</h4>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{card.text}</p>
          </div>
        ))}
      </div>
    );
  }

  return null;
}

// ─── ArticleView ───────────────────────────────────────────────────────────
function ArticleView({ article, section }: { article: DocArticle; section: DocSection }) {
  return (
    <div className="max-w-3xl">
      <div className="mb-6 pb-6 border-b border-border">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          <span>{section.icon}</span>
          <span>{section.title}</span>
          <ChevronRight className="h-3 w-3" />
          <span>{article.title}</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-foreground">{article.title}</h1>
          {article.badge && (
            <Badge variant="outline" className={cn("text-xs", BADGE_COLORS[article.badge.color])}>
              {article.badge.label}
            </Badge>
          )}
        </div>
      </div>
      <div>
        {article.content.map((block, i) => (
          <BlockRenderer key={i} block={block} />
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────
export default function DocsPage() {
  const [activeSection, setActiveSection] = useState(DOCS[0].id);
  const [activeArticle, setActiveArticle] = useState(DOCS[0].articles[0].id);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set([DOCS[0].id]));
  const [search, setSearch] = useState("");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const currentSection = DOCS.find((s) => s.id === activeSection)!;
  const currentArticle = currentSection?.articles.find((a) => a.id === activeArticle)!;

  const navigate = (sectionId: string, articleId: string) => {
    setActiveSection(sectionId);
    setActiveArticle(articleId);
    setMobileSidebarOpen(false);
    contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Search results
  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    const results: { section: DocSection; article: DocArticle; snippet: string }[] = [];
    for (const section of DOCS) {
      for (const article of section.articles) {
        const titleMatch = article.title.toLowerCase().includes(q);
        let snippet = "";
        for (const block of article.content) {
          if (block.type === "paragraph" && block.text.toLowerCase().includes(q)) {
            const idx = block.text.toLowerCase().indexOf(q);
            snippet = block.text.slice(Math.max(0, idx - 30), idx + 80) + "…";
            break;
          }
          if (block.type === "code" && block.code.toLowerCase().includes(q)) {
            snippet = "Encontrado no bloco de código";
            break;
          }
        }
        if (titleMatch || snippet) {
          results.push({ section, article, snippet: snippet || article.title });
        }
      }
    }
    return results;
  }, [search]);

  // Keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        document.getElementById("docs-search")?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const Sidebar = () => (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            id="docs-search"
            placeholder="Buscar... (⌘K)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>

      {/* Search results */}
      {search && (
        <div className="border-b border-border">
          {searchResults.length === 0 ? (
            <p className="text-xs text-muted-foreground p-3">Nenhum resultado</p>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {searchResults.map((r, i) => (
                <button
                  key={i}
                  onClick={() => { navigate(r.section.id, r.article.id); setSearch(""); }}
                  className="w-full text-left p-3 hover:bg-muted/50 border-b border-border/50 last:border-0 transition-colors"
                >
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5">
                    <span>{r.section.icon}</span>
                    <span>{r.section.title}</span>
                  </div>
                  <p className="text-xs font-medium text-foreground">{r.article.title}</p>
                  {r.snippet !== r.article.title && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{r.snippet}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Nav tree */}
      <div className="flex-1 overflow-y-auto py-2">
        {DOCS.map((section) => {
          const expanded = expandedSections.has(section.id);
          return (
            <div key={section.id}>
              <button
                onClick={() => toggleSection(section.id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                <span className="text-sm">{section.icon}</span>
                <span className="flex-1 text-left">{section.title}</span>
                {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
              {expanded && (
                <div className="ml-5 border-l border-border/50">
                  {section.articles.map((article) => {
                    const isActive = activeSection === section.id && activeArticle === article.id;
                    return (
                      <button
                        key={article.id}
                        onClick={() => navigate(section.id, article.id)}
                        className={cn(
                          "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors border-l-2 -ml-px",
                          isActive
                            ? "border-primary text-primary bg-primary/5 font-medium"
                            : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"
                        )}
                      >
                        <FileText className="h-3 w-3 shrink-0 opacity-60" />
                        <span className="flex-1">{article.title}</span>
                        {article.badge && (
                          <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border font-medium", BADGE_COLORS[article.badge.color])}>
                            {article.badge.label}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-border">
        <a
          href="/roteiro-mentoark-crm.pdf"
          target="_blank"
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Baixar PDF completo
        </a>
      </div>
    </div>
  );

  return (
    <CRMLayout>
      <div className="flex h-[calc(100vh-4rem)] -m-4 md:-m-6 overflow-hidden">

        {/* ── Sidebar desktop ─────────────────────────── */}
        <aside className="hidden md:flex flex-col w-64 shrink-0 border-r border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <BookOpen className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Documentação</h2>
          </div>
          <Sidebar />
        </aside>

        {/* ── Mobile sidebar overlay ───────────────────── */}
        {mobileSidebarOpen && (
          <div className="md:hidden fixed inset-0 z-50 flex">
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setMobileSidebarOpen(false)} />
            <aside className="relative z-10 flex flex-col w-72 bg-card border-r border-border">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold">Documentação</h2>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setMobileSidebarOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <Sidebar />
            </aside>
          </div>
        )}

        {/* ── Content area ────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Topbar */}
          <div className="flex items-center gap-3 px-6 py-3 border-b border-border bg-card shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 md:hidden"
              onClick={() => setMobileSidebarOpen(true)}
            >
              <Menu className="h-4 w-4" />
            </Button>
            <nav className="flex items-center gap-1.5 text-xs text-muted-foreground flex-1 min-w-0">
              <span className="shrink-0">{currentSection?.icon}</span>
              <span className="truncate">{currentSection?.title}</span>
              <ChevronRight className="h-3 w-3 shrink-0" />
              <span className="text-foreground font-medium truncate">{currentArticle?.title}</span>
            </nav>
            {/* Prev / Next */}
            <div className="flex items-center gap-1 shrink-0">
              {(() => {
                const all: { sectionId: string; articleId: string }[] = [];
                DOCS.forEach((s) => s.articles.forEach((a) => all.push({ sectionId: s.id, articleId: a.id })));
                const idx = all.findIndex((x) => x.sectionId === activeSection && x.articleId === activeArticle);
                const prev = all[idx - 1];
                const next = all[idx + 1];
                return (
                  <>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={!prev} onClick={() => prev && navigate(prev.sectionId, prev.articleId)}>
                      ← Anterior
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={!next} onClick={() => next && navigate(next.sectionId, next.articleId)}>
                      Próximo →
                    </Button>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Article content */}
          <div ref={contentRef} className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
            {currentArticle ? (
              <ArticleView article={currentArticle} section={currentSection} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <BookOpen className="h-16 w-16 text-muted-foreground/30 mb-4" />
                <p className="text-muted-foreground">Selecione um artigo na barra lateral</p>
              </div>
            )}
          </div>
        </main>
      </div>
    </CRMLayout>
  );
}
