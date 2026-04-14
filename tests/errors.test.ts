import { setGlobalConfig } from "valibot";
import { beforeEach, describe, test } from "vitest";

import { DecoratorSupportError } from "../src/errors.js";

beforeEach(() => {
  setGlobalConfig({ lang: "en" });
});

describe("DecoratorSupportError", () => {
  test("globalThis.Error を継承している", ({ expect }) => {
    // Arrange & Act & Assert
    expect(new DecoratorSupportError()).toBeInstanceOf(globalThis.Error);
  });

  test("言語別にメッセージが変わる", ({ expect }) => {
    // Arrange & Act & Assert
    expect(new DecoratorSupportError().message).toBe("Requires Stage 3 decorator support");

    // Arrange & Act & Assert
    setGlobalConfig({ lang: "ja" });
    expect(new DecoratorSupportError().message).toBe(
      "ステージ 3 のデコレーターのサポートが必要です",
    );
  });
});
