import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowDownUp,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Feather,
  Flower2,
  Globe2,
  Languages,
  LoaderCircle,
  LogOut,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Star,
  Trash2,
  Upload,
  WifiOff,
  X,
} from "lucide-react";
import {
  futureAuxiliary,
  normalize,
  starters,
  verbs as builtinVerbs,
} from "./verbs";
import type { Verb } from "./verbs";
import { api, ApiError } from "./api";
import { LearningContext, exampleAttribution } from "./LearningContext";
import { Copy } from "lucide-react";

type Entry = {
  id: string;
  pt: string;
  fr: string;
  kind: "mot" | "expression" | "verbe";
  note: string;
  example: string;
  favorite: boolean;
  source: "personnel" | "MyMemory";
  revision: number;
  created: string;
};
type Draft = Omit<Entry, "id" | "revision" | "created"> &
  Partial<Pick<Entry, "id" | "revision" | "created">>;
type Translation = {
  text: string;
  cached: boolean;
  quota: { used: number; limit: number };
  input: string;
  direction: "fr-pt" | "pt-fr";
};
const emptyDraft = (): Draft => ({
  pt: "",
  fr: "",
  kind: "mot",
  note: "",
  example: "",
  favorite: false,
  source: "personnel",
});
const verbStorageKey = "caderno-verbs-v1";
const storageKey = "caderno-entries-v1";
function cachedVerbs(): Verb[] {
  try {
    const data = JSON.parse(localStorage.getItem(verbStorageKey) || "[]");
    return Array.isArray(data)
      ? data.filter(
          (v) =>
            typeof v?.pt === "string" &&
            typeof v?.fr === "string" &&
            [v.present, v.past, v.imperfect].every(
              (forms) =>
                Array.isArray(forms) &&
                forms.length === 5 &&
                forms.every((f) => typeof f === "string"),
            ),
        )
      : [];
  } catch {
    return [];
  }
}
function cachedEntries(): Entry[] {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(data)
      ? data.filter(
          (e) =>
            e &&
            [e.id, e.pt, e.fr, e.note, e.example, e.kind].every(
              (v) => typeof v === "string",
            ),
        )
      : [];
  } catch {
    return [];
  }
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-inner">
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Fermer">
            <X size={21} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export default function App() {
  const [tab, setTab] = useState<"translate" | "notebook" | "verbs">(
    "translate",
  );
  const [session, setSession] = useState<
    "loading" | "login" | "ready" | "offline"
  >("loading");
  const [local, setLocal] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("tout");
  const [text, setText] = useState("");
  const [direction, setDirection] = useState<"fr-pt" | "pt-fr">("fr-pt");
  const [translation, setTranslation] = useState<Translation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [quota, setQuota] = useState({ used: 0, limit: 4500 });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [customVerbs, setCustomVerbs] = useState<Verb[]>([]);
  const verbs = [...builtinVerbs, ...customVerbs].sort((a, b) =>
    a.pt.localeCompare(b.pt, "pt-BR"),
  );
  const [addingVerb, setAddingVerb] = useState(false);
  const [verbInput, setVerbInput] = useState({ pt: "", fr: "" });
  const [verbBusy, setVerbBusy] = useState(false);
  const [verbError, setVerbError] = useState("");
  const [deletingVerb, setDeletingVerb] = useState(false);
  const [verb, setVerb] = useState<Verb>(
    builtinVerbs.find((v) => v.pt === "ser")!,
  );
  const [tense, setTense] = useState<"present" | "past" | "imperfect" | "near">(
    "present",
  );
  const [verbSearch, setVerbSearch] = useState("");
  const [settings, setSettings] = useState(false);
  const [password, setPassword] = useState("");
  const [quiz, setQuiz] = useState(false);
  const [quizIndex, setQuizIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const readonly = session === "offline" || !online;
  function notify(message: string) {
    setToast(message);
  }
  async function reload() {
    const [data, fetchedVerbs] = await Promise.all([
      api<Entry[]>("/entries"),
      api<Verb[]>("/verbs"),
    ]);
    setCustomVerbs(fetchedVerbs);
    setVerb(
      (current) =>
        [...builtinVerbs, ...fetchedVerbs].find((v) => v.pt === current.pt) ||
        builtinVerbs.find((v) => v.pt === "ser")!,
    );
    setEntries(data);
    try {
      localStorage.setItem(storageKey, JSON.stringify(data));
      localStorage.setItem(verbStorageKey, JSON.stringify(fetchedVerbs));
    } catch {
      notify(
        "Carnet enregistré sur le serveur, mais le cache hors ligne est plein.",
      );
    }
  }
  function saveVerbCache(data: Verb[]) {
    setCustomVerbs(data);
    try {
      localStorage.setItem(verbStorageKey, JSON.stringify(data));
    } catch {
      notify(
        "Verbes enregistrés sur le serveur, mais le cache hors ligne est plein.",
      );
    }
  }
  async function addVerb(e: FormEvent) {
    e.preventDefault();
    if (readonly || verbBusy) return;
    setVerbBusy(true);
    setVerbError("");
    try {
      const result = await api<{ verb: Verb; added: boolean }>(
        "/verbs",
        "POST",
        verbInput,
      );
      if (result.verb.custom)
        saveVerbCache([
          ...customVerbs.filter(
            (v) => normalize(v.pt) !== normalize(result.verb.pt),
          ),
          result.verb,
        ]);
      setVerb(result.verb);
      setTense("present");
      setVerbSearch("");
      setAddingVerb(false);
      notify(
        result.added
          ? "Verbe ajouté avec ses conjugaisons."
          : "Ce verbe est déjà dans ta liste : le voici.",
      );
    } catch (e) {
      setVerbError(
        e instanceof Error ? e.message : "Ajout impossible. Réessaie.",
      );
    } finally {
      setVerbBusy(false);
    }
  }
  async function removeVerb() {
    if (readonly || !verb.custom) return;
    setVerbBusy(true);
    setVerbError("");
    try {
      await api(`/verbs/${encodeURIComponent(verb.pt)}`, "DELETE", {});
      saveVerbCache(customVerbs.filter((v) => v.pt !== verb.pt));
      setVerb(builtinVerbs.find((v) => v.pt === "ser")!);
      setDeletingVerb(false);
      notify("Verbe retiré de ta liste.");
    } catch (e) {
      setVerbError(e instanceof Error ? e.message : "Suppression impossible.");
    } finally {
      setVerbBusy(false);
    }
  }
  function handleError(e: unknown) {
    if (e instanceof ApiError && e.status === 401) {
      setSession("login");
      setEntries([]);
      setCustomVerbs([]);
      setVerb(builtinVerbs.find((v) => v.pt === "ser")!);
      localStorage.removeItem(storageKey);
      localStorage.removeItem(verbStorageKey);
    }
    setError(e instanceof Error ? e.message : "Connexion indisponible.");
  }
  async function initialize() {
    try {
      const s = await api<{ authenticated: boolean; local: boolean }>(
        "/session",
      );
      setLocal(s.local);
      if (s.authenticated) {
        await reload();
        setSession("ready");
        api<typeof quota>("/usage")
          .then(setQuota)
          .catch(() => {});
      } else {
        setSession("login");
        setEntries([]);
        setCustomVerbs([]);
        setVerb(builtinVerbs.find((v) => v.pt === "ser")!);
        localStorage.removeItem(storageKey);
        localStorage.removeItem(verbStorageKey);
      }
    } catch {
      setSession("offline");
      setEntries(cachedEntries());
      setCustomVerbs(cachedVerbs());
    }
  }
  useEffect(() => {
    void initialize();
    const on = () => {
      setOnline(true);
      void initialize();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  function changeTab(next: typeof tab) {
    setTab(next);
    setError("");
  }
  function edit(value: Draft) {
    setEditorError("");
    setConfirmDelete(false);
    setDraft({ ...value });
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft || readonly) return;
    setSaving(true);
    setEditorError("");
    try {
      await api(
        draft.id ? `/entries/${draft.id}` : "/entries",
        draft.id ? "PUT" : "POST",
        draft,
      );
      await reload();
      setDraft(null);
      notify("Fiche enregistrée dans ton carnet.");
    } catch (e) {
      setEditorError(
        e instanceof Error ? e.message : "Enregistrement impossible.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!draft?.id) return;
    setSaving(true);
    try {
      await api(`/entries/${draft.id}`, "DELETE", { revision: draft.revision });
      await reload();
      setDraft(null);
      notify("Fiche supprimée.");
    } catch (e) {
      setEditorError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function translate(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    setTranslation(null);
    const input = text.trim(),
      requestedDirection = direction;
    try {
      const result = await api<Omit<Translation, "input" | "direction">>(
        "/translate",
        "POST",
        { text: input, direction: requestedDirection },
      );
      setTranslation({ ...result, input, direction: requestedDirection });
      setQuota(result.quota);
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }
  const filtered = entries.filter(
    (e) =>
      (filter === "tout" ||
        (filter === "favoris" && e.favorite) ||
        e.kind === filter) &&
      normalize(`${e.pt} ${e.fr} ${e.note}`).includes(normalize(search)),
  );
  const matchingVerbs = verbs.filter((v) =>
    normalize(`${v.pt} ${v.fr}`).includes(normalize(verbSearch)),
  );
  const freshResult =
    translation &&
    translation.input === text.trim() &&
    translation.direction === direction
      ? translation
      : null;
  const knownVerb = freshResult
    ? verbs.find(
        (v) =>
          normalize(v.pt) ===
          normalize(
            (direction === "fr-pt"
              ? freshResult.text
              : freshResult.input
            ).replace(/[.!?]$/, ""),
          ),
      )
    : null;
  async function download() {
    try {
      const data = await api("/export");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `caderno-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("Sauvegarde téléchargée.");
    } catch (e) {
      handleError(e);
    }
  }
  async function importFile(file?: File) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("Le fichier dépasse 2 Mo.");
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ added: number; verbsAdded: number }>(
        "/import",
        "POST",
        JSON.parse(await file.text()),
      );
      await reload();
      notify(
        `${result.added} fiche(s) et ${result.verbsAdded} verbe(s) ajouté(s).`,
      );
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
      if (upload.current) upload.current.value = "";
    }
  }
  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/login", "POST", { password });
      setPassword("");
      await initialize();
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }
  if (session === "loading")
    return (
      <div className="loading">
        <LoaderCircle className="spin" />
        <p>On ouvre ton carnet…</p>
      </div>
    );
  if (session === "login")
    return (
      <main className="login-page">
        <div className="login-card">
          <div className="brand-mark">
            <BookOpen />
          </div>
          <span className="eyebrow">BEM-VINDO AO SEU CADERNO</span>
          <h1>
            Un peu de portugais,
            <br />
            <em>chaque jour.</em>
          </h1>
          <p>Retrouve tes mots, tes expressions et tes petits progrès.</p>
          <form onSubmit={login}>
            <label>
              Mot de passe
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <ArrowRight size={18} />
              )}{" "}
              Ouvrir mon carnet
            </button>
          </form>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </div>
      </main>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            changeTab("translate");
          }}
        >
          <span className="brand-mark">
            <BookOpen size={22} />
          </span>
          <span>
            Caderno<span className="brand-sub">LE PORTUGAIS, AU QUOTIDIEN</span>
          </span>
        </a>
        <div className="sidebar-country">
          <span className="brazil-dot" />
          Português do Brasil
          <ArrowUpRight size={14} />
        </div>
        <nav aria-label="Navigation principale">
          {(
            [
              ["translate", Languages, "Traduire"],
              ["notebook", BookOpen, "Mon carnet"],
              ["verbs", Feather, "Verbes"],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              aria-current={tab === id ? "page" : undefined}
              className={tab === id ? "nav-item active" : "nav-item"}
              onClick={() => changeTab(id)}
            >
              <Icon size={20} />
              <span>{label}</span>
              {id === "notebook" && <small>{entries.length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <Flower2 size={31} />
          <p>
            Petit à petit,
            <br />
            <em>on va loin.</em>
          </p>
          <span>De pouquinho em pouquinho.</span>
        </div>
        <button className="profile" onClick={() => setSettings(true)}>
          <span className="avatar">P</span>
          <span>
            Mon espace<small>Français → Português</small>
          </span>
          <Settings2 size={17} />
        </button>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <span className="breadcrumb">
            Mon espace <ChevronRight size={13} />{" "}
            <strong>
              {tab === "translate"
                ? "Traduire"
                : tab === "notebook"
                  ? "Mon carnet"
                  : "Verbes"}
            </strong>
          </span>
          <span className="status">
            <span className={readonly ? "status-dot offline" : "status-dot"} />
            {readonly
              ? "Lecture hors connexion"
              : local
                ? "Version locale"
                : "Carnet connecté"}
          </span>
          <button
            className="icon-button mobile-settings"
            aria-label="Paramètres"
            onClick={() => setSettings(true)}
          >
            <Settings2 size={20} />
          </button>
        </header>
        <main className="main-content">
          {readonly && (
            <div className="offline-banner">
              <WifiOff size={18} />
              <span>
                Consultation du dernier carnet conservé sur cet appareil.
                Reconnecte-toi pour modifier ou traduire.
              </span>
              <button onClick={() => void initialize()}>Réessayer</button>
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
              <button
                className="icon-button"
                aria-label="Fermer l’erreur"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {tab === "translate" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">
                    <span className="small-line" /> UM POUQUINHO, TODO DIA
                  </span>
                  <h1>
                    Les mots pour <em>ta vie ici.</em>
                  </h1>
                  <p>
                    Une traduction, une découverte. Et un mot de plus dans ton
                    carnet.
                  </p>
                </div>
                <div className="heading-flower" aria-hidden="true">
                  <Flower2 size={63} strokeWidth={1} />
                </div>
              </div>
              <section className="translator" aria-label="Traduction">
                <div className="language-bar">
                  <span>
                    <span className="language-code">
                      {direction === "fr-pt" ? "FR" : "BR"}
                    </span>
                    {direction === "fr-pt" ? "Français" : "Portugais brésilien"}
                  </span>
                  <button
                    disabled={busy}
                    aria-label="Inverser les langues"
                    className="swap"
                    onClick={() => {
                      setDirection(direction === "fr-pt" ? "pt-fr" : "fr-pt");
                      setText(freshResult?.text || "");
                      setTranslation(null);
                      setError("");
                    }}
                  >
                    <ArrowDownUp size={18} />
                  </button>
                  <span>
                    {direction === "fr-pt" ? "Portugais brésilien" : "Français"}
                    <span className="language-code target">
                      {direction === "fr-pt" ? "BR" : "FR"}
                    </span>
                  </span>
                </div>
                <form onSubmit={translate}>
                  <div className="translation-input">
                    <label className="sr-only" htmlFor="translation">
                      Texte à traduire
                    </label>
                    <textarea
                      id="translation"
                      disabled={busy}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={(e) => {
                        if (
                          (e.ctrlKey || e.metaKey) &&
                          e.key === "Enter" &&
                          !busy &&
                          !readonly &&
                          text.trim() &&
                          new TextEncoder().encode(text).length <= 500
                        ) {
                          e.preventDefault();
                          e.currentTarget.form?.requestSubmit();
                        }
                      }}
                      maxLength={500}
                      placeholder={
                        direction === "fr-pt"
                          ? "Un mot ou une phrase…"
                          : "Uma palavra ou uma frase…"
                      }
                      rows={4}
                    />
                    <span className="input-count">
                      {new TextEncoder().encode(text).length} / 500 octets
                    </span>
                  </div>
                  <div className="translation-actions">
                    <span>
                      <Sparkles size={15} /> Un mot, une expression, une phrase.
                    </span>
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        readonly ||
                        !text.trim() ||
                        new TextEncoder().encode(text).length > 500
                      }
                    >
                      {busy ? (
                        <LoaderCircle className="spin" size={17} />
                      ) : null}
                      {busy ? "Traduction…" : "Traduire"}
                      {!busy && <ArrowRight size={18} />}
                    </button>
                  </div>
                </form>
                {freshResult && (
                  <div className="translation-result" aria-live="polite">
                    <span className="eyebrow">
                      {direction === "fr-pt" ? "EM PORTUGUÊS" : "EN FRANÇAIS"}
                    </span>
                    <p lang={direction === "fr-pt" ? "pt-BR" : "fr"}>
                      {freshResult.text}
                    </p>
                    <div className="result-actions">
                      <button
                        className="primary"
                        disabled={readonly}
                        onClick={() =>
                          edit({
                            ...emptyDraft(),
                            pt:
                              direction === "fr-pt"
                                ? freshResult.text
                                : freshResult.input,
                            fr:
                              direction === "fr-pt"
                                ? freshResult.input
                                : freshResult.text,
                            kind: knownVerb
                              ? "verbe"
                              : /\s/.test(freshResult.text.trim())
                                ? "expression"
                                : "mot",
                            source: "MyMemory",
                          })
                        }
                      >
                        <Bookmark size={17} />
                        Garder dans mon carnet
                      </button>
                      <button
                        className="text-button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              freshResult.text,
                            );
                            notify("Traduction copiée.");
                          } catch {
                            notify(
                              "Copie indisponible : sélectionne le texte pour le copier.",
                            );
                          }
                        }}
                      >
                        <Copy size={16} />
                        Copier
                      </button>
                      {knownVerb && (
                        <button
                          className="text-button"
                          onClick={() => {
                            setVerb(knownVerb);
                            changeTab("verbs");
                          }}
                        >
                          Conjuguer
                          <ArrowRight size={16} />
                        </button>
                      )}
                    </div>
                    <small>
                      Traduction automatique MyMemory · À vérifier selon le
                      contexte{freshResult.cached ? " · Déjà en mémoire" : ""}
                    </small>
                  </div>
                )}
                <div className="translator-footer">
                  <span className="service-dot" />
                  Service gratuit MyMemory
                  <span className="quota">
                    {quota.used.toLocaleString("fr-FR")} /{" "}
                    {quota.limit.toLocaleString("fr-FR")} caractères aujourd’hui
                  </span>
                </div>
              </section>
              <p className="privacy-note">
                MyMemory reçoit le texte à traduire. Pour les compléments, le
                mot portugais est envoyé à Sinônimos et ta recherche à Tatoeba.
                Tes notes restent dans ton carnet.
              </p>
              {freshResult && (
                <LearningContext
                  pt={
                    direction === "fr-pt" ? freshResult.text : freshResult.input
                  }
                  query={freshResult.input}
                  language={direction === "fr-pt" ? "fr" : "pt"}
                  readonly={readonly}
                  onSynonym={(word) => {
                    setDirection("pt-fr");
                    setText(word);
                    setTranslation(null);
                    document.getElementById("translation")?.focus();
                  }}
                  onSave={(example) =>
                    edit({
                      ...emptyDraft(),
                      pt:
                        direction === "fr-pt"
                          ? freshResult.text
                          : freshResult.input,
                      fr:
                        direction === "fr-pt"
                          ? freshResult.input
                          : freshResult.text,
                      kind: knownVerb
                        ? "verbe"
                        : /\s/.test(
                              (direction === "fr-pt"
                                ? freshResult.text
                                : freshResult.input
                              ).trim(),
                            )
                          ? "expression"
                          : "mot",
                      example: example.pt,
                      note: exampleAttribution(example),
                      source: "MyMemory",
                    })
                  }
                />
              )}
              <div className="section-heading">
                <h2>Pour les petits moments du quotidien</h2>
                <span>À ESSAYER</span>
              </div>
              <div className="quick-prompts">
                {[
                  "Un café, s’il vous plaît.",
                  "Combien ça coûte ?",
                  "Je suis en train d’apprendre.",
                ].map((q, i) => (
                  <button
                    disabled={busy}
                    key={q}
                    onClick={() => {
                      setDirection("fr-pt");
                      setText(q);
                      setTranslation(null);
                      document.getElementById("translation")?.focus();
                    }}
                  >
                    <span className="prompt-number">0{i + 1}</span>
                    <span>{q}</span>
                    <ArrowUpRight size={17} />
                  </button>
                ))}
              </div>
              <div className="discovery-grid">
                <section className="word-card">
                  <div className="card-eyebrow">
                    <span>
                      <Flower2 size={16} /> LE MOT À EMPORTER
                    </span>
                    <span className="small-tag">NOM FÉMININ</span>
                  </div>
                  <h2 lang="pt-BR">
                    saudade<span> / sawˈdadʒi /</span>
                  </h2>
                  <p>
                    Le manque d’une personne, d’un lieu ou d’un moment qu’on
                    aimerait retrouver.
                  </p>
                  <blockquote lang="pt-BR">
                    “Estou com saudade de você.”<small>Tu me manques.</small>
                  </blockquote>
                  <button
                    className="text-button"
                    disabled={readonly}
                    onClick={() => edit({ ...emptyDraft(), ...starters[1] })}
                  >
                    Garder ce mot <Plus size={17} />
                  </button>
                </section>
                <section className="notebook-preview">
                  <span className="eyebrow">TON PORTUGAIS PREND FORME</span>
                  <BookOpen
                    className="notebook-art"
                    size={40}
                    strokeWidth={1}
                  />
                  <h2>
                    {entries.length
                      ? `${entries.length} petites découvertes.`
                      : "Tout commence par un mot."}
                  </h2>
                  <p>
                    {entries.length
                      ? "Tes mots, tes exemples, tes souvenirs. Tous au même endroit."
                      : "Garde les mots que tu croises, avec tes propres notes. Ce carnet est à toi."}
                  </p>
                  <button
                    className="text-button"
                    onClick={() => changeTab("notebook")}
                  >
                    Ouvrir mon carnet
                    <ArrowRight size={17} />
                  </button>
                </section>
              </div>
            </>
          )}
          {tab === "notebook" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">PALAVRAS QUE FICAM</span>
                  <h1>
                    Ton carnet, <em>tes mots.</em>
                  </h1>
                  <p>
                    {entries.length} fiche{entries.length !== 1 ? "s" : ""} pour
                    te sentir un peu plus chez toi.
                  </p>
                </div>
                <button
                  className="primary"
                  disabled={readonly}
                  onClick={() => edit(emptyDraft())}
                >
                  <Plus size={18} />
                  Ajouter une fiche
                </button>
              </div>
              <div className="notebook-toolbar">
                <label className="search-box">
                  <Search size={18} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Un mot, un sens, une note…"
                    aria-label="Rechercher dans mon carnet"
                  />
                </label>
                <button
                  className="secondary"
                  disabled={!entries.length}
                  onClick={() => {
                    setQuizIndex(0);
                    setRevealed(false);
                    setQuiz(true);
                  }}
                >
                  <Sparkles size={17} />
                  Réviser
                </button>
                <button
                  className="icon-button"
                  aria-label="Actualiser le carnet"
                  disabled={readonly}
                  onClick={() =>
                    reload()
                      .then(() => notify("Carnet actualisé."))
                      .catch(handleError)
                  }
                >
                  <ArrowDownUp size={18} />
                </button>
              </div>
              <div className="filter-row" aria-label="Filtrer les fiches">
                {[
                  ["tout", "Tout"],
                  ["mot", "Mots"],
                  ["expression", "Expressions"],
                  ["verbe", "Verbes"],
                  ["favoris", "Favoris"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    className={filter === id ? "chip selected" : "chip"}
                    aria-pressed={filter === id}
                    onClick={() => setFilter(id)}
                  >
                    {id === "favoris" && <Star size={14} />} {label}
                  </button>
                ))}
              </div>
              {filtered.length ? (
                <div className="entries-grid">
                  {filtered.map((e) => (
                    <button
                      className="entry-card"
                      key={e.id}
                      onClick={() => edit(e)}
                    >
                      <div>
                        <span className="small-tag">{e.kind}</span>
                        {e.favorite && <Star size={16} fill="currentColor" />}
                      </div>
                      <h2 lang="pt-BR">{e.pt}</h2>
                      <p>{e.fr}</p>
                      {e.note && <small>{e.note}</small>}
                      <span className="entry-bottom">
                        {new Date(e.created).toLocaleDateString("fr-FR", {
                          day: "numeric",
                          month: "short",
                        })}
                        <ArrowUpRight size={18} />
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <BookOpen size={38} strokeWidth={1} />
                  <h2>
                    {entries.length
                      ? "Aucune fiche trouvée."
                      : "Une première page à remplir."}
                  </h2>
                  <p>
                    {entries.length
                      ? "Essaie un autre mot ou un autre filtre."
                      : "Ajoute un mot entendu au café, une expression ou ta première traduction."}
                  </p>
                  {!entries.length && (
                    <button
                      className="primary"
                      disabled={readonly}
                      onClick={() => edit(emptyDraft())}
                    >
                      Créer ma première fiche
                      <Plus size={17} />
                    </button>
                  )}
                </div>
              )}
              {!entries.length && (
                <>
                  <div className="section-heading">
                    <h2>Quelques idées pour commencer</h2>
                    <span>EXEMPLES À AJOUTER</span>
                  </div>
                  <div className="starter-grid">
                    {starters.map((s) => (
                      <button
                        key={s.pt}
                        disabled={readonly}
                        onClick={() => edit({ ...emptyDraft(), ...s })}
                      >
                        <strong lang="pt-BR">{s.pt}</strong>
                        <span>{s.fr}</span>
                        <Plus size={18} />
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          {tab === "verbs" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">UM VERBO, MIL POSSIBILIDADES</span>
                  <h1>
                    Les verbes qui <em>font parler.</em>
                  </h1>
                  <p>
                    {verbs.length} verbes du quotidien, quatre temps. À
                    retrouver même hors connexion.
                  </p>
                </div>
                <button
                  className="primary"
                  disabled={readonly}
                  onClick={() => {
                    setVerbInput({ pt: "", fr: "" });
                    setVerbError("");
                    setAddingVerb(true);
                  }}
                >
                  <Plus size={18} /> Ajouter un verbe
                </button>
              </div>
              <div className="verbs-layout">
                <section className="verb-directory">
                  <label className="search-box">
                    <Search size={17} />
                    <input
                      value={verbSearch}
                      onChange={(e) => setVerbSearch(e.target.value)}
                      placeholder="Chercher un verbe…"
                      aria-label="Chercher un verbe"
                    />
                  </label>
                  <p className="verb-count" role="status">
                    {matchingVerbs.length} / {verbs.length} verbes · Recherche
                    en français ou portugais
                  </p>
                  <div
                    className="verb-list"
                    role="region"
                    aria-label="Liste des verbes"
                    tabIndex={0}
                  >
                    {matchingVerbs.map((v) => (
                      <button
                        key={v.pt}
                        className={
                          verb.pt === v.pt
                            ? "verb-option selected"
                            : "verb-option"
                        }
                        aria-pressed={verb.pt === v.pt}
                        onClick={() => setVerb(v)}
                      >
                        <span>
                          <strong>{v.pt}</strong>
                          <small>{v.fr}</small>
                        </span>
                        <ChevronRight size={17} />
                      </button>
                    ))}
                    {!matchingVerbs.length && (
                      <p className="muted">
                        Ce verbe n’est pas encore dans cette sélection.
                      </p>
                    )}
                  </div>
                </section>
                <section className="conjugation">
                  <div className="verb-heading">
                    <div>
                      <span className="small-tag">
                        {verb.irregular
                          ? "VERBE IRRÉGULIER"
                          : "FORMES RÉGULIÈRES"}
                      </span>
                      <h2>
                        {verb.pt}
                        <span>{verb.fr}</span>
                      </h2>
                    </div>
                    <button
                      className="icon-button"
                      disabled={readonly}
                      aria-label="Ajouter ce verbe au carnet"
                      onClick={() =>
                        edit({
                          ...emptyDraft(),
                          pt: verb.pt,
                          fr: verb.fr,
                          kind: "verbe",
                          note: verb.hint,
                          example: verb.example,
                        })
                      }
                    >
                      <Bookmark size={21} />
                    </button>
                  </div>
                  <label className="tense-select">
                    Temps
                    <select
                      value={tense}
                      onChange={(e) => setTense(e.target.value as typeof tense)}
                    >
                      <option value="present">Présent · Presente</option>
                      <option value="past">
                        Passé accompli · Pretérito perfeito
                      </option>
                      <option value="imperfect">
                        Imparfait · Pretérito imperfeito
                      </option>
                      <option value="near">
                        Futur proche · Ir + infinitif
                      </option>
                    </select>
                  </label>
                  <div className="conjugation-table">
                    {[
                      ["eu", 0],
                      ["tu", 1],
                      ["você / ele / ela", 2],
                      ["a gente", 2],
                      ["nós", 3],
                      ["vocês / eles / elas", 4],
                    ].map(([pronoun, index]) => (
                      <div key={pronoun}>
                        <span lang="pt-BR">{pronoun}</span>
                        <strong
                          className={
                            verb.irregular && tense !== "near"
                              ? "irregular-form"
                              : ""
                          }
                          lang="pt-BR"
                        >
                          {tense === "near"
                            ? `${futureAuxiliary[index as number]} ${verb.pt}`
                            : verb[tense][index as number]}
                        </strong>
                      </div>
                    ))}
                  </div>
                  {(verb.hint || verb.example) && (
                    <div className="verb-tip">
                      <Sparkles size={17} />
                      <div>
                        <p>{verb.hint}</p>
                        <em lang="pt-BR">{verb.example}</em>
                      </div>
                    </div>
                  )}
                  <p className="verb-footnote">
                    Au Brésil, « você » et « a gente » utilisent la 3e personne
                    du singulier. « Tu » varie selon les régions ; la forme
                    standard est présentée ici. Les verbes irréguliers sont
                    signalés en couleur.
                  </p>
                  <a
                    className="reference"
                    href={
                      verb.source ||
                      `https://www.conjugacao.com.br/verbo-${normalize(verb.pt)}/`
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    Consulter la conjugaison de référence
                    <ArrowUpRight size={13} />
                  </a>
                  {verb.custom && (
                    <p>
                      <button
                        className="text-button"
                        disabled={readonly}
                        onClick={() => {
                          setVerbError("");
                          setDeletingVerb(true);
                        }}
                      >
                        <Trash2 size={16} /> Retirer ce verbe ajouté
                      </button>
                    </p>
                  )}
                </section>
              </div>
            </>
          )}
          <footer className="page-footer">
            <span>
              Caderno <span className="footer-dot">•</span> Feito para o seu dia
              a dia.
            </span>
            <span>Un mot après l’autre.</span>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Navigation mobile">
        {(
          [
            ["translate", Languages, "Traduire"],
            ["notebook", BookOpen, "Mon carnet"],
            ["verbs", Feather, "Verbes"],
          ] as const
        ).map(([id, Icon, label]) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            className={tab === id ? "active" : ""}
            onClick={() => changeTab(id)}
          >
            <Icon size={22} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {addingVerb && (
        <Modal
          title="Ajouter un verbe"
          onClose={() => {
            if (!verbBusy) setAddingVerb(false);
          }}
        >
          <form className="editor" onSubmit={addVerb}>
            <p className="muted">
              Choisis un infinitif portugais : ses formes au présent, au passé
              accompli, à l’imparfait et au futur proche seront ajoutées à ta
              liste.
            </p>
            <label>
              Infinitif portugais
              <input
                autoFocus
                required
                maxLength={35}
                autoCapitalize="none"
                spellCheck={false}
                placeholder="Ex. : dirigir"
                value={verbInput.pt}
                disabled={verbBusy}
                onChange={(e) =>
                  setVerbInput({ ...verbInput, pt: e.target.value })
                }
              />
            </label>
            <label>
              Sens en français
              <input
                required
                maxLength={120}
                placeholder="Ex. : conduire"
                value={verbInput.fr}
                disabled={verbBusy}
                onChange={(e) =>
                  setVerbInput({ ...verbInput, fr: e.target.value })
                }
              />
            </label>
            <p className="muted">
              L’infinitif est envoyé à Conjugação pour récupérer les formes de
              référence. Une fois ajouté, le verbe reste consultable hors
              connexion. Pour l’instant, utilise un infinitif simple, sans « -se
              ».
            </p>
            {verbError && (
              <p className="error" role="alert">
                {verbError}
              </p>
            )}
            <div className="editor-actions">
              <button className="primary" disabled={readonly || verbBusy}>
                {verbBusy ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <Plus size={17} />
                )}
                {verbBusy
                  ? "Recherche des conjugaisons…"
                  : "Ajouter avec les conjugaisons"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {deletingVerb && (
        <Modal
          title="Retirer ce verbe"
          onClose={() => {
            if (!verbBusy) setDeletingVerb(false);
          }}
        >
          <p>
            Retirer « {verb.pt} » de ta liste de verbes ? Les fiches de ton
            carnet sont conservées.
          </p>
          {verbError && (
            <p className="error" role="alert">
              {verbError}
            </p>
          )}
          <div className="editor-actions">
            <button
              className="secondary"
              disabled={verbBusy}
              onClick={() => setDeletingVerb(false)}
            >
              Annuler
            </button>
            <button
              className="danger-button"
              disabled={verbBusy || readonly}
              onClick={() => void removeVerb()}
            >
              Oui, retirer
            </button>
          </div>
        </Modal>
      )}
      {draft && (
        <Modal
          title={draft.id ? "Ma fiche" : "Une nouvelle découverte"}
          onClose={() => {
            if (!saving) setDraft(null);
          }}
        >
          <form onSubmit={save} className="editor">
            <div className="form-columns">
              <label>
                Portugais brésilien
                <input
                  autoFocus
                  value={draft.pt}
                  maxLength={1000}
                  required
                  disabled={readonly}
                  onChange={(e) => setDraft({ ...draft, pt: e.target.value })}
                />
              </label>
              <label>
                Français / sens
                <input
                  value={draft.fr}
                  maxLength={1000}
                  required
                  disabled={readonly}
                  onChange={(e) => setDraft({ ...draft, fr: e.target.value })}
                />
              </label>
            </div>
            <label>
              Type
              <select
                value={draft.kind}
                disabled={readonly}
                onChange={(e) =>
                  setDraft({ ...draft, kind: e.target.value as Entry["kind"] })
                }
              >
                <option value="mot">Mot</option>
                <option value="expression">Expression</option>
                <option value="verbe">Verbe</option>
              </select>
            </label>
            <label>
              Un exemple en contexte
              <textarea
                value={draft.example}
                rows={2}
                maxLength={1000}
                disabled={readonly}
                placeholder="Une phrase pour mieux le retenir…"
                onChange={(e) =>
                  setDraft({ ...draft, example: e.target.value })
                }
              />
            </label>
            <label>
              Mes notes
              <textarea
                value={draft.note}
                rows={3}
                maxLength={4000}
                disabled={readonly}
                placeholder="Un autre sens, où je l’ai entendu, une astuce…"
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.favorite}
                disabled={readonly}
                onChange={(e) =>
                  setDraft({ ...draft, favorite: e.target.checked })
                }
              />
              Garder dans mes favoris
            </label>
            {editorError && (
              <p className="error" role="alert">
                {editorError}
              </p>
            )}
            <div className="editor-actions">
              {draft.id && (
                <button
                  type="button"
                  className="danger-button"
                  disabled={saving || readonly}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={17} />
                  Supprimer
                </button>
              )}
              <button className="primary" disabled={saving || readonly}>
                {saving ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <Check size={17} />
                )}
                Enregistrer
              </button>
            </div>
            {confirmDelete && (
              <div className="delete-confirm">
                <p>Supprimer définitivement cette fiche ?</p>
                <button
                  type="button"
                  className="danger-button"
                  disabled={saving}
                  onClick={() => void remove()}
                >
                  Oui, supprimer
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setConfirmDelete(false)}
                >
                  Annuler
                </button>
              </div>
            )}
          </form>
        </Modal>
      )}
      {settings && (
        <Modal title="Mon espace" onClose={() => setSettings(false)}>
          <div className="settings-content">
            <p className="muted">
              Ton carnet personnel de portugais brésilien.
            </p>
            <h3>Sur ton iPhone</h3>
            <p>
              Ouvre Caderno dans Safari, touche <b>Partager</b>, puis{" "}
              <b>Sur l’écran d’accueil</b>. Les fiches déjà chargées et les
              verbes restent consultables hors connexion.
            </p>
            <h3>Mes données</h3>
            <p>
              Le carnet est enregistré sur le serveur. Une copie reste sur cet
              appareil pour la lecture hors connexion. Les modifications
              nécessitent une connexion.
            </p>
            <div className="settings-actions">
              <button
                className="secondary"
                disabled={readonly}
                onClick={() => void download()}
              >
                <Download size={17} />
                Exporter mon carnet
              </button>
              <button
                className="secondary"
                disabled={readonly || busy}
                onClick={() => upload.current?.click()}
              >
                <Upload size={17} />
                Importer une sauvegarde
              </button>
              <input
                ref={upload}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => void importFile(e.target.files?.[0])}
              />
            </div>
            <small>
              L’export inclut aussi tes verbes ajoutés. L’import ajoute les
              fiches et verbes absents sans remplacer ceux qui existent.
            </small>
            <h3>Traductions et compléments gratuits</h3>
            <p>
              MyMemory reçoit uniquement le texte demandé. La limite de Caderno
              est de 4 500 caractères par jour (UTC), sous le quota gratuit
              annoncé de 5 000. Le fournisseur peut aussi limiter les requêtes.
              Les traductions sont automatiques et peuvent nécessiter une
              correction.
            </p>
            <a
              href="https://mymemory.translated.net/doc/usagelimits.php"
              target="_blank"
              rel="noreferrer"
              className="reference"
            >
              Conditions et limites MyMemory
              <ArrowUpRight size={13} />
            </a>
            <p>
              Les synonymes proviennent de Sinônimos.com.br ; les phrases
              bilingues de Tatoeba (auteurs et licences indiqués avec chaque
              exemple). Leur disponibilité dépend de ces sources. Les exemples
              gardés dans ton carnet restent consultables hors connexion.
            </p>
            <div className="settings-bottom">
              <button
                className="secondary"
                onClick={() => {
                  localStorage.removeItem(storageKey);
                  localStorage.removeItem(verbStorageKey);
                  notify("Copie hors ligne effacée sur cet appareil.");
                }}
              >
                Effacer la copie hors ligne
              </button>
              {!local && (
                <button
                  className="text-button"
                  onClick={async () => {
                    try {
                      await api("/logout", "POST", {});
                      localStorage.removeItem(storageKey);
                      localStorage.removeItem(verbStorageKey);
                      setEntries([]);
                      setCustomVerbs([]);
                      setVerb(builtinVerbs.find((v) => v.pt === "ser")!);
                      setSettings(false);
                      setSession("login");
                    } catch (e) {
                      handleError(e);
                    }
                  }}
                >
                  <LogOut size={17} />
                  Se déconnecter
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
      {quiz && entries.length > 0 && (
        <Modal
          title="Un petit moment pour réviser"
          onClose={() => setQuiz(false)}
        >
          <div className="quiz">
            <span className="eyebrow">
              {quizIndex + 1} / {entries.length}
            </span>
            <h2 lang="pt-BR">{entries[quizIndex]?.pt}</h2>
            <p>
              {revealed ? entries[quizIndex]?.fr : "Tu te souviens du sens ?"}
            </p>
            {revealed ? (
              <button
                className="primary"
                onClick={() => {
                  if (quizIndex + 1 >= entries.length) {
                    setQuiz(false);
                    notify("Bien joué ! Tu as parcouru ton carnet.");
                  } else {
                    setQuizIndex(quizIndex + 1);
                    setRevealed(false);
                  }
                }}
              >
                {quizIndex + 1 >= entries.length
                  ? "Terminer"
                  : "Fiche suivante"}
                <ChevronRight size={17} />
              </button>
            ) : (
              <button className="primary" onClick={() => setRevealed(true)}>
                Voir la réponse
              </button>
            )}
          </div>
        </Modal>
      )}
      {toast && (
        <div role="status" className="toast">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
