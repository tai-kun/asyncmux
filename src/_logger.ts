import { getLogger } from "@logtape/logtape";

const log = getLogger("asyncmux");

/**
 * デバッグログが出力される状態かどうかを返します。
 *
 * ログが無効な場合にテンプレートの生成などのコストを回避するため、
 * 高頻度で呼び出される箇所では `log.debug` の前にこの関数でガードしてください。
 *
 * @returns デバッグログが有効な場合は `true`、そうでない場合は `false` です。
 */
export function isLogDebugEnabled(): boolean {
  return log.isEnabledFor("debug");
}

export default log;
