// 最小の外部ストア。
//
// なぜ React Context をやめたか:
//   以前は1つの巨大な Context の値（useMemo の中に全部）を全画面が読んでいた。
//   セリフを1文字打つたびにその値が作り直され、常時マウントされている
//   Theater まで含めた全コンシューマが再描画されていた。学校の古いiPadでの
//   入力遅延はほぼこれ。
//
//   ストアを React の外に置くと、
//     - セレクタ単位で購読できる（1行の変更は1行だけ再描画）
//     - React の外（ジョブ層）から状態を進められる
//   の2つが同時に手に入る。後者のおかげで「処理を切らないために全画面を
//   マウントしたままにする」という回避策（SectionPane）も要らなくなった。

import { useSyncExternalStore } from 'react'

export interface Store<S> {
  get(): S
  set(update: S | ((prev: S) => S)): void
  subscribe(listener: () => void): () => void
}

export function createStore<S>(initial: S): Store<S> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set: (update) => {
      const next = typeof update === 'function' ? (update as (prev: S) => S)(state) : update
      if (Object.is(next, state)) return
      state = next
      for (const l of [...listeners]) l()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/**
 * ストアの一部を購読する。
 *
 * 注意: セレクタは**参照が安定した値**を返すこと（プリミティブか、
 * ストア内にそのまま置かれているオブジェクト）。毎回新しい配列や
 * オブジェクトを作ると再描画が止まらなくなる。
 * 派生値はコンポーネント側の useMemo で作る。
 */
export function useStore<S, T>(store: Store<S>, selector: (state: S) => T): T {
  const read = () => selector(store.get())
  return useSyncExternalStore(store.subscribe, read, read)
}
