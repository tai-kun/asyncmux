import { setGlobalConfig } from "valibot";
import { beforeEach, describe, test } from "vitest";
import { UnreachableError } from "../src/errors.js";

beforeEach(() => {
  setGlobalConfig({ lang: "en" });
});

describe("UnreachableError", () => {
  test("globalThis.Error を継承している", ({ expect }) => {
    // Arrange & Act & Assert
    expect(new UnreachableError([])).toBeInstanceOf(globalThis.Error);
  });

  test("言語別にメッセージが変わる", ({ expect }) => {
    // Arrange & Act & Assert
    expect(new UnreachableError([]).message).toBe("Unreachable code reached");

    // Arrange & Act & Assert
    setGlobalConfig({ lang: "ja" });
    expect(new UnreachableError([]).message).toBe("到達できないコードに到達しました");
  });
});
