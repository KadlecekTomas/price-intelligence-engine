export type QuickFilterState = {
  category: string;
  color: string;
  size: string;
  maxPrice: string;
  material: string;
  sort: "recommended" | "price" | "history" | "deal";
  quality: boolean;
};

type Props = {
  filters: QuickFilterState;
  loading: boolean;
  onChange: (next: QuickFilterState) => void;
};

const CATEGORY_PRESETS = [
  ["tričko", "Trička"],
  ["mikina", "Mikiny"],
  ["tenisky", "Tenisky"],
  ["džíny", "Džíny"],
  ["bunda", "Bundy"],
  ["košile", "Košile"],
] as const;

const PRICE_PRESETS = [
  ["500", "do 500 Kč"],
  ["1000", "do 1 000 Kč"],
  ["1500", "do 1 500 Kč"],
  ["2500", "do 2 500 Kč"],
  ["4000", "do 4 000 Kč"],
] as const;

const APPAREL_SIZE_PRESETS = ["S", "M", "L", "XL", "XXL"] as const;
const SHOE_SIZE_PRESETS = ["41", "42", "43", "44", "45"] as const;

const COLOR_PRESETS = [
  ["černá", "Černá"],
  ["bílá", "Bílá"],
  ["modrá", "Modrá"],
  ["béžová", "Béžová"],
] as const;

const MATERIAL_PRESETS = [
  ["bavlna", "Bavlna"],
  ["vlna", "Vlna"],
  ["merino", "Merino"],
  ["len", "Len"],
] as const;

function toggleValue(current: string, next: string) {
  return current === next ? "" : next;
}

export default function QuickFilters({ filters, loading, onChange }: Props) {
  const shoeSizes = filters.category === "boty" || filters.category === "tenisky";
  const sizePresets = shoeSizes ? SHOE_SIZE_PRESETS : APPAREL_SIZE_PRESETS;

  function update(patch: Partial<QuickFilterState>) {
    if (loading) return;
    onChange({ ...filters, ...patch });
  }

  return (
    <section className="quickFilters" aria-label="Rychlé filtry">
      <div className="quickFiltersHeader">
        <div>
          <strong>Rychlá volba</strong>
          <span>Klikni a hledáme hned. Textový input používej jen na značku nebo speciální požadavek.</span>
        </div>
        <button
          type="button"
          className="quickClear"
          disabled={loading}
          onClick={() => onChange({
            category: "",
            color: "",
            size: "",
            maxPrice: "",
            material: "",
            sort: "recommended",
            quality: false,
          })}
        >
          Vyčistit filtry
        </button>
      </div>

      <div className="quickFilterGroup">
        <span className="quickFilterLabel">Kategorie</span>
        <div className="quickFilterRow">
          {CATEGORY_PRESETS.map(([value, label]) => (
            <button
              type="button"
              key={value}
              disabled={loading}
              className={filters.category === value ? "active" : ""}
              aria-pressed={filters.category === value}
              onClick={() => update({
                category: toggleValue(filters.category, value),
                size: filters.category === value ? filters.size : "",
              })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="quickFilterGroup">
        <span className="quickFilterLabel">Rozpočet</span>
        <div className="quickFilterRow">
          {PRICE_PRESETS.map(([value, label]) => (
            <button
              type="button"
              key={value}
              disabled={loading}
              className={filters.maxPrice === value ? "active" : ""}
              aria-pressed={filters.maxPrice === value}
              onClick={() => update({ maxPrice: toggleValue(filters.maxPrice, value) })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="quickFilterGroup">
        <span className="quickFilterLabel">Velikost {shoeSizes ? "bot" : "oblečení"}</span>
        <div className="quickFilterRow compact">
          {sizePresets.map((value) => (
            <button
              type="button"
              key={value}
              disabled={loading}
              className={filters.size === value ? "active" : ""}
              aria-pressed={filters.size === value}
              onClick={() => update({ size: toggleValue(filters.size, value) })}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="quickFilterGroup">
        <span className="quickFilterLabel">Barva</span>
        <div className="quickFilterRow">
          {COLOR_PRESETS.map(([value, label]) => (
            <button
              type="button"
              key={value}
              disabled={loading}
              className={filters.color === value ? "active" : ""}
              aria-pressed={filters.color === value}
              onClick={() => update({ color: toggleValue(filters.color, value) })}
            >
              <i className={`colorDot ${value}`} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="quickFilterGroup">
        <span className="quickFilterLabel">Materiál</span>
        <div className="quickFilterRow">
          {MATERIAL_PRESETS.map(([value, label]) => (
            <button
              type="button"
              key={value}
              disabled={loading}
              className={filters.material === value ? "active" : ""}
              aria-pressed={filters.material === value}
              onClick={() => update({ material: toggleValue(filters.material, value) })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="quickFilterGroup quickPriorities">
        <span className="quickFilterLabel">Priorita</span>
        <div className="quickFilterRow">
          <button
            type="button"
            disabled={loading}
            className={filters.sort === "deal" ? "active" : ""}
            aria-pressed={filters.sort === "deal"}
            onClick={() => update({ sort: filters.sort === "deal" ? "recommended" : "deal" })}
          >
            🔥 Nejlepší deal
          </button>
          <button
            type="button"
            disabled={loading}
            className={filters.sort === "price" ? "active" : ""}
            aria-pressed={filters.sort === "price"}
            onClick={() => update({ sort: filters.sort === "price" ? "recommended" : "price" })}
          >
            ↓ Nejlevnější
          </button>
          <button
            type="button"
            disabled={loading}
            className={filters.quality ? "active" : ""}
            aria-pressed={filters.quality}
            onClick={() => update({ quality: !filters.quality })}
          >
            🧵 Kvalitní materiál
          </button>
        </div>
      </div>
    </section>
  );
}
