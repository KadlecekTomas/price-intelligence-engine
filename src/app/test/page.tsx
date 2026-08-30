import type { Metadata } from "next";
import Link from "next/link";
import { readCatalogHealth, type CatalogSourceHealth } from "@/lib/catalog-health";
import { RefreshButton } from "./refresh-button";
import styles from "./test.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Data status | Price Intelligence Engine",
  description: "Interní přehled publikovaných katalogů a aktualizací dat.",
};

const dateTimeFormatter = new Intl.DateTimeFormat("cs-CZ", {
  timeZone: "Europe/Prague",
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const numberFormatter = new Intl.NumberFormat("cs-CZ");

function formatDate(value: string | null) {
  if (!value) return "—";
  return dateTimeFormatter.format(new Date(value));
}

function formatDuration(source: CatalogSourceHealth) {
  if (!source.activeRunFinishedAt) return "—";
  const durationMs = Math.max(
    0,
    new Date(source.activeRunFinishedAt).getTime() - new Date(source.activeRunStartedAt).getTime(),
  );
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`;
}

function shortRunId(runId: string) {
  if (runId.length <= 30) return runId;
  return `${runId.slice(0, 22)}…${runId.slice(-6)}`;
}

export default async function TestPage() {
  try {
    const snapshot = await readCatalogHealth();
    const syncingSources = snapshot.sources.filter((source) => source.state === "syncing").length;

    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <header className={styles.header}>
            <div>
              <div className={styles.eyebrow}>PRICE INTELLIGENCE ENGINE</div>
              <h1>Data status</h1>
              <p>
                Reálný stav publikovaných katalogů. Počty pocházejí z aktivní databázové publikace,
                ne z hardcodovaných hodnot ve frontendu.
              </p>
            </div>
            <nav className={styles.actions} aria-label="Akce dashboardu">
              <Link href="/" className={styles.secondaryAction}>Zpět na web</Link>
              <RefreshButton />
            </nav>
          </header>

          <section className={styles.summaryGrid} aria-label="Souhrn dat">
            <article className={styles.summaryCard}>
              <span>Aktivní zdroje</span>
              <strong>{numberFormatter.format(snapshot.sourceCount)}</strong>
              <small>{syncingSources > 0 ? `${syncingSources} právě aktualizujeme` : "žádný sync právě neběží"}</small>
            </article>
            <article className={styles.summaryCard}>
              <span>Publikované produkty</span>
              <strong>{numberFormatter.format(snapshot.totalProducts)}</strong>
              <small>součet aktivních katalogů</small>
            </article>
            <article className={styles.summaryCard}>
              <span>Poslední publikace</span>
              <strong className={styles.dateValue}>{formatDate(snapshot.lastPublishedAt)}</strong>
              <small>čas Praha</small>
            </article>
            <article className={styles.summaryCard}>
              <span>Další automatický update</span>
              <strong className={styles.dateValue}>Nenaplánován</strong>
              <small>full sync je zatím spouštěný ručně</small>
            </article>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <div>
                <h2>Zdroje</h2>
                <p>Každý řádek odpovídá právě aktivní atomicky publikované verzi katalogu.</p>
              </div>
              <span className={styles.generatedAt}>Načteno {formatDate(snapshot.generatedAt)}</span>
            </div>

            <div className={styles.sourceList}>
              {snapshot.sources.map((source) => (
                <article className={styles.sourceCard} key={`${source.shopId}-${source.market}`}>
                  <div className={styles.sourceTop}>
                    <div className={styles.sourceIdentity}>
                      <div className={styles.sourceTitleRow}>
                        <h3>{source.name}</h3>
                        <span className={`${styles.statusBadge} ${styles[source.state]}`}>
                          <span className={styles.statusDot} />
                          {source.stateLabel}
                        </span>
                      </div>
                      <a href={`https://${source.website}`} target="_blank" rel="noreferrer">
                        {source.website}
                      </a>
                    </div>
                    <div className={styles.productCount}>
                      <strong>{numberFormatter.format(source.productCount)}</strong>
                      <span>produktů</span>
                    </div>
                  </div>

                  <dl className={styles.detailsGrid}>
                    <div>
                      <dt>Poslední publikace</dt>
                      <dd>{formatDate(source.publishedAt)}</dd>
                    </div>
                    <div>
                      <dt>Délka posledního syncu</dt>
                      <dd>{formatDuration(source)}</dd>
                    </div>
                    <div>
                      <dt>Coverage katalogu</dt>
                      <dd className={styles.warningValue}>{source.coverageLabel}</dd>
                    </div>
                    <div>
                      <dt>Další update</dt>
                      <dd>{source.nextUpdateAt ? formatDate(source.nextUpdateAt) : "Nenaplánován"}</dd>
                      <span className={styles.detailHint}>{source.scheduleLabel}</span>
                    </div>
                  </dl>

                  <div className={styles.runInfo}>
                    <span>Aktivní run</span>
                    <code title={source.activeRunId}>{shortRunId(source.activeRunId)}</code>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside className={styles.notice}>
            <div className={styles.noticeIcon}>!</div>
            <div>
              <strong>Coverage držíme odděleně od počtu produktů.</strong>
              <p>
                Publikovaných 1 003 položek může být technicky perfektní dataset a zároveň neúplný katalog.
                Dokud neumíme porovnat discovery proti očekávanému rozsahu zdroje, dashboard záměrně ukazuje
                coverage jako „Neověřeno“ místo falešných 100 %.
              </p>
            </div>
          </aside>
        </div>
      </main>
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Neznámá chyba";
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <header className={styles.header}>
            <div>
              <div className={styles.eyebrow}>PRICE INTELLIGENCE ENGINE</div>
              <h1>Data status</h1>
              <p>Dashboard se nepodařilo načíst z databáze.</p>
            </div>
            <Link href="/" className={styles.secondaryAction}>Zpět na web</Link>
          </header>
          <section className={styles.errorCard}>
            <strong>Data source unavailable</strong>
            <code>{message}</code>
          </section>
        </div>
      </main>
    );
  }
}
