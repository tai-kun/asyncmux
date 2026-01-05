import { test } from "vitest";
import unreachable from "../src/_unreachable.js";
import { UnreachableError } from "../src/errors.js";

test("引数なしで呼び出したとき、UnreachableError をスローする", ({ expect }) => {
  // Arrange & Act & Assert
  expect(() => {
    unreachable();
  })
    .toThrow(UnreachableError);
});

test("引数ありで呼び出したとき、渡された値を含む UnreachableError を投げる", ({ expect }) => {
  // Arrange
  const unexpectedValue = "unexpected" as never;

  // Act & Assert
  try {
    unreachable(unexpectedValue);
    // @ts-expect-error: ここには到達しないはずです。
    expect.unreachable("unreachable 関数は必ずエラーを投げるはずです。");
  } catch (error) {
    expect(error).toBeInstanceOf(UnreachableError);
    expect((error as UnreachableError).meta.value).toBe(unexpectedValue);
  }
});
