import { describe, expect, it } from "vitest";
import {
  buildDimsPatch,
  initialDimsDraft,
  type VariantDimsValues,
} from "./variantDimsEdit";

const current: VariantDimsValues = {
  weightGrams: 70000,
  lengthMm: 39,
  widthMm: 39,
  heightMm: 152,
};

describe("variant dims edit", () => {
  it("черновик: предложение для ошибочного веса, текущие валидные габариты", () => {
    expect(
      initialDimsDraft(current, {
        weightGrams: 90,
        lengthMm: null,
        widthMm: null,
        heightMm: null,
      }),
    ).toEqual({ weight: "90", length: "39", width: "39", height: "152" });
    expect(
      initialDimsDraft(
        { weightGrams: null, lengthMm: null, widthMm: null, heightMm: null },
        null,
      ),
    ).toEqual({
      weight: "",
      length: "",
      width: "",
      height: "",
    });
  });

  it("патч только с изменёнными полями", () => {
    expect(
      buildDimsPatch(current, {
        weight: "90",
        length: "39",
        width: "39",
        height: "152",
      }),
    ).toEqual({
      patch: { weightGrams: 90 },
    });
    expect(
      buildDimsPatch(current, {
        weight: "70000",
        length: "40",
        width: "40",
        height: "150",
      }),
    ).toEqual({
      error: "Вес: 5–30000 г",
    });
    expect(
      buildDimsPatch(current, {
        weight: "",
        length: "40",
        width: "40",
        height: "150",
      }),
    ).toEqual({
      patch: { lengthMm: 40, widthMm: 40, heightMm: 150 },
    });
  });

  it("ошибки: неполная тройка, диапазон, мусор, нет изменений", () => {
    expect(
      buildDimsPatch(current, {
        weight: "90",
        length: "40",
        width: "",
        height: "150",
      }),
    ).toEqual({
      error: "Укажите все три габарита",
    });
    expect(
      buildDimsPatch(current, {
        weight: "90",
        length: "2",
        width: "40",
        height: "150",
      }),
    ).toEqual({
      error: "Габариты: 5–1500 мм",
    });
    expect(
      buildDimsPatch(current, {
        weight: "9,5",
        length: "",
        width: "",
        height: "",
      }),
    ).toEqual({
      error: "Только целые числа",
    });
    expect(
      buildDimsPatch(
        { ...current, weightGrams: 90 },
        { weight: "90", length: "39", width: "39", height: "152" },
      ),
    ).toEqual({ error: "Значения не изменились" });
  });
});
