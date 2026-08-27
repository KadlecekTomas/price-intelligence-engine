import assert from "node:assert/strict";
import test from "node:test";
import {
  inferGarmentProfile,
  scoreMaterialQuality,
} from "@/domain/material-quality";

test("classifies common garment profiles", () => {
  assert.equal(inferGarmentProfile("Pánské tričko s logem"), "tops");
  assert.equal(inferGarmentProfile("Merino svetr"), "knitwear");
  assert.equal(inferGarmentProfile("Džíny slim fit"), "denim");
  assert.equal(inferGarmentProfile("Zimní bunda"), "outerwear");
  assert.equal(inferGarmentProfile("Sportovní běžecká bunda"), "sportswear");
});

test("penalizes 100% polyester for a regular top", () => {
  const result = scoreMaterialQuality("Tričko", "100% polyester");
  assert.equal(result.profile, "tops");
  assert.ok((result.score ?? 100) <= 30);
  assert.ok(result.signals.includes("100% polyester u topu"));
});

test("does not blindly penalize polyester in sportswear", () => {
  const result = scoreMaterialQuality(
    "Sportovní funkční tričko",
    "100% polyester, 8% elastan",
  );
  assert.equal(result.profile, "sportswear");
  assert.ok((result.score ?? 0) >= 55);
  assert.ok(result.signals.includes("polyester je u sportu neutrální"));
});

test("strongly rewards merino knitwear", () => {
  const result = scoreMaterialQuality("Merino svetr", "100% merino vlna");
  assert.equal(result.profile, "knitwear");
  assert.ok((result.score ?? 0) >= 90);
  assert.ok(result.signals.includes("merino"));
});

test("penalizes acrylic knitwear", () => {
  const result = scoreMaterialQuality("Svetr", "100% akryl");
  assert.equal(result.profile, "knitwear");
  assert.ok((result.score ?? 100) <= 30);
  assert.ok(result.signals.includes("100% akryl u úpletu"));
});

test("treats cotton stretch denim as a positive signal", () => {
  const result = scoreMaterialQuality("Džíny", "99% bavlna, 1% elastan");
  assert.equal(result.profile, "denim");
  assert.ok((result.score ?? 0) >= 65);
  assert.ok(result.signals.includes("obsahuje bavlnu"));
  assert.ok(result.signals.includes("stretch příměs"));
});
