import { useEffect, useState } from "react";
import { Bookmark, LoaderCircle, RefreshCw, ArrowUpRight } from "lucide-react";
import { api } from "./api";
export type Example = {
  pt: string;
  fr: string;
  ptId: number;
  frId: number;
  ptAuthor: string;
  frAuthor: string;
  ptLicense: string;
  frLicense: string;
};
type Status = "ready" | "empty" | "unavailable" | "unsupported";
type ContextData = {
  synonyms: {
    status: Status;
    groups: { sense: string; words: string[] }[];
    source?: string;
  };
  examples: { status: Status; items: Example[] };
};
export function exampleAttribution(e: Example) {
  return `${e.fr}\n\nTatoeba : ${e.ptAuthor} (${e.ptLicense}) https://tatoeba.org/fr/sentences/show/${e.ptId}\nTraduction : ${e.frAuthor} (${e.frLicense}) https://tatoeba.org/fr/sentences/show/${e.frId}`;
}
function License({ name }: { name: string }) {
  return (
    <a
      href={
        name.startsWith("CC0")
          ? "https://creativecommons.org/publicdomain/zero/1.0/"
          : "https://creativecommons.org/licenses/by/2.0/fr/"
      }
      target="_blank"
      rel="noreferrer"
    >
      {name}
    </a>
  );
}
export function LearningContext({
  pt,
  query,
  language,
  readonly,
  onSave,
  onSynonym,
}: {
  pt: string;
  query: string;
  language: "pt" | "fr";
  readonly: boolean;
  onSave: (example: Example) => void;
  onSynonym: (word: string) => void;
}) {
  const [data, setData] = useState<ContextData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    setLoading(true);
    api<ContextData>(
      "/context",
      "POST",
      { pt, query, language },
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "Les compléments sont indisponibles.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [pt, query, language, retry]);
  const unavailable =
    error ||
    data?.examples.status === "unavailable" ||
    data?.synonyms.status === "unavailable";
  return (
    <section
      className="learning-context"
      aria-label="Synonymes et exemples"
      aria-busy={loading}
    >
      <div className="context-heading">
        <div>
          <span className="eyebrow">POUR MIEUX RETENIR</span>
          <h2>Le mot prend vie.</h2>
        </div>
        {unavailable && (
          <button
            className="text-button"
            disabled={loading || readonly}
            onClick={() => setRetry((v) => v + 1)}
          >
            <RefreshCw size={16} />
            Réessayer les compléments
          </button>
        )}
      </div>
      {loading && (
        <p className="context-loading" role="status">
          <LoaderCircle size={17} className="spin" />
          Recherche de synonymes et de phrases…
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error} Ta traduction reste disponible.
        </p>
      )}
      {data && (
        <>
          <div className="synonyms-block">
            <h3>Synonymes en portugais</h3>
            {data.synonyms.status === "ready" ? (
              <>
                <p className="muted">
                  Choisis selon le sens de ta phrase. Touche un synonyme pour le
                  traduire.
                </p>
                {data.synonyms.groups.map((group) => (
                  <div className="synonym-group" key={group.sense}>
                    <p lang="pt-BR">{group.sense}</p>
                    <div className="synonym-chips">
                      {group.words.map((word) => (
                        <button
                          key={word}
                          lang="pt-BR"
                          disabled={readonly}
                          onClick={() => onSynonym(word)}
                          aria-label={`Traduire le synonyme ${word}`}
                        >
                          {word}
                          <ArrowUpRight size={14} />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <a
                  className="reference"
                  href={data.synonyms.source}
                  target="_blank"
                  rel="noreferrer"
                >
                  Source : Sinônimos.com.br
                  <ArrowUpRight size={13} />
                </a>
              </>
            ) : (
              <p className="muted">
                {data.synonyms.status === "unsupported"
                  ? "Les synonymes sont proposés pour un mot seul. Essaie de traduire le mot qui t’intéresse."
                  : data.synonyms.status === "unavailable"
                    ? "Le dictionnaire est momentanément indisponible."
                    : "Aucun synonyme trouvé pour ce mot dans cette source."}
              </p>
            )}
          </div>
          <div className="examples-block">
            <h3>Dans une phrase</h3>
            {data.examples.status === "ready" ? (
              <>
                <p className="muted">
                  Exemples bilingues de la communauté Tatoeba. Le sens et la
                  variété de portugais peuvent différer de ta traduction.
                </p>
                <div className="context-examples">
                  {data.examples.items.map((e) => (
                    <article className="context-example" key={e.ptId}>
                      <p className="example-pt" lang="pt">
                        {e.pt}
                      </p>
                      <p className="example-fr" lang="fr">
                        {e.fr}
                      </p>
                      <button
                        className="text-button"
                        disabled={readonly}
                        onClick={() => onSave(e)}
                      >
                        <Bookmark size={16} />
                        Garder avec cet exemple
                      </button>
                      <details className="example-source">
                        <summary>Source et auteurs</summary>
                        <p>
                          <a
                            target="_blank"
                            rel="noreferrer"
                            href={`https://tatoeba.org/fr/sentences/show/${e.ptId}`}
                          >
                            Portugais : {e.ptAuthor}
                          </a>{" "}
                          · <License name={e.ptLicense} />
                          <br />
                          <a
                            target="_blank"
                            rel="noreferrer"
                            href={`https://tatoeba.org/fr/sentences/show/${e.frId}`}
                          >
                            Français : {e.frAuthor}
                          </a>{" "}
                          · <License name={e.frLicense} />
                        </p>
                      </details>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <p className="muted">
                {data.examples.status === "unsupported"
                  ? "Pour trouver un exemple, cherche un mot ou une courte expression (8 mots maximum)."
                  : data.examples.status === "unavailable"
                    ? "La recherche d’exemples est momentanément indisponible."
                    : "Aucun exemple bilingue trouvé. Essaie un mot ou une expression plus courte."}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
